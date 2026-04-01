// ─────────────────────────────────────────────────────────────────────────────
// lib/guards/require-checkout-session.ts
//
// Route guard: protect checkout route entry.
//
// Responsibilities:
//   1. Accept a typed checkout context input
//   2. Validate basic structural preconditions before calling getCheckoutSession
//   3. Call getCheckoutSession and receive a normalized CheckoutSession
//   4. Evaluate whether the session is usable enough to enter the checkout route
//   5. Either return the CheckoutSession, redirect, or throw
//
// No normalization logic lives here.
// No mapper logic is duplicated here.
// No UI concerns exist here.
// No fake checkout_sessions table is assumed.
//
// This guard sits between the route layer and the data/mapper layer.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import {
  getCheckoutSession,
  CheckoutSessionError,
  type GetCheckoutSessionInput,
} from "@/features/checkout/lib/get-checkout-session";
import type { CheckoutSession } from "@/features/checkout/types/checkout.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOCAL ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when checkout session entry is denied and the caller requested
 * throw-mode failure rather than a redirect.
 */
export class CheckoutSessionGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "EMPTY_CART"
      | "MISSING_STOREFRONT"
      | "MISSING_SESSION_ID"
      | "SESSION_UNUSABLE"
      | "FETCH_FAILED"
  ) {
    super(message);
    this.name = "CheckoutSessionGuardError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INPUT CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Controls what happens when the guard denies checkout route entry.
 *
 * "redirect" — call Next.js redirect() to the provided fallbackPath.
 * "throw"    — throw a CheckoutSessionGuardError.
 */
export type CheckoutGuardFailureMode = "redirect" | "throw";

/**
 * Full typed input for requireCheckoutSession.
 *
 * Composes the GetCheckoutSessionInput (the checkout data contract) with
 * guard-specific behavior controls.
 */
export interface RequireCheckoutSessionInput {
  /** The full checkout context required to assemble the session. */
  checkout: GetCheckoutSessionInput;

  /**
   * What to do when the guard denies entry.
   * Defaults to "redirect" when not provided.
   */
  onFailure?: CheckoutGuardFailureMode;

  /**
   * Route to redirect to when onFailure is "redirect" and the guard denies entry.
   * Defaults to "/cart" when not provided.
   */
  fallbackPath?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GUARD HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate whether the cart input is minimally valid before calling
 * getCheckoutSession. Catches obvious structural failures early
 * so the guard can fail fast without hitting the database.
 */
function assertCartInput(
  checkout: GetCheckoutSessionInput
): CheckoutSessionGuardError | null {
  if (!checkout.storefrontId || checkout.storefrontId.trim() === "") {
    return new CheckoutSessionGuardError(
      "Cannot enter checkout: storefrontId is required.",
      "MISSING_STOREFRONT"
    );
  }

  if (!checkout.sessionId || checkout.sessionId.trim() === "") {
    return new CheckoutSessionGuardError(
      "Cannot enter checkout: sessionId is required.",
      "MISSING_SESSION_ID"
    );
  }

  if (!checkout.cartItems || checkout.cartItems.length === 0) {
    return new CheckoutSessionGuardError(
      "Cannot enter checkout: cart is empty.",
      "EMPTY_CART"
    );
  }

  return null;
}

/**
 * Evaluate whether the normalized CheckoutSession returned by getCheckoutSession
 * is structurally usable for route entry.
 *
 * This is NOT a payment-readiness check. It is a structural existence check —
 * the session must have resolved line items and a valid storefront context.
 */
function assertSessionUsable(
  session: CheckoutSession
): CheckoutSessionGuardError | null {
  if (!session.storefrontId || session.storefrontId.trim() === "") {
    return new CheckoutSessionGuardError(
      "Checkout session is missing a storefront context.",
      "SESSION_UNUSABLE"
    );
  }

  if (!session.lineItems || session.lineItems.length === 0) {
    return new CheckoutSessionGuardError(
      "Checkout session contains no resolved line items.",
      "SESSION_UNUSABLE"
    );
  }

  return null;
}

/**
 * Apply the configured failure behavior.
 *
 * When mode is "redirect": calls Next.js redirect() — does not return.
 * When mode is "throw": throws the provided error.
 */
function applyFailure(
  error: CheckoutSessionGuardError,
  mode: CheckoutGuardFailureMode,
  fallbackPath: string
): never {
  if (mode === "redirect") {
    redirect(fallbackPath);
  }
  throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXPORTED GUARD FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Route guard for the checkout page.
 *
 * Validates the checkout context, calls getCheckoutSession, and evaluates
 * whether the resulting session is usable for checkout route entry.
 *
 * Returns a normalized CheckoutSession when access is granted.
 * Redirects or throws when access is denied — depending on onFailure setting.
 *
 * Usage:
 *   const session = await requireCheckoutSession({
 *     checkout: input,
 *     onFailure: "redirect",
 *     fallbackPath: "/cart",
 *   });
 */
export async function requireCheckoutSession(
  input: RequireCheckoutSessionInput
): Promise<CheckoutSession> {
  const mode: CheckoutGuardFailureMode = input.onFailure ?? "redirect";
  const fallbackPath: string = input.fallbackPath ?? "/cart";

  // ── 4.1 Fast structural pre-check ─────────────────────────────────────────
  const inputError = assertCartInput(input.checkout);
  if (inputError !== null) {
    return applyFailure(inputError, mode, fallbackPath);
  }

  // ── 4.2 Assemble checkout session ─────────────────────────────────────────
  let session: CheckoutSession;

  try {
    session = await getCheckoutSession(input.checkout);
  } catch (err) {
    if (err instanceof CheckoutSessionError) {
      // Map CheckoutSessionError codes to guard failure codes where meaningful.
      const code: CheckoutSessionGuardError["code"] =
        err.code === "EMPTY_CART"
          ? "EMPTY_CART"
          : err.code === "STOREFRONT_NOT_FOUND"
          ? "MISSING_STOREFRONT"
          : "FETCH_FAILED";

      return applyFailure(
        new CheckoutSessionGuardError(err.message, code),
        mode,
        fallbackPath
      );
    }

    // Unknown / unexpected error — surface as a fetch failure.
    return applyFailure(
      new CheckoutSessionGuardError(
        "An unexpected error occurred while assembling the checkout session.",
        "FETCH_FAILED"
      ),
      mode,
      fallbackPath
    );
  }

  // ── 4.3 Evaluate session usability ────────────────────────────────────────
  const usabilityError = assertSessionUsable(session);
  if (usabilityError !== null) {
    return applyFailure(usabilityError, mode, fallbackPath);
  }

  // ── 4.4 Access granted ────────────────────────────────────────────────────
  return session;
}
