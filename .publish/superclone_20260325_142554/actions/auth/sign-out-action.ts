"use server";

// ─────────────────────────────────────────────────────────────────────────────
// actions/auth/sign-out-action.ts
//
// Canonical storefront sign-out mutation for Blackframe.
//
// Execution sequence:
//   1. Call Supabase Auth signOut to invalidate the server-side session
//   2. Return a typed result with a recommended post-sign-out path
//
// This file does NOT:
//   - clear cart state, checkout sessions, or wishlist data
//   - manipulate profiles or customer rows
//   - perform redirects directly
//   - mix in any platform-admin teardown
//
// Scope: auth sign-out only.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT / RESULT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SignOutInput {
  /**
   * Optional path to redirect to after sign-out.
   * The action returns this in the result — it does not redirect itself.
   * When omitted, the result carries a safe default path.
   */
  redirectTo?: string | null;
  /**
   * Optional human-readable reason for the sign-out.
   * May be used for analytics or session event logging.
   * Not displayed to the user by this action.
   */
  reason?: "user_initiated" | "session_expired" | "account_disabled" | null;
}

export type SignOutErrorCode =
  | "SIGN_OUT_ERROR"
  | "UNEXPECTED_ERROR";

export type SignOutResult = SignOutSuccess | SignOutFailure;

export interface SignOutSuccess {
  ok: true;
  /** User-safe success message. */
  message: string;
  /** Recommended path to send the user to after sign-out. */
  redirectTo: string;
}

export interface SignOutFailure {
  ok: false;
  code: SignOutErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Internal detail for logging — not for display. */
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Default post-sign-out destination within the storefront. */
const DEFAULT_POST_SIGNOUT_PATH = "/";

function fail(
  code: SignOutErrorCode,
  message: string,
  detail?: string
): SignOutFailure {
  return { ok: false, code, message, detail };
}

/**
 * Resolve the post-sign-out redirect path.
 * Validates the provided path is a relative internal path to prevent
 * open-redirect vulnerabilities. Falls back to the default path otherwise.
 */
function resolveRedirectPath(redirectTo: string | null | undefined): string {
  if (!redirectTo) return DEFAULT_POST_SIGNOUT_PATH;

  const trimmed = redirectTo.trim();

  // Accept relative paths only (must start with /).
  // Reject absolute URLs, protocol-relative URLs, and empty strings.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return DEFAULT_POST_SIGNOUT_PATH;
  }

  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXPORTED SERVER ACTION
// ─────────────────────────────────────────────────────────────────────────────

export async function signOutAction(
  input?: SignOutInput
): Promise<SignOutResult> {
  // ── Step 1: sign out through Supabase Auth ────────────────────────────────
  // supabase.auth.signOut() invalidates the user's session on the Supabase
  // Auth server and clears the auth cookies from the server-side client.
  // It does not fail if the user is already signed out — idempotent.
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (err) {
    return fail(
      "UNEXPECTED_ERROR",
      "A connection error occurred while signing out. Please try again.",
      err instanceof Error ? err.message : String(err)
    );
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    // Sign-out errors are non-fatal in most real scenarios (e.g. token already
    // expired). Log the detail but return a user-safe failure rather than
    // silently succeeding — the caller may want to force a client-side
    // session clear regardless.
    console.error("[sign-out-action] supabase.auth.signOut() error:", error.message);
    return fail(
      "SIGN_OUT_ERROR",
      "Something went wrong while signing out. Please try again.",
      error.message
    );
  }

  // ── Step 2: return typed success result ───────────────────────────────────
  const redirectTo = resolveRedirectPath(input?.redirectTo);

  return {
    ok: true,
    message: "You have been signed out successfully.",
    redirectTo,
  };
}
