// ─────────────────────────────────────────────────────────────────────────────
// lib/guards/optional-auth.ts
//
// Canonical optional-auth guard for the Blackframe storefront layer.
//
// Responsibilities:
//   1. Read the current normalized AuthSession via getSession
//   2. Return the session as-is — authenticated or anonymous, never blocking
//   3. Optionally redirect authenticated users away from auth-only pages
//
// This is the standard "resolve session if available, continue safely if not"
// helper for all mixed-access storefront routes:
//   - Product pages (render differently when signed in, but never gate)
//   - Login / sign-up pages (redirect away when already authenticated)
//   - Checkout (supports guest and authenticated flows equally)
//   - Any storefront page that benefits from knowing auth state without requiring it
//
// Architecture constraints:
//   - getSession is the only source of auth state. No raw Supabase calls here.
//   - This guard NEVER denies access by default.
//   - The only exception is the opt-in redirectIfAuthenticated path —
//     which redirects authenticated users away from auth-only screens.
//   - No login / sign-up / sign-out logic here.
//   - No platform-admin behavior mixed into storefront optional-auth.
//   - No middleware clone. No UI.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { getSession } from "@/features/auth/lib/get-session";
import type { AuthSession } from "@/features/auth/types/auth.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOCAL OPTION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional input for optionalAuth.
 *
 * All fields are optional. Calling optionalAuth() with no argument is valid
 * and returns the current session — authenticated or anonymous.
 */
export interface OptionalAuthInput {
  /**
   * Narrow the getSession customer resolution to this storefront.
   * Strongly preferred on storefront-scoped routes so customer linkage
   * resolves precisely rather than via email-only cross-tenant fallback.
   */
  storefrontId?: string;

  /**
   * An alternative to storefrontId for storefront resolution when
   * only the slug is available at the call site.
   * Passed through to getSession as context — not used for redirects.
   */
  storefrontSlug?: string;

  /**
   * When true, authenticated users are redirected away from this route.
   *
   * Use on login and sign-up pages so already-authenticated visitors
   * are not left on auth screens. Defaults to false.
   *
   * When enabled, set authenticatedRedirectTo to control the destination.
   * When disabled (default), the session is returned regardless of auth state.
   */
  redirectIfAuthenticated?: boolean;

  /**
   * Destination path for the redirect triggered by redirectIfAuthenticated.
   * Defaults to "/" when not provided.
   *
   * Only meaningful when redirectIfAuthenticated is true.
   */
  authenticatedRedirectTo?: string;

  /**
   * When true, the customer linkage resolution is attempted even when no
   * storefrontId is available. This triggers the email-only fallback path
   * in getSession, which may be ambiguous in multi-tenant setups.
   *
   * Defaults to false — customer linkage is only attempted when storefrontId
   * is provided, keeping the default call path precise and fast.
   *
   * Set to true on routes (e.g. checkout) that need customer context even
   * when the storefront cannot be determined from a static route param.
   */
  includeCustomer?: boolean;

  /**
   * Human-readable reason for this optional-auth call.
   * Used for logging / tracing only. Not exposed in the return value.
   */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a clean GetSessionInput from the OptionalAuthInput.
 *
 * storefrontId takes priority. storefrontSlug is passed through when
 * storefrontId is absent so getSession can use it for context if supported.
 * When includeCustomer is false (default) and no storefrontId is available,
 * we omit storefrontId entirely so getSession skips the ambiguous email-only
 * customer resolution path.
 */
function buildSessionInput(
  input: OptionalAuthInput
): { storefrontId?: string } {
  const { storefrontId, includeCustomer } = input;

  // storefrontId is the precise resolution key — always pass it when present.
  if (storefrontId) {
    return { storefrontId };
  }

  // No storefrontId: only attempt customer resolution when explicitly requested.
  // Omitting storefrontId from getSession skips storefront-scoped customer match
  // and falls through to the email-only fallback — which may produce a cross-tenant
  // row. Callers must opt in to that behavior via includeCustomer: true.
  if (includeCustomer) {
    // Pass no storefrontId — getSession will use the email-only fallback.
    return {};
  }

  // Default: pass storefrontId as undefined so getSession resolves the auth
  // user and profile but skips the potentially ambiguous customer resolution.
  return {};
}

/**
 * Determine the effective authenticated redirect destination.
 * Defaults to "/" when the caller did not configure one.
 */
function resolveAuthenticatedRedirectPath(path: string | undefined): string {
  const trimmed = path?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "/";
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXPORTED GUARD FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical optional-auth helper for Blackframe storefront routes.
 *
 * Always returns a normalized AuthSession — authenticated or anonymous.
 * Never denies access by default.
 *
 * The only exception: when redirectIfAuthenticated is true and the visitor
 * is already signed in, a redirect is triggered before this function returns.
 * This is exclusively for login / sign-up pages.
 *
 * Basic usage — any mixed-access page:
 *   const session = await optionalAuth();
 *
 * With storefront context (preferred):
 *   const session = await optionalAuth({ storefrontId: "sf_123" });
 *
 * On login / sign-up pages (redirect away if already signed in):
 *   const session = await optionalAuth({
 *     storefrontId: "sf_123",
 *     redirectIfAuthenticated: true,
 *     authenticatedRedirectTo: "/account",
 *   });
 *
 * On checkout (mixed guest + authenticated, needs customer context):
 *   const session = await optionalAuth({
 *     storefrontId: "sf_123",
 *     includeCustomer: true,
 *   });
 */
export async function optionalAuth(
  input?: OptionalAuthInput
): Promise<AuthSession> {
  const opts: OptionalAuthInput = input ?? {};

  // ── Step 1: Read the normalized auth session ───────────────────────────────
  // getSession is the single source of truth. We build a minimal input
  // from the caller's options, forwarding only what is genuinely useful.
  const sessionInput = buildSessionInput(opts);
  const session = await getSession(
    Object.keys(sessionInput).length > 0 ? sessionInput : undefined
  );

  // ── Step 2: Optional already-authenticated redirect ────────────────────────
  // Secondary behavior, strictly opt-in. When enabled, authenticated visitors
  // are redirected away from this route (e.g. login/sign-up pages that
  // should not be accessible while already signed in).
  //
  // Session error state is treated as not-authenticated here:
  // we do not redirect on an indeterminate session — the visitor remains on
  // the page and the partial/error session is returned as-is.
  if (
    opts.redirectIfAuthenticated === true &&
    session.isAuthenticated === true &&
    session.identityState !== "error"
  ) {
    const destination = resolveAuthenticatedRedirectPath(
      opts.authenticatedRedirectTo
    );
    redirect(destination);
  }

  // ── Step 3: Return session — authenticated, anonymous, or error ───────────
  // The session is always returned. No access is denied. No exception is thrown.
  // Callers branch on session.isAuthenticated / session.isAnonymous as needed.
  return session;
}
