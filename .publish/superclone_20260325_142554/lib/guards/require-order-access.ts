// ─────────────────────────────────────────────────────────────────────────────
// lib/guards/require-order-access.ts
//
// Route guard: protect order confirmation and order detail route access.
//
// Responsibilities:
//   1. Accept a typed access input including auth context and guest proof
//   2. Fetch the order through getOrderById
//   3. Verify the order exists
//   4. Evaluate whether the request context is allowed to access the order
//   5. Either return the normalized OrderSummary, redirect, or throw
//
// Supported access paths:
//   A) Authenticated ownership — auth user matched to order customer
//   B) Guest confirmation    — valid caller-provided guest access proof
//   C) Denied               — neither path can be established
//
// No normalization logic lives here.
// No mapper logic is duplicated here.
// No UI concerns exist here.
// No undocumented backend infrastructure is assumed.
//
// Guest access proof is modeled as an explicit caller input contract.
// Because the backend schema does not expose a dedicated guest-order-access
// token table, this guard validates proof against retrieved order/customer
// data honestly — matching email or order number to what the backend returned.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import {
  getOrderById,
  OrderNotFoundError,
  OrderFetchError,
} from "@/features/orders/lib/get-order-by-id";
import type { OrderSummary } from "@/features/orders/types/order.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOCAL ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when order access is denied and the caller requested throw-mode
 * failure rather than a redirect.
 */
export class OrderAccessGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ORDER_NOT_FOUND"
      | "ACCESS_DENIED"
      | "FETCH_FAILED"
      | "MISSING_ORDER_ID"
  ) {
    super(message);
    this.name = "OrderAccessGuardError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ACCESS PROOF AND INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticated session context provided by the calling layer.
 *
 * authUserId corresponds to the Supabase auth.users id for the
 * currently signed-in storefront customer. The guard uses this to
 * establish ownership by matching against the order's customer record.
 */
export interface OrderAuthContext {
  /** Supabase Auth user id of the currently authenticated visitor. */
  authUserId: string;
  /**
   * The storefront customers.id linked to this auth user, if already known.
   * When provided, ownership check uses this directly (more precise).
   * When null, the guard cannot confirm ownership without a confirmed
   * schema column linking customers → auth.users. Callers should provide
   * this whenever available.
   */
  customerId: string | null;
}

/**
 * Guest access proof provided by the calling layer.
 *
 * Because the backend does not expose a dedicated guest-order-access token
 * table, guest access is validated by matching caller-provided identity
 * proof against the order's resolved customer data.
 *
 * At least one of the following must be provided:
 *   - email (validated case-insensitively against order customer email)
 *   - email + orderNumber (strongest unauthenticated proof)
 *
 * If the calling layer has already performed a higher-trust verification
 * (e.g. signed email link confirmation), it may set trustedByCallerLayer
 * to signal this — but the guard still requires at least email to match.
 * This flag alone is never sufficient to grant access.
 */
export interface OrderGuestAccessProof {
  /**
   * Email address the guest claims to own.
   * Validated case-insensitively against the order customer email.
   */
  email: string | null;

  /**
   * Human-readable order number the guest provides (e.g. from a confirmation email).
   * Validated against the resolved order's orderNumber field.
   * Strengthens the proof when combined with email.
   */
  orderNumber: string | null;

  /**
   * When true, the calling layer asserts it has already performed a
   * higher-trust verification (e.g. signed email link, OTP confirmation).
   * The guard still requires at least email to match.
   * This flag alone is never sufficient to grant access.
   */
  trustedByCallerLayer?: boolean;
}

/**
 * Controls what happens when the guard denies order access.
 *
 * "redirect" — call Next.js redirect() to the provided fallbackPath.
 * "throw"    — throw an OrderAccessGuardError.
 */
export type OrderGuardFailureMode = "redirect" | "throw";

/**
 * Full typed input for requireOrderAccess.
 */
export interface RequireOrderAccessInput {
  /** Backend orders.id for the order being accessed. */
  orderId: string;

  /**
   * Authenticated session context, if a user is signed in.
   * Null when the visitor is accessing as a guest.
   */
  authContext: OrderAuthContext | null;

  /**
   * Guest access proof, if the visitor is not authenticated.
   * Null when authContext is provided (authenticated path takes precedence).
   */
  guestProof: OrderGuestAccessProof | null;

  /**
   * What to do when the guard denies access.
   * Defaults to "redirect" when not provided.
   */
  onFailure?: OrderGuardFailureMode;

  /**
   * Route to redirect to when onFailure is "redirect" and access is denied.
   * Defaults to "/" when not provided.
   */
  fallbackPath?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GUARD HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply the configured failure behavior.
 *
 * When mode is "redirect": calls Next.js redirect() — does not return.
 * When mode is "throw": throws the provided error.
 */
function applyFailure(
  error: OrderAccessGuardError,
  mode: OrderGuardFailureMode,
  fallbackPath: string
): never {
  if (mode === "redirect") {
    redirect(fallbackPath);
  }
  throw error;
}

/**
 * Path A: Authenticated ownership check.
 *
 * Grants access when the auth context can be matched to the order's
 * customer record. Two strategies, applied in priority order:
 *
 *   1. customerId match — direct and precise. Used when the caller
 *      supplies the backend customers.id already linked to this auth user.
 *
 *   2. customerId is null — ownership cannot be confirmed without a
 *      reliable schema column linking customers → auth.users. Access
 *      is denied rather than granted on a weak assumption.
 *
 * This is intentionally strict. Silent access grants on weak assumptions
 * are rejected.
 */
function evaluateAuthenticatedAccess(
  order: OrderSummary,
  authContext: OrderAuthContext
): boolean {
  if (
    authContext.customerId !== null &&
    authContext.customerId === order.customer.customerId
  ) {
    return true;
  }

  // customerId not provided or does not match — cannot confirm ownership.
  // authUserId alone is insufficient without a confirmed DB join column.
  return false;
}

/**
 * Path B: Guest access proof evaluation.
 *
 * Validates the caller-provided guest proof against the resolved order
 * and customer data. At least email must match.
 *
 * Strategy (applied in priority order):
 *   1. Email + order number match — strongest unauthenticated proof.
 *   2. Email-only match — acceptable for order confirmation access.
 *   3. Order number-only match — too weak on its own; rejected.
 *   4. No identity fields — denied regardless of trustedByCallerLayer.
 */
function evaluateGuestAccess(
  order: OrderSummary,
  proof: OrderGuestAccessProof
): boolean {
  const customerEmail = order.customer.email.trim().toLowerCase();
  const orderOrderNumber = order.orderNumber.trim();

  const proofEmail =
    proof.email !== null && proof.email.trim().length > 0
      ? proof.email.trim().toLowerCase()
      : null;

  const proofOrderNumber =
    proof.orderNumber !== null && proof.orderNumber.trim().length > 0
      ? proof.orderNumber.trim()
      : null;

  const emailMatches = proofEmail !== null && proofEmail === customerEmail;
  const orderNumberMatches =
    proofOrderNumber !== null && proofOrderNumber === orderOrderNumber;

  // Email + order number: strongest guest proof — grant immediately.
  if (emailMatches && orderNumberMatches) {
    return true;
  }

  // Email alone: acceptable identity signal for confirmation page access.
  if (emailMatches) {
    return true;
  }

  // Order number alone without email: too weak — denied.
  // trustedByCallerLayer without any matching identity field: denied.
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXPORTED GUARD FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Route guard for order confirmation and order detail pages.
 *
 * Fetches the order, verifies it exists, evaluates whether the current
 * request context is allowed to access it, and returns the normalized
 * OrderSummary when access is granted.
 *
 * Redirects or throws when access is denied — depending on onFailure setting.
 *
 * Usage — authenticated:
 *   const order = await requireOrderAccess({
 *     orderId: params.orderId,
 *     authContext: { authUserId: user.id, customerId: customer.id },
 *     guestProof: null,
 *     onFailure: "redirect",
 *     fallbackPath: "/account/orders",
 *   });
 *
 * Usage — guest:
 *   const order = await requireOrderAccess({
 *     orderId: params.orderId,
 *     authContext: null,
 *     guestProof: { email: submittedEmail, orderNumber: null },
 *     onFailure: "redirect",
 *     fallbackPath: "/",
 *   });
 */
export async function requireOrderAccess(
  input: RequireOrderAccessInput
): Promise<OrderSummary> {
  const mode: OrderGuardFailureMode = input.onFailure ?? "redirect";
  const fallbackPath: string = input.fallbackPath ?? "/";

  // ── 4.1 Validate orderId presence ─────────────────────────────────────────
  if (!input.orderId || input.orderId.trim() === "") {
    return applyFailure(
      new OrderAccessGuardError(
        "Cannot evaluate order access: orderId is required.",
        "MISSING_ORDER_ID"
      ),
      mode,
      fallbackPath
    );
  }

  // ── 4.2 Fetch the order ───────────────────────────────────────────────────
  let order: OrderSummary;

  try {
    order = await getOrderById(input.orderId);
  } catch (err) {
    if (err instanceof OrderNotFoundError) {
      return applyFailure(
        new OrderAccessGuardError(err.message, "ORDER_NOT_FOUND"),
        mode,
        fallbackPath
      );
    }

    if (err instanceof OrderFetchError) {
      return applyFailure(
        new OrderAccessGuardError(err.message, "FETCH_FAILED"),
        mode,
        fallbackPath
      );
    }

    return applyFailure(
      new OrderAccessGuardError(
        "An unexpected error occurred while fetching the order.",
        "FETCH_FAILED"
      ),
      mode,
      fallbackPath
    );
  }

  // ── 4.3 Evaluate access ───────────────────────────────────────────────────

  // Path A: Authenticated ownership.
  if (input.authContext !== null) {
    const owned = evaluateAuthenticatedAccess(order, input.authContext);

    if (owned) {
      return order;
    }

    // Authenticated but does not own this order — deny explicitly.
    return applyFailure(
      new OrderAccessGuardError(
        `Authenticated user does not have access to order "${input.orderId}".`,
        "ACCESS_DENIED"
      ),
      mode,
      fallbackPath
    );
  }

  // Path B: Guest confirmation access.
  if (input.guestProof !== null) {
    const proofValid = evaluateGuestAccess(order, input.guestProof);

    if (proofValid) {
      return order;
    }

    // Guest proof could not be validated against the order — deny explicitly.
    return applyFailure(
      new OrderAccessGuardError(
        `Guest access proof could not be validated for order "${input.orderId}".`,
        "ACCESS_DENIED"
      ),
      mode,
      fallbackPath
    );
  }

  // Path C: Neither auth context nor guest proof provided — deny.
  return applyFailure(
    new OrderAccessGuardError(
      `No access context provided for order "${input.orderId}". ` +
        "Supply either an authContext or a guestProof.",
      "ACCESS_DENIED"
    ),
    mode,
    fallbackPath
  );
}
