"use client";

// ─────────────────────────────────────────────────────────────────────────────
// features/auth/components/login-form.tsx
//
// Storefront login form for Blackframe.
//
// Wires directly to actions/auth/sign-in-action.ts.
// No Supabase calls. No auth mutation logic. Presentation only.
// ─────────────────────────────────────────────────────────────────────────────

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { signInAction } from "@/actions/auth/sign-in-action";
import type { SignInResult } from "@/actions/auth/sign-in-action";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginFormProps {
  /** Destination path to redirect to after successful sign-in. */
  redirectTo?: string | null;
  /** Override the default form heading. */
  title?: string;
  /** Optional short description rendered below the heading. */
  description?: string;
  /** Override the default submit button label. */
  submitLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action wrapper
//
// useActionState expects a function with signature:
//   (prevState: State, formData: FormData) => Promise<State>
//
// We wrap signInAction to match that shape, extracting form values
// and delegating entirely to the action — no mutation logic here.
// ─────────────────────────────────────────────────────────────────────────────

type FormState = SignInResult | null;

async function loginFormAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const redirectTo = formData.get("redirectTo");

  return signInAction({
    email: typeof email === "string" ? email : "",
    password: typeof password === "string" ? password : "",
    redirectTo: typeof redirectTo === "string" && redirectTo.trim() ? redirectTo.trim() : null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LoginForm
// ─────────────────────────────────────────────────────────────────────────────

export function LoginForm({
  redirectTo = null,
  title = "Sign in to your account",
  description,
  submitLabel = "Sign in",
}: LoginFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    loginFormAction,
    null
  );

  // Handle successful sign-in: redirect if a path was returned
  const redirectHandled = useRef(false);
  if (state?.ok && !redirectHandled.current) {
    redirectHandled.current = true;
    const destination = state.redirectTo ?? redirectTo ?? "/account";
    router.push(destination);
  }

  const errorMessage =
    state && !state.ok ? state.message : null;

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Heading area */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>

      <form action={formAction} noValidate className="space-y-5">
        {/* Hidden redirect target */}
        {redirectTo && (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        )}

        {/* Email field */}
        <div className="space-y-1.5">
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-foreground"
          >
            Email address
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={isPending}
            placeholder="you@example.com"
            className="
              block w-full rounded-md border border-input bg-background
              px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground
              ring-offset-background
              focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1
              disabled:cursor-not-allowed disabled:opacity-50
              transition-colors
            "
          />
        </div>

        {/* Password field */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-foreground"
            >
              Password
            </label>
            {/* Forgot password — placeholder only, not yet implemented */}
            <span className="text-xs text-muted-foreground select-none">
              Forgot password? {/* TODO: wire to password reset flow */}
            </span>
          </div>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={isPending}
            className="
              block w-full rounded-md border border-input bg-background
              px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground
              ring-offset-background
              focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1
              disabled:cursor-not-allowed disabled:opacity-50
              transition-colors
            "
          />
        </div>

        {/* Error surface */}
        {errorMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="
              rounded-md border border-destructive/30 bg-destructive/5
              px-3.5 py-3 text-sm text-destructive leading-relaxed
            "
          >
            {errorMessage}
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={isPending}
          className="
            w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium
            text-primary-foreground
            hover:bg-primary/90 active:bg-primary/95
            focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1
            disabled:cursor-not-allowed disabled:opacity-60
            transition-colors
          "
        >
          {isPending ? <SubmittingIndicator /> : submitLabel}
        </button>
      </form>

      {/* Secondary helper area */}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {"Don't have an account? "}
        <a
          href="/auth/sign-up"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors"
        >
          Create account
        </a>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────────────

function SubmittingIndicator() {
  return (
    <span className="flex items-center justify-center gap-2">
      <svg
        className="h-4 w-4 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"
        />
      </svg>
      Signing in…
    </span>
  );
}
