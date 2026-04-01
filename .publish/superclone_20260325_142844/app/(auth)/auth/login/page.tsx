import type { Metadata } from "next";
import { optionalAuth } from "@/lib/guards/optional-auth";
import { AuthPageShell } from "@/features/auth/components/auth-page-shell";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = {
  title: "Sign In",
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ?? {};

  await optionalAuth({
    redirectIfAuthenticated: true,
    authenticatedRedirectTo: "/account",
    reason: "login-page",
  });

  const rawReturnTo =
    typeof params.returnTo === "string" ? params.returnTo.trim() : null;

  const returnTo =
    rawReturnTo && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : undefined;

  return (
    <AuthPageShell>
      <LoginForm redirectTo={returnTo} />
    </AuthPageShell>
  );
}