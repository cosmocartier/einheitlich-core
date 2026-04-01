// ─────────────────────────────────────────────────────────────────────────────
// app/(auth)/auth/sign-up-success/page.tsx
//
// Canonical post-sign-up success route — /auth/sign-up-success
//
// Responsibilities:
//   1. Render AuthPageShell
//   2. Render AuthSuccessMessage inside the shell
//
// This route is intentionally stateless. It is reached after sign-up-action
// either redirects here directly (email confirmation required) or after
// Supabase's email confirmation link resolves.
//
// This page does NOT:
//   - perform any auth mutation
//   - redirect based on auth state
//   - poll for email confirmation
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { AuthPageShell } from "@/features/auth/components/auth-page-shell";
import { AuthSuccessMessage } from "@/features/auth/components/auth-success-message";

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Account Created",
  robots: { index: false, follow: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function SignUpSuccessPage() {
  return (
    <AuthPageShell>
      <AuthSuccessMessage />
    </AuthPageShell>
  );
}

