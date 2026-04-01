// ─────────────────────────────────────────────────────────────────────────────
// app/(auth)/auth/sign-out/route.ts
//
// Canonical storefront sign-out route handler — POST /auth/sign-out
//
// Responsibilities:
//   1. Call signOutAction to invalidate the Supabase session
//   2. Redirect the visitor to a safe post-sign-out path on success
//   3. Redirect to a safe fallback on failure — never leave the visitor stuck
//
// This is a route handler, not a page.
// Sign-out mutation is fully delegated to actions/auth/sign-out-action.ts.
// This file contains no auth teardown logic of its own.
//
// POST is used (not GET) because sign-out is a state-mutating operation.
// Triggering sign-out via a plain link (GET) risks unintentional sign-outs
// from prefetch, crawlers, and browser history replay.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { signOutAction } from "@/actions/auth/sign-out-action";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Safe destination after successful sign-out. */
const POST_SIGN_OUT_PATH = "/";

/** Safe fallback destination when sign-out fails. */
const SIGN_OUT_FAILURE_PATH = "/";

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<never> {
  // Extract an optional redirectTo from the POST body.
  // Callers may submit a form with a hidden redirectTo field to control
  // where the user lands after sign-out (e.g. back to the current storefront
  // page rather than the home route).
  let requestedRedirectTo: string | null = null;

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await request.formData();
      const raw = body.get("redirectTo");
      if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
        requestedRedirectTo = raw.trim();
      }
    }
  } catch {
    // Body parse failure is non-fatal — fall through to default path.
  }

  // Delegate to the sign-out action.
  // The action handles Supabase session teardown and returns a typed result.
  // It does not redirect — redirection is the route handler's responsibility.
  const result = await signOutAction({
    redirectTo: requestedRedirectTo ?? POST_SIGN_OUT_PATH,
    reason: "user_initiated",
  });

  if (result.ok) {
    redirect(result.redirectTo);
  }

  // Sign-out failed. Redirect to a safe fallback rather than surfacing a
  // raw error response. The session may already be invalid on the client;
  // a redirect prevents the visitor from being left on a broken state screen.
  redirect(SIGN_OUT_FAILURE_PATH);
}

