// ─────────────────────────────────────────────────────────────────────────────
// lib/guards/require-auth.ts
//
// Canonical storefront auth guard for protected routes in Blackframe.
//
// Responsibilities:
//   1. Read the current normalized AuthSession via getSession
//   2. Determine whether the visitor meets the access requirement
//   3. Optionally enforce customer linkage when the route demands it
//   4. Either return the authenticated AuthSession, redirect, or throw
//
// This is the single protected-route gate for authenticated storefront
// experiences (/account, future customer pages, checkout-linked auth, etc.).
//
// Architecture constraints:
//   - getSession is the only source of auth state. No raw Supabase calls here.
//   - No login / sign-up / sign-out logic belongs here.
//   - No middleware. No UI.
//   - No platform-admin behavior mixed into standard storefront auth.
//   - Authenticated does NOT imply customer-linked — that is explicit and opt-in.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { getSession } from "@/features/auth/lib/get-session";
import type { AuthSession } from "@/features/auth/types/auth.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOCAL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Controls what happens when the guard denies access.
 *
 * "redirect" — calls Next.js redirect() to loginPath (default) or redirectTo.
 * "throw"    — throws an AuthRequiredError.
 */
export type AuthGuardFailureMode = "redirect" | "throw";

/**
 * Typed input for requireAuth.
 *
 * All fields are optional. Omitting the argument entirely applies
 * standard route protection: authenticated = allow, anonymous = redirect to login.
 */
export interface RequireAuthInput {
  /**
   * Narrow the getSession customer resolution to this storefront.
   * Strongly preferred when the route is storefront-scoped.
   * Without it, customer linkage falls back to email-only matching
   * which may be ambiguous in multi-tenant data.
   */
  storefrontId?: string;

  /**
   * When true, access is denied unless the session also has a linked
   * storefront customer record (customer !== null and customerLinkState === "linked").
   *
   * Use this for routes that genuinely depend on customer-facing data:
   * order history, saved addresses, account profile pages.
   *
   * Do NOT enable this for routes that only require authentication —
   * not every authenticated user has a customer row.
   *
   * Defaults to false.
   */
  requireCustomer?: boolean;

  /**
   * What to do when access is denied.
   * Defaults to "redirect".
   */
  onFailure?: AuthGuardFailureMode;

  /**
   * Path to redirect to on denial when onFailure is "redirect".
   * Defaults to "/login".
   *
   * Use this when the route has a non-standard login entry point.
   */
  loginPath?: string;

  /**
   * The intended destination path to preserve through the login redirect.
   * Appended as ?returnTo=<encoded> on the login URL so the login page
   * can restore the user to their original destination after auth completes.
   *
   * When not provided, no returnTo param is added to the login redirect.
   */
  returnTo?: string;

  /**
   * Human-readable reason for the access denial.
   * Used as the `reason` field on thrown AuthRequiredError when onFailure is "throw".
   * Not included in the redirect URL — kept server-side only.
   */
  reason?: string;
}

/**
 * The return type of requireAuth on success.
 *
 * TypeScript cannot narrow the full AuthSession to a guaranteed-authenticated
 * variant purely through the function return type without duplicating the
 * interface. We use a branded intersection instead — callers get the full
 * AuthSession shape with an explicit authenticated marker so they can trust
 * that session.user, session.profile, and session.isAuthenticated are reliable.
 *
 * Fields that may still be null (even on success):
 *   session.customer   — present only when requireCustomer was false and the
 *                        user happens to have no customer row yet.
 *                        When requireCustomer: true, customer is guaranteed non-null.
 *   session.profile    — best-effort; a missing profile row is partial not denied.
 */
export type AuthenticatedSession = AuthSession & { readonly __authenticated: true };

// ─────────────────────────────────────────────────────────────────────────────
// 2. CUSTOM ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when access is denied and the caller requested throw-mode failure.
 *
 * Carries a `code` distinguishing the denial reason so calling layers
 * can react differently to "not signed in" vs "signed in but no customer".
 */
export class AuthRequiredError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "UNAUTHENTICATED"
      | "CUSTOMER_REQUIRED"
      | "SESSION_ERROR",
    public readonly reason?: string
  ) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the login redirect URL, optionally preserving the intended destination.
 *
 * When returnTo is provided, it is appended as a URL-encoded ?returnTo= param
 * so the login page can restore the user to their original destination.
 */
function buildLoginUrl(loginPath: string, returnTo?: string): string {
  if (!returnTo || returnTo.trim() === "") {
    return loginPath;
  }

  const encoded = encodeURIComponent(returnTo.trim());
  const separator = loginPath.includes("?") ? "&" : "?";
  return `${loginPath}${separator}returnTo=${encoded}`;
}

/**
 * Apply the configured failure behavior. Never returns.
 *
 * When mode is "redirect": calls Next.js redirect() — does not return.
 * When mode is "throw":    throws the provided AuthRequiredError.
 */
function applyFailure(
  error: AuthRequiredError,
  mode: AuthGuardFailureMode,
  loginPath: string,
  returnTo?: string
): never {
  if (mode === "redirect") {
    redirect(buildLoginUrl(loginPath, returnTo));
  }
  throw error;
}

/**
 * Cast a confirmed-authenticated AuthSession to the branded AuthenticatedSession.
 *
 * Only called after all guard checks pass — the cast is safe at this point.
 */
function asAuthenticated(session: AuthSession): AuthenticatedSession {
  return session as AuthenticatedSession;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXPORTED GUARD FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical route guard for protected Blackframe storefront routes.
 *
 * Reads the current auth session, validates whether the visitor meets the
 * access requirement, and returns the authenticated AuthSession on success.
 * Redirects or throws on denial, depending on onFailure setting.
 *
 * Standard usage — protect any route that requires login:
 *   const session = await requireAuth();
 *
 * With storefront context (preferred for storefront-scoped routes):
 *   const session = await requireAuth({ storefrontId: "sf_123" });
 *
 * With customer linkage requirement (e.g. /account/orders):
 *   const session = await requireAuth({
 *     storefrontId: "sf_123",
 *     requireCustomer: true,
 *     returnTo: "/account/orders",
 *   });
 *
 * With throw mode (for API routes or custom error handling):
 *   const session = await requireAuth({ onFailure: "throw" });
 */
export async function requireAuth(
  input?: RequireAuthInput
): Promise<AuthenticatedSession> {
  const failureMode: AuthGuardFailureMode = input?.onFailure ?? "redirect";
  const loginPath: string = input?.loginPath ?? "/login";
  const returnTo: string | undefined = input?.returnTo;
  const requireCustomer: boolean = input?.requireCustomer ?? false;
  const reason: string | undefined = input?.reason;

  // ── Step 1: Read the normalized auth session ───────────────────────────────
  // getSession is the single source of truth. We pass storefrontId when
  // available to enable precise storefront-scoped customer resolution.
  const session = await getSession(
    input?.storefrontId ? { storefrontId: input.storefrontId } : undefined
  );

  // ── Step 2: Check session error state ─────────────────────────────────────
  // identityState: "error" means the auth layer itself failed (token corrupt,
  // network issue). Treat as unauthenticated — do not grant access on
  // an indeterminate session.
  if (session.identityState === "error") {
    return applyFailure(
      new AuthRequiredError(
        "Auth session could not be established. Please sign in again.",
        "SESSION_ERROR",
        reason
      ),
      failureMode,
      loginPath,
      returnTo
    );
  }

  // ── Step 3: Authenticated check ───────────────────────────────────────────
  // isAuthenticated is true when status === "authenticated" and identityState
  // is "resolved" or "partial". Anonymous visitors are denied here.
  if (!session.isAuthenticated) {
    return applyFailure(
      new AuthRequiredError(
        "Authentication required. Please sign in to access this page.",
        "UNAUTHENTICATED",
        reason
      ),
      failureMode,
      loginPath,
      returnTo
    );
  }

  // ── Step 4: Optional customer linkage check ────────────────────────────────
  // Only enforced when requireCustomer is explicitly enabled.
  // A missing customer row is not an error for routes that only need auth —
  // but routes that depend on customer-facing data (orders, addresses, profile)
  // should enable this so they never render against a null customer.
  if (requireCustomer) {
    const customerMissing =
      session.customer === null ||
      session.customer.customerLinkState !== "linked";

    if (customerMissing) {
      return applyFailure(
        new AuthRequiredError(
          "A linked storefront customer account is required to access this page. " +
            "Your account may still be provisioning, or no customer record has been " +
            "created for this storefront yet.",
          "CUSTOMER_REQUIRED",
          reason
        ),
        failureMode,
        loginPath,
        returnTo
      );
    }
  }

  // ── Step 5: Grant access ───────────────────────────────────────────────────
  // All checks passed. Return the session with the authenticated brand applied.
  return asAuthenticated(session);
}
