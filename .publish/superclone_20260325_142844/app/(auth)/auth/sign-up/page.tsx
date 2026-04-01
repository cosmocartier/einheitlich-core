// ─────────────────────────────────────────────────────────────────────────────
// app/(auth)/auth/sign-up/page.tsx
//
// Canonical storefront sign-up route — /auth/sign-up
//
// Responsibilities:
//   1. Call optionalAuth with redirectIfAuthenticated so already-signed-in
//      visitors are sent to /account rather than shown the sign-up screen
//   2. Render AuthPageShell
//   3. Render SignUpForm inside the shell, forwarding returnTo if present
//
// This page does NOT contain sign-up mutation logic.
// Sign-up is handled by actions/auth/sign-up-action.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { optionalAuth } from "@/lib/guards/optional-auth";
import { AuthPageShell } from "@/features/auth/components/auth-page-shell";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Create Account",
  robots: { index: false, follow: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page props
// ─────────────────────────────────────────────────────────────────────────────

interface SignUpPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  // 1. Resolve searchParams (Next.js 16 — async)
  const params = await searchParams;

  // 2. Resolve optional session — redirect already-authenticated users away.
  //    Authenticated visitors have no reason to be on the sign-up screen;
  //    send them to /account. Session error state is treated as anonymous
  //    so a broken token does not redirect the user into an infinite loop.
  await optionalAuth({
    redirectIfAuthenticated: true,
    authenticatedRedirectTo: "/account",
    reason: "sign-up-page",
  });

  // 3. Extract an optional returnTo path from the query string.
  //    Passed into SignUpForm so it can forward the intended destination
  //    to sign-up-action for post-registration redirect resolution.
  //    Validated as a relative path — absolute URLs are ignored.
  const rawReturnTo = typeof params.returnTo === "string" ? params.returnTo.trim() : null;
  const returnTo =
    rawReturnTo && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null;

  // 4. Render shell + form
  return (
    <AuthPageShell>
      <SignUpForm returnTo={returnTo} />
    </AuthPageShell>
  );
}

