"use server";

// ─────────────────────────────────────────────────────────────────────────────
// actions/auth/sign-up-action.ts
//
// Canonical storefront sign-up mutation for Blackframe.
//
// Execution sequence:
//   1. Normalize and validate email
//   2. Validate password
//   3. Validate name inputs
//   4. Create the auth user through Supabase Auth (signUp)
//   5. Create or upsert the public.profiles row
//   6. Handle email confirmation state
//   7. Return typed result
//
// Backend separation this file respects:
//   - auth.users is owned by Supabase Auth — created via supabase.auth.signUp
//   - public.profiles(user_id, full_name, email, ...) is separate and must be
//     created explicitly after auth user creation
//   - public.customers is a separate storefront-scoped domain table —
//     NOT created automatically here unless explicitly configured
//
// This file does NOT:
//   - automatically create customer rows (see customerLinkingHook below)
//   - perform redirects directly
//   - duplicate getSession logic
//   - handle password reset
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import type { AuthSession } from "@/features/auth/types/auth.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT / RESULT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SignUpInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /**
   * Optional storefront context. When provided, stored for potential
   * future customer linking. Does not affect auth or profile creation.
   */
  storefrontId?: string | null;
  /**
   * Optional path to redirect to after successful sign-up or email verification.
   * The action returns this in the result — it does not redirect itself.
   */
  redirectTo?: string | null;
}

export type SignUpErrorCode =
  | "INVALID_INPUT"
  | "INVALID_EMAIL"
  | "MISSING_PASSWORD"
  | "WEAK_PASSWORD"
  | "MISSING_NAME"
  | "EMAIL_ALREADY_EXISTS"
  | "PROFILE_CREATE_ERROR"
  | "TOO_MANY_REQUESTS"
  | "UNEXPECTED_ERROR";

export type SignUpResult = SignUpSuccess | SignUpFailure;

export interface SignUpSuccess {
  ok: true;
  /** User-safe success message. */
  message: string;
  /**
   * Whether email verification is required before the user can sign in.
   * True when Supabase is configured to require email confirmation.
   * When true, `authSession` is null — there is no live session yet.
   */
  requiresEmailVerification: boolean;
  /**
   * Normalized AuthSession if the user is immediately active (no email
   * confirmation required). Null when email verification is pending.
   */
  authSession: AuthSession | null;
  /** Path to redirect to after sign-up or email confirmation. */
  redirectTo: string | null;
}

export interface SignUpFailure {
  ok: false;
  code: SignUpErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Per-field validation errors when available. */
  fieldErrors?: Partial<Record<"email" | "password" | "firstName" | "lastName", string>>;
  /** Internal detail for logging — not for display. */
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Minimal password strength: at least 8 characters. */
function isStrongEnough(password: string): boolean {
  return password.length >= 8;
}

function fail(
  code: SignUpErrorCode,
  message: string,
  fieldErrors?: SignUpFailure["fieldErrors"],
  detail?: string
): SignUpFailure {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}), detail };
}

/**
 * Compose full_name from first and last name parts.
 * Always trims each component and joins with a single space.
 */
function composeFullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

/**
 * Map Supabase Auth sign-up error messages to machine-friendly codes.
 * Explicit matching is preferred over catch-all so new Supabase error shapes
 * surface visibly rather than disappearing into UNEXPECTED_ERROR.
 */
function mapSupabaseSignUpError(message: string): SignUpFailure {
  const msg = message.toLowerCase();

  if (
    msg.includes("user already registered") ||
    msg.includes("already exists") ||
    msg.includes("duplicate") ||
    msg.includes("already been registered")
  ) {
    return fail(
      "EMAIL_ALREADY_EXISTS",
      "An account with this email address already exists. Please sign in instead.",
      { email: "This email is already registered." }
    );
  }

  if (
    msg.includes("password") &&
    (msg.includes("too short") || msg.includes("weak") || msg.includes("strength"))
  ) {
    return fail(
      "WEAK_PASSWORD",
      "Your password does not meet the security requirements. Please choose a stronger password.",
      { password: "Password is too weak." }
    );
  }

  if (
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("429")
  ) {
    return fail(
      "TOO_MANY_REQUESTS",
      "Too many sign-up attempts. Please wait a moment and try again.",
      undefined,
      message
    );
  }

  return fail(
    "UNEXPECTED_ERROR",
    "Something went wrong while creating your account. Please try again.",
    undefined,
    message
  );
}

/**
 * Upsert the public.profiles row for the newly created auth user.
 *
 * Strategy: upsert on user_id to handle the rare case where a profile row
 * was pre-created (e.g. via trigger) before this action runs.
 * Silently fails — a missing profile row does not invalidate the sign-up.
 * The session layer handles partial identity gracefully.
 *
 * Returns true on success, false on failure (caller logs and continues).
 */
async function upsertProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authUserId: string,
  email: string,
  fullName: string
): Promise<boolean> {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: authUserId,
        full_name: fullName,
        email,
        updated_at: now,
      },
      {
        onConflict: "user_id",
        ignoreDuplicates: false,
      }
    );

  if (error) {
    console.error("[sign-up-action] profile upsert error:", error.message);
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OPTIONAL CUSTOMER LINKING HOOK (future-facing stub)
//
// Customer rows (public.customers) are a separate storefront-scoped domain.
// Automatic customer creation at sign-up is NOT performed by default because:
//   - Not all storefronts require it at sign-up time
//   - Customer rows are distributor-scoped and may need additional context
//   - The place-order flow already handles customer row creation on demand
//
// When the product requires immediate customer provisioning at sign-up,
// implement that logic here and call it explicitly from signUpAction with
// `createCustomerOnSignUp: true` or a similar explicit flag.
//
// This stub exists solely as a documentation anchor for where to extend.
// ─────────────────────────────────────────────────────────────────────────────

// async function provisionCustomerOnSignUp(...): Promise<void> {
//   // TODO: implement when storefront requires immediate customer linking
// }

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXPORTED SERVER ACTION
// ─────────────────────────────────────────────────────────────────────────────

export async function signUpAction(input: SignUpInput): Promise<SignUpResult> {
  // ── Step 1: normalize and validate email ──────────────────────────────────
  if (!input.email || typeof input.email !== "string") {
    return fail("INVALID_INPUT", "An email address is required.", { email: "Required." });
  }

  const email = normalizeEmail(input.email);

  if (!isValidEmail(email)) {
    return fail("INVALID_EMAIL", "Please enter a valid email address.", {
      email: "Please enter a valid email address.",
    });
  }

  // ── Step 2: validate password ─────────────────────────────────────────────
  if (!input.password || typeof input.password !== "string" || !input.password.trim()) {
    return fail("MISSING_PASSWORD", "A password is required.", {
      password: "Required.",
    });
  }

  if (!isStrongEnough(input.password)) {
    return fail(
      "WEAK_PASSWORD",
      "Your password must be at least 8 characters long.",
      { password: "Must be at least 8 characters." }
    );
  }

  // ── Step 3: validate name inputs ──────────────────────────────────────────
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";

  if (!firstName || !lastName) {
    return fail(
      "MISSING_NAME",
      "Please enter your first and last name.",
      {
        ...(firstName ? {} : { firstName: "Required." }),
        ...(lastName ? {} : { lastName: "Required." }),
      }
    );
  }

  const fullName = composeFullName(firstName, lastName);

  // ── Step 4: create the auth user through Supabase Auth ────────────────────
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (err) {
    return fail(
      "UNEXPECTED_ERROR",
      "A connection error occurred. Please try again.",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
      },
    },
  });

  if (authError) {
    return mapSupabaseSignUpError(authError.message);
  }

  if (!authData.user) {
    return fail(
      "UNEXPECTED_ERROR",
      "Account creation could not be completed. Please try again."
    );
  }

  const authUserId = authData.user.id;

  // ── Step 5: create or upsert the public.profiles row ──────────────────────
  // Explicit — not assumed to be created automatically by a DB trigger.
  // If a trigger already handled this, the upsert is a safe no-op.
  const profileOk = await upsertProfile(supabase, authUserId, email, fullName);

  if (!profileOk) {
    // Profile upsert failed but auth user was created.
    // Log the error and continue — the session layer handles partial identity.
    // Profile will be created on next sign-in via getSession if needed.
    console.error(
      "[sign-up-action] profile upsert failed for user:",
      authUserId,
      "— auth user created but profile is missing. Will be resolved at next sign-in."
    );
  }

  // ── Step 6: determine email confirmation state ────────────────────────────
  // Supabase signals email confirmation is required by returning a user with
  // no session (authData.session === null) despite a successful sign-up.
  // When identities[0].identity_data.email_verified is false (or session is
  // null), the user must confirm their email before they can sign in.
  const requiresEmailVerification =
    authData.session === null ||
    authData.user.identities?.[0]?.identity_data?.email_verified === false;

  // ── Step 7: return typed result ───────────────────────────────────────────
  if (requiresEmailVerification) {
    return {
      ok: true,
      message:
        "Your account has been created. Please check your email to verify your address before signing in.",
      requiresEmailVerification: true,
      authSession: null,
      redirectTo: input.redirectTo?.trim() || null,
    };
  }

  // Email confirmation not required — resolve the session immediately.
  // Import lazily to avoid circular dependency between auth action and session reader.
  const { getSession } = await import("@/features/auth/lib/get-session");

  let authSession: AuthSession | null = null;
  try {
    authSession = await getSession({
      storefrontId: input.storefrontId ?? undefined,
    });
  } catch (err) {
    // Session resolution threw — sign-up succeeded, session will be resolved
    // on next render. Not a fatal error.
    console.error("[sign-up-action] getSession error after successful sign-up:", err);
  }

  return {
    ok: true,
    message: "Your account has been created. Welcome to Blackframe.",
    requiresEmailVerification: false,
    authSession,
    redirectTo: input.redirectTo?.trim() || null,
  };
}
