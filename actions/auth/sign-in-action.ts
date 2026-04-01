"use server";

// ─────────────────────────────────────────────────────────────────────────────
// actions/auth/sign-in-action.ts
//
// Canonical storefront sign-in mutation for Blackframe.
//
// Execution sequence:
//   1. Normalize and validate email
//   2. Validate password presence
//   3. Sign in through Supabase Auth (signInWithPassword)
//   4. Optionally resolve the normalized AuthSession via getSession
//   5. Return typed result
//
// This file does NOT:
//   - create users
//   - create customer rows
//   - create profile rows
//   - perform redirects directly
//   - duplicate getSession logic
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/features/auth/lib/get-session";
import type { AuthSession } from "@/features/auth/types/auth.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT / RESULT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SignInInput {
  email: string;
  password: string;
  /**
   * Optional storefront context for scoped session resolution.
   * When provided, the resolved AuthSession will attempt storefront-scoped
   * customer linkage. Without it, customer resolution falls back to
   * email-only matching which may be ambiguous in multi-tenant data.
   */
  storefrontId?: string | null;
  /**
   * Optional path to redirect to after successful sign-in.
   * The action returns this value in the result — it does not redirect itself.
   * The calling page or component is responsible for navigation.
   */
  redirectTo?: string | null;
}

export type SignInErrorCode =
  | "INVALID_INPUT"
  | "INVALID_EMAIL"
  | "MISSING_PASSWORD"
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_CONFIRMED"
  | "ACCOUNT_DISABLED"
  | "TOO_MANY_REQUESTS"
  | "SESSION_RESOLVE_ERROR"
  | "UNEXPECTED_ERROR";

export type SignInResult = SignInSuccess | SignInFailure;

export interface SignInSuccess {
  ok: true;
  /** User-safe success message. */
  message: string;
  /** Normalized AuthSession resolved after sign-in. */
  authSession: AuthSession;
  /** Path to redirect to, if one was provided in the input or derived from the flow. */
  redirectTo: string | null;
}

export interface SignInFailure {
  ok: false;
  code: SignInErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Internal detail for logging — not for display. */
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize email: trim and lowercase. */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Basic structural email validation. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Build a typed failure result. */
function fail(
  code: SignInErrorCode,
  message: string,
  detail?: string
): SignInFailure {
  return { ok: false, code, message, detail };
}

/**
 * Map Supabase Auth error messages to machine-friendly error codes.
 *
 * Supabase does not expose stable error code enums from the JS client —
 * we match on message substrings. This is intentionally explicit so that
 * new Supabase error shapes surface as UNEXPECTED_ERROR and can be
 * catalogued and handled deliberately rather than silently absorbing them.
 */
function mapSupabaseSignInError(message: string): SignInFailure {
  const msg = message.toLowerCase();

  if (
    msg.includes("invalid login credentials") ||
    msg.includes("invalid credentials") ||
    msg.includes("wrong password") ||
    msg.includes("user not found")
  ) {
    return fail(
      "INVALID_CREDENTIALS",
      "The email or password you entered is incorrect. Please try again."
    );
  }

  if (msg.includes("email not confirmed") || msg.includes("email confirmation")) {
    return fail(
      "EMAIL_NOT_CONFIRMED",
      "Please verify your email address before signing in. Check your inbox for a confirmation email.",
      message
    );
  }

  if (msg.includes("disabled") || msg.includes("banned")) {
    return fail(
      "ACCOUNT_DISABLED",
      "Your account has been disabled. Please contact support.",
      message
    );
  }

  if (
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("429")
  ) {
    return fail(
      "TOO_MANY_REQUESTS",
      "Too many sign-in attempts. Please wait a moment and try again.",
      message
    );
  }

  return fail(
    "UNEXPECTED_ERROR",
    "Something went wrong while signing in. Please try again.",
    message
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXPORTED SERVER ACTION
// ─────────────────────────────────────────────────────────────────────────────

export async function signInAction(input: SignInInput): Promise<SignInResult> {
  // ── Step 1: validate and normalize email ──────────────────────────────────
  if (!input.email || typeof input.email !== "string") {
    return fail("INVALID_INPUT", "An email address is required.");
  }

  const email = normalizeEmail(input.email);

  if (!isValidEmail(email)) {
    return fail("INVALID_EMAIL", "Please enter a valid email address.");
  }

  // ── Step 2: validate password presence ────────────────────────────────────
  // We validate only that a password was provided — not its strength.
  // The auth provider owns all credential verification.
  if (!input.password || typeof input.password !== "string" || !input.password.trim()) {
    return fail("MISSING_PASSWORD", "A password is required.");
  }

  // ── Step 3: sign in through Supabase Auth ─────────────────────────────────
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (err) {
    return fail(
      "UNEXPECTED_ERROR",
      "A connection error occurred. Please try again.",
      err instanceof Error ? err.message : String(err)
    );
  }

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });

  if (authError) {
    return mapSupabaseSignInError(authError.message);
  }

  if (!authData.user) {
    // Unexpected: no error but no user — treat as an auth failure
    return fail(
      "UNEXPECTED_ERROR",
      "Sign-in could not be completed. Please try again."
    );
  }

  // ── Step 4: resolve the normalized AuthSession ────────────────────────────
  // Best-effort — a session resolution failure does not invalidate the sign-in.
  // The user is authenticated; we simply may not have the enriched session.
  let authSession: AuthSession;
  try {
    authSession = await getSession({
      storefrontId: input.storefrontId ?? undefined,
    });
  } catch (err) {
    // Session resolution threw unexpectedly.
    // Return a partial success — the user IS signed in via Supabase Auth.
    // The calling layer can resolve the session independently on next render.
    console.error("[sign-in-action] getSession error after successful sign-in:", err);
    return fail(
      "SESSION_RESOLVE_ERROR",
      "You have been signed in, but your session could not be fully loaded. Please refresh the page.",
      err instanceof Error ? err.message : String(err)
    );
  }

  // ── Step 5: return typed success result ───────────────────────────────────
  return {
    ok: true,
    message: "You have been signed in successfully.",
    authSession,
    redirectTo: input.redirectTo?.trim() || null,
  };
}
