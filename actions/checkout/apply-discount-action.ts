"use server";

// ─────────────────────────────────────────────────────────────────────────────
// actions/checkout/apply-discount-action.ts
//
// Canonical checkout mutation for validating and staging a coupon code
// against the active checkout context.
//
// Execution sequence:
//   1. Normalize and structurally validate input
//   2. Re-load canonical CheckoutSession via getCheckoutSession
//   3. Validate base checkout conditions for discount evaluation
//   4. Fetch coupon row from the coupons table (storefront-scoped)
//   5. Validate coupon eligibility: status, time window, usage limits
//   6. Calculate safe discount amount against the server-side subtotal
//   7. Return a typed ApplyDiscountResult
//
// Important — no side effects on success:
//   This action does NOT increment coupon usage_count.
//   Usage is only incremented when an order is actually placed (place-order-action.ts).
//   Applying a discount here only validates and stages the coupon payload
//   for the checkout flow to include on the next canonical session read.
//
// There is no dedicated checkout_sessions table.
// "Applying" a discount here means: validate → return normalized coupon payload
// → let the calling layer re-request getCheckoutSession with couponCode included.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import {
  getCheckoutSession,
  type CheckoutCartItem,
  type CheckoutShippingOption,
  type CheckoutPaymentOption,
} from "@/features/checkout/lib/get-checkout-session";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT TYPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full typed input for applyDiscountAction.
 *
 * Represents a disciplined discount application request.
 * Every field is explicit and purposeful — not a raw UI blob.
 *
 * The checkout context fields (cartItems, shippingOptions, paymentOptions,
 * selectedShippingOptionId, selectedPaymentOptionId) are required because
 * this action re-reads the canonical CheckoutSession via getCheckoutSession,
 * which needs the full cart context to resolve pricing and assemble totals.
 * The server-side subtotal from that session is the only value trusted for
 * discount math — client-side totals are never used.
 */
export interface ApplyDiscountInput {
  // ── Session / storefront context ──────────────────────────────────────────
  /** Blackswan storefront id scoping this checkout. */
  storefrontId: string;
  /** Stable session id from the checkout session. */
  sessionId: string;

  // ── Coupon ────────────────────────────────────────────────────────────────
  /** The coupon code to validate. Will be normalized before lookup. */
  couponCode: string;

  // ── Customer / auth identity ──────────────────────────────────────────────
  /** Supabase Auth user id — null for guest checkout. */
  authUserId: string | null;
  /** Backend customers.id — null if not yet resolved. */
  customerId: string | null;
  /** Guest email — used for guest customer resolution. */
  guestEmail: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestPhone: string | null;

  // ── Cart ──────────────────────────────────────────────────────────────────
  /** The current cart — required to re-read the canonical CheckoutSession. */
  cartItems: CheckoutCartItem[];

  // ── Shipping ──────────────────────────────────────────────────────────────
  shippingOptions: CheckoutShippingOption[];
  selectedShippingOptionId: string | null;

  // ── Payment ───────────────────────────────────────────────────────────────
  paymentOptions: CheckoutPaymentOption[];
  selectedPaymentOptionId: string | null;

  // ── Optional ──────────────────────────────────────────────────────────────
  notes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RESULT / ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Machine-friendly error codes for every distinct failure path. */
export type ApplyDiscountErrorCode =
  // Input / structural failures
  | "INVALID_INPUT"
  | "EMPTY_COUPON_CODE"
  // Checkout session failures
  | "CHECKOUT_SESSION_ERROR"
  | "INVALID_CHECKOUT_CONTEXT"
  // Coupon lookup failures
  | "COUPON_NOT_FOUND"
  // Coupon eligibility failures
  | "COUPON_PAUSED"
  | "COUPON_EXPIRED_BY_STATUS"
  | "COUPON_NOT_YET_VALID"
  | "COUPON_EXPIRED_BY_DATE"
  | "COUPON_USAGE_LIMIT_REACHED"
  // Discount calculation failures
  | "DISCOUNT_PRODUCES_NO_EFFECT"
  | "DISCOUNT_EXCEEDS_SUBTOTAL"
  // Unexpected
  | "UNEXPECTED_ERROR";

/**
 * Normalized discount summary returned on a successful validation.
 * This is the payload the calling layer should pass to the next
 * getCheckoutSession call as couponCode to include the discount in
 * the canonical session totals.
 */
export interface ApplyDiscountSummary {
  /** The normalized (uppercased, trimmed) coupon code. */
  code: string;
  /** Human-readable discount label for display. */
  label: string;
  /** Absolute discount amount in the checkout currency. */
  discountAmount: number;
  /** Discount percent — populated only for percentage-type coupons. */
  discountPercent: number | null;
  /** ISO 4217 currency code matching the checkout session. */
  currency: string;
  /**
   * The raw discount_type from the backend coupons table.
   * Aligns exactly with the backend enum: "percentage" | "fixed".
   */
  discountType: "percentage" | "fixed";
}

export type ApplyDiscountResult =
  | ApplyDiscountSuccess
  | ApplyDiscountFailure;

export interface ApplyDiscountSuccess {
  ok: true;
  /** The validated, normalized coupon code. */
  couponCode: string;
  /** Normalized discount summary for the storefront to consume. */
  discount: ApplyDiscountSummary;
  /**
   * The calling layer should re-request the canonical CheckoutSession
   * with this couponCode included to reflect the discount in session totals.
   * Always true on success — discount application is stateless here.
   */
  shouldRefreshCheckout: true;
  /** User-safe confirmation message. */
  message: string;
}

export interface ApplyDiscountFailure {
  ok: false;
  code: ApplyDiscountErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Internal detail for logging — not for display. */
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INTERNAL ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

class ApplyDiscountError extends Error {
  constructor(
    public readonly code: ApplyDiscountErrorCode,
    message: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "ApplyDiscountError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// ── 4.1 Normalize coupon code ─────────────────────────────────────────────────

/**
 * Normalizes a raw coupon code string before lookup.
 *
 * Strategy:
 *   - Trim leading/trailing whitespace
 *   - Uppercase for case-insensitive matching
 *   - Collapse internal whitespace to a single space (prevents invisible
 *     space injection attacks and user typos with double-spaces)
 *
 * This normalization must be applied consistently — both here at input
 * and in the DB query — so that "SAVE10", "save10", and " Save10 " all
 * match the same backend record without requiring case-insensitive DB ops.
 *
 * The backend coupons.code column is assumed to store codes in uppercase.
 * If the backend normalizes to lowercase, flip toUpperCase() to toLowerCase().
 */
function normalizeCouponCode(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

// ── 4.2 Validate coupon time window ──────────────────────────────────────────

/**
 * Validates the coupon's starts_at / ends_at time window.
 * Returns a failure code and message if the window is invalid.
 * Returns null if the window is valid (or not set).
 *
 * This is called separately from status validation because:
 *   - The backend status field can say "active" while the window has expired.
 *   - We want a distinct error code for "not yet valid" vs "expired by date"
 *     vs "expired by status" — so the UI can surface the right message.
 */
function validateCouponWindow(
  coupon: RawCouponRow,
  now: Date
): { code: ApplyDiscountErrorCode; message: string } | null {
  if (coupon.starts_at !== null) {
    const startsAt = new Date(coupon.starts_at);
    if (startsAt > now) {
      return {
        code: "COUPON_NOT_YET_VALID",
        message: `This coupon is not valid yet. It becomes active on ${startsAt.toLocaleDateString()}.`,
      };
    }
  }

  if (coupon.ends_at !== null) {
    const endsAt = new Date(coupon.ends_at);
    if (endsAt < now) {
      return {
        code: "COUPON_EXPIRED_BY_DATE",
        message: "This coupon has expired.",
      };
    }
  }

  return null;
}

// ── 4.3 Validate coupon usage limits ─────────────────────────────────────────

/**
 * Validates that the coupon has not exceeded its usage limit.
 * Returns a failure descriptor if exhausted, null if still usable.
 */
function validateCouponUsage(
  coupon: RawCouponRow
): { code: ApplyDiscountErrorCode; message: string } | null {
  if (
    coupon.usage_limit !== null &&
    coupon.usage_count >= coupon.usage_limit
  ) {
    return {
      code: "COUPON_USAGE_LIMIT_REACHED",
      message: "This coupon has reached its usage limit and is no longer available.",
    };
  }
  return null;
}

// ── 4.4 Calculate safe discount amount ───────────────────────────────────────

/**
 * Calculates the safe, bounded discount amount given a coupon and a
 * server-side subtotal.
 *
 * Rules:
 *   - percentage: discountAmount = (discountPercent / 100) × subtotal,
 *     rounded to 2 decimal places
 *   - fixed: discountAmount = coupon.discount_value
 *   - In both cases: discountAmount must be > 0 and <= subtotal
 *     (a discount may not create a negative total)
 *
 * Throws ApplyDiscountError if the result produces no effect or exceeds
 * the subtotal (which would create a negative total before shipping).
 *
 * Note: the cap at subtotal is a safe default. If the business supports
 * discounts that also cover shipping, the cap should be raised to total.
 * That requires a backend schema change (shipping as a first-class field
 * on coupons) before being implemented here.
 */
function calculateDiscountAmount(
  coupon: RawCouponRow,
  subtotal: number
): number {
  let amount: number;

  if (coupon.discount_type === "percentage") {
    const percent = coupon.discount_value;
    if (percent <= 0 || percent > 100) {
      throw new ApplyDiscountError(
        "DISCOUNT_PRODUCES_NO_EFFECT",
        "This coupon does not produce a valid discount. Please try a different code.",
        `Invalid percentage value: ${percent}`
      );
    }
    // Round to 2 decimal places to avoid floating-point precision issues
    amount = Math.round((percent / 100) * subtotal * 100) / 100;
  } else {
    // fixed
    amount = coupon.discount_value;
  }

  if (amount <= 0) {
    throw new ApplyDiscountError(
      "DISCOUNT_PRODUCES_NO_EFFECT",
      "This coupon does not produce a valid discount for your current cart.",
      `Calculated discount amount is ${amount}`
    );
  }

  if (amount > subtotal) {
    throw new ApplyDiscountError(
      "DISCOUNT_EXCEEDS_SUBTOTAL",
      "This coupon's discount exceeds your cart subtotal.",
      `Discount amount ${amount} exceeds subtotal ${subtotal}`
    );
  }

  return amount;
}

// ── 4.5 Build failure result ──────────────────────────────────────────────────

function makeFailure(
  code: ApplyDiscountErrorCode,
  message: string,
  detail?: string
): ApplyDiscountFailure {
  return { ok: false, code, message, detail };
}

// ── 4.6 Build discount label ──────────────────────────────────────────────────

/**
 * Builds a human-readable discount label for display in the checkout UI.
 * Example outputs: "10% off" | "$15.00 off" | "15.50% off"
 */
function buildDiscountLabel(
  coupon: RawCouponRow,
  currency: string
): string {
  if (coupon.discount_type === "percentage") {
    return `${coupon.discount_value}% off`;
  }

  // Fixed: format as currency amount
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(coupon.discount_value);

  return `${formatted} off`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. RAW COUPON ROW TYPE
//
// Internal type representing only the columns fetched from the coupons table.
// Not exported — raw backend shapes do not leak beyond this file.
// ─────────────────────────────────────────────────────────────────────────────

interface RawCouponRow {
  id: string;
  storefront_id: string;
  operator_distributor_id: string | null;
  code: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  status: "active" | "paused" | "expired";
  usage_limit: number | null;
  usage_count: number;
  starts_at: string | null;
  ends_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. EXPORTED SERVER ACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a coupon code against the active checkout context and returns
 * a typed result the storefront can use to refresh the canonical checkout
 * session with the discount staged.
 *
 * This action is stateless on success: it validates only. The calling layer
 * must re-request getCheckoutSession with the returned couponCode to reflect
 * the discount in session totals. No coupon usage_count increment occurs here.
 */
export async function applyDiscountAction(
  input: ApplyDiscountInput
): Promise<ApplyDiscountResult> {
  try {
    // ── Step 1: Validate structural input ────────────────────────────────────
    if (!input.storefrontId?.trim()) {
      return makeFailure("INVALID_INPUT", "Storefront context is missing.");
    }
    if (!input.sessionId?.trim()) {
      return makeFailure("INVALID_INPUT", "Session context is missing.");
    }
    if (!input.cartItems || input.cartItems.length === 0) {
      return makeFailure(
        "INVALID_INPUT",
        "Your cart is empty. Please add items before applying a discount."
      );
    }
    if (!input.couponCode || !input.couponCode.trim()) {
      return makeFailure(
        "EMPTY_COUPON_CODE",
        "Please enter a coupon code."
      );
    }

    // ── Step 2: Normalize coupon code ─────────────────────────────────────────
    const normalizedCode = normalizeCouponCode(input.couponCode);

    // ── Step 3: Re-load canonical CheckoutSession ─────────────────────────────
    // Do NOT trust client-supplied totals. The subtotal used for discount math
    // must come from the server-side resolved session only.
    let session;
    const now = new Date();
    const nowIso = now.toISOString();

    try {
      session = await getCheckoutSession({
        storefrontId: input.storefrontId,
        sessionId: input.sessionId,
        authUserId: input.authUserId,
        customerId: input.customerId,
        guestEmail: input.guestEmail,
        guestFirstName: input.guestFirstName,
        guestLastName: input.guestLastName,
        guestPhone: input.guestPhone,
        cartItems: input.cartItems,
        shippingOptions: input.shippingOptions,
        selectedShippingOptionId: input.selectedShippingOptionId,
        paymentOptions: input.paymentOptions,
        selectedPaymentOptionId: input.selectedPaymentOptionId,
        // Pass null here — we validate the coupon ourselves below.
        // Passing the code to getCheckoutSession would trigger its own
        // coupon validation branch, which is redundant and removes control
        // over which error codes we return from this action.
        couponCode: null,
        notes: input.notes,
        checkoutState: "idle",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } catch (sessionError) {
      const detail =
        sessionError instanceof Error ? sessionError.message : String(sessionError);
      return makeFailure(
        "CHECKOUT_SESSION_ERROR",
        "Unable to load your checkout session. Please try again.",
        detail
      );
    }

    // ── Step 4: Validate base checkout conditions ─────────────────────────────
    // The checkout must be structurally sound enough to evaluate a discount
    // before we touch the coupons table.

    if (!session.storefrontId) {
      return makeFailure(
        "INVALID_CHECKOUT_CONTEXT",
        "Your checkout session is missing storefront context."
      );
    }

    if (!session.lineItems || session.lineItems.length === 0) {
      return makeFailure(
        "INVALID_CHECKOUT_CONTEXT",
        "Your cart appears to be empty. Please return to the cart and try again."
      );
    }

    if (!session.currency?.trim()) {
      return makeFailure(
        "INVALID_CHECKOUT_CONTEXT",
        "Unable to determine checkout currency. Please try again."
      );
    }

    const subtotal = session.totals.subtotal;
    if (subtotal <= 0) {
      return makeFailure(
        "INVALID_CHECKOUT_CONTEXT",
        "Your cart subtotal must be greater than zero to apply a discount."
      );
    }

    // ── Step 5: Fetch coupon from backend ─────────────────────────────────────
    // Query is storefront-scoped. Code is matched against the normalized value.
    // operator_distributor_id is also fetched so we can validate multi-tenant
    // scope alignment when an operatorDistributorId is present on the session.
    const supabase = await createClient();

    const { data: couponData, error: couponError } = await supabase
      .from("coupons")
      .select(
        "id, storefront_id, operator_distributor_id, code, discount_type, discount_value, status, usage_limit, usage_count, starts_at, ends_at"
      )
      .eq("storefront_id", input.storefrontId)
      .eq("code", normalizedCode)
      .maybeSingle();

    if (couponError) {
      return makeFailure(
        "COUPON_NOT_FOUND",
        "Unable to look up this coupon. Please try again.",
        couponError.message
      );
    }

    if (!couponData) {
      return makeFailure(
        "COUPON_NOT_FOUND",
        "This coupon code is not valid. Please check the code and try again."
      );
    }

    const coupon = couponData as RawCouponRow;

    // ── Step 6: Validate operator_distributor_id scope alignment ─────────────
    // If the session has an operatorDistributorId and the coupon has one set,
    // they must match. A coupon scoped to distributor A is not valid for
    // distributor B's checkout, even within the same storefront.
    //
    // If the coupon's operator_distributor_id is null, it is storefront-wide
    // and applies to all distributors on that storefront.
    if (
      coupon.operator_distributor_id !== null &&
      session.operatorDistributorId &&
      coupon.operator_distributor_id !== session.operatorDistributorId
    ) {
      return makeFailure(
        "COUPON_NOT_FOUND",
        "This coupon code is not valid for this checkout."
      );
    }

    // ── Step 7: Validate coupon status ────────────────────────────────────────
    // Evaluate status field first — distinct codes for paused vs expired.
    if (coupon.status === "paused") {
      return makeFailure(
        "COUPON_PAUSED",
        "This coupon is currently paused and cannot be applied."
      );
    }

    if (coupon.status === "expired") {
      return makeFailure(
        "COUPON_EXPIRED_BY_STATUS",
        "This coupon has expired."
      );
    }

    // status must now be "active" — but we still independently validate
    // the time window and usage, because an "active" status is necessary
    // but not sufficient: the backend may not auto-transition status to
    // "expired" when ends_at passes. Both checks must run.

    // ── Step 8: Validate time window ─────────────────────────────────────────
    const windowFailure = validateCouponWindow(coupon, now);
    if (windowFailure) {
      return makeFailure(windowFailure.code, windowFailure.message);
    }

    // ── Step 9: Validate usage limits ────────────────────────────────────────
    const usageFailure = validateCouponUsage(coupon);
    if (usageFailure) {
      return makeFailure(usageFailure.code, usageFailure.message);
    }

    // ── Step 10: Calculate discount amount ───────────────────────────────────
    let discountAmount: number;
    try {
      discountAmount = calculateDiscountAmount(coupon, subtotal);
    } catch (calcError) {
      if (calcError instanceof ApplyDiscountError) {
        return makeFailure(calcError.code, calcError.message, calcError.detail);
      }
      throw calcError;
    }

    // ── Step 11: Build and return success result ──────────────────────────────
    const label = buildDiscountLabel(coupon, session.currency);

    const discount: ApplyDiscountSummary = {
      code: normalizedCode,
      label,
      discountAmount,
      discountPercent:
        coupon.discount_type === "percentage" ? coupon.discount_value : null,
      currency: session.currency,
      discountType: coupon.discount_type,
    };

    return {
      ok: true,
      couponCode: normalizedCode,
      discount,
      shouldRefreshCheckout: true,
      message: `Coupon "${normalizedCode}" applied — ${label}.`,
    };
  } catch (unexpected) {
    const detail =
      unexpected instanceof Error ? unexpected.message : String(unexpected);
    return makeFailure(
      "UNEXPECTED_ERROR",
      "An unexpected error occurred. Please try again.",
      detail
    );
  }
}
