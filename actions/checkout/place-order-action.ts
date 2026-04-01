"use server";

// ─────────────────────────────────────────────────────────────────────────────
// actions/checkout/place-order-action.ts
//
// Canonical write path for placing an order from a normalized checkout session.
// This is the transactional heart of Blackframe checkout.
//
// Execution sequence (each step only runs if all prior steps succeed):
//   1. Validate input structure
//   2. Re-load canonical CheckoutSession via getCheckoutSession
//   3. Validate place-order readiness (stock, address, payment, state)
//   4. Resolve or create customer record
//   5. Generate order number
//   6. Persist order row
//   7. Persist order items
//   8. Persist payment intent
//   9. Increment coupon usage (only after all writes succeed)
//  10. Trigger Blackswan integration hook
//  11. Return typed result
//
// Supabase does not expose explicit transaction primitives from the client
// SDK. Writes are sequenced defensively — later failures return controlled
// errors. Full two-phase rollback requires a Postgres function (RPC) and
// can be extracted here when needed. The sequence is structured to make
// that extraction straightforward.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import {
  getCheckoutSession,
  type CheckoutCartItem,
  type CheckoutShippingOption,
  type CheckoutPaymentOption,
} from "@/features/checkout/lib/get-checkout-session";
import type {
  CheckoutSession,
  CheckoutPaymentProvider,
} from "@/features/checkout/types/checkout.types";
import type { OrderStatusReference } from "@/features/orders/types/order.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT / RESULT / ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A single line item in the placement request — mirrors the cart payload. */
export interface PlaceOrderCartItem extends CheckoutCartItem {}

/** A shipping option passed through from the active checkout context. */
export interface PlaceOrderShippingOption extends CheckoutShippingOption {}

/** A payment option passed through from the active checkout context. */
export interface PlaceOrderPaymentOption extends CheckoutPaymentOption {}

/**
 * The full typed input for placeOrderAction.
 *
 * Design intent: this represents a disciplined order-placement request,
 * not a raw UI blob. Every field is explicit and purposeful.
 */
export interface PlaceOrderInput {
  // ── Session / storefront context ──────────────────────────────────────────
  /** Blackswan storefront id scoping this order. */
  storefrontId: string;
  /** Stable session id from the checkout session. */
  sessionId: string;

  // ── Customer / auth identity ──────────────────────────────────────────────
  /** Supabase Auth user id — null for guest checkout. */
  authUserId: string | null;
  /** Backend customers.id — null if not yet resolved. */
  customerId: string | null;
  /** Guest email — required when authUserId is null. */
  guestEmail: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestPhone: string | null;

  // ── Cart ──────────────────────────────────────────────────────────────────
  cartItems: PlaceOrderCartItem[];

  // ── Shipping ──────────────────────────────────────────────────────────────
  shippingOptions: PlaceOrderShippingOption[];
  selectedShippingOptionId: string | null;

  // ── Payment ───────────────────────────────────────────────────────────────
  paymentOptions: PlaceOrderPaymentOption[];
  selectedPaymentOptionId: string | null;

  // ── Optional context ──────────────────────────────────────────────────────
  couponCode: string | null;
  notes: string | null;

  /**
   * Idempotency key — caller-generated UUID to deduplicate concurrent or
   * retry submissions. Not yet enforced at DB level, but threaded through
   * the action so enforcement can be added later without API changes.
   */
  idempotencyKey: string | null;

  /**
   * Redirect / return URL hints for downstream payment provider handling.
   * Passed to the Blackswan integration hook — not used internally.
   */
  returnUrl: string | null;
  cancelUrl: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MACHINE-FRIENDLY ERROR CODES
// ─────────────────────────────────────────────────────────────────────────────

export type PlaceOrderErrorCode =
  // Input / structural failures
  | "INVALID_INPUT"
  | "EMPTY_CART"
  // Session / checkout resolution failures
  | "CHECKOUT_SESSION_ERROR"
  | "STOREFRONT_NOT_PLACEABLE"
  // Readiness validation failures
  | "NO_LINE_ITEMS"
  | "MISSING_CURRENCY"
  | "INSUFFICIENT_CUSTOMER_INFO"
  | "INSUFFICIENT_SHIPPING_ADDRESS"
  | "NO_SHIPPING_METHOD_SELECTED"
  | "SHIPPING_METHOD_UNAVAILABLE"
  | "NO_PAYMENT_METHOD_SELECTED"
  | "PAYMENT_METHOD_UNAVAILABLE"
  | "LINE_ITEM_OUT_OF_STOCK"
  | "CHECKOUT_NOT_READY"
  // Write failures
  | "CUSTOMER_RESOLVE_ERROR"
  | "ORDER_CREATE_ERROR"
  | "ORDER_ITEMS_CREATE_ERROR"
  | "PAYMENT_INTENT_CREATE_ERROR"
  // Unexpected
  | "UNEXPECTED_ERROR";

// ─────────────────────────────────────────────────────────────────────────────
// 3. RESULT TYPE
// ─────────────────────────────────────────────────────────────────────────────

export type PlaceOrderResult =
  | PlaceOrderSuccess
  | PlaceOrderFailure;

export interface PlaceOrderSuccess {
  ok: true;
  orderId: string;
  orderNumber: string;
  paymentIntentId: string;
  /** Provider resolved from the selected payment method. */
  provider: CheckoutPaymentProvider;
  /**
   * URL the payment layer should redirect to, if applicable.
   * Populated by the Blackswan integration hook when a redirect flow is needed.
   * Null for synchronous / manual payment flows.
   */
  redirectUrl: string | null;
}

export interface PlaceOrderFailure {
  ok: false;
  code: PlaceOrderErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Internal detail for logging — not for display. */
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. INTERNAL ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

class PlaceOrderError extends Error {
  constructor(
    public readonly code: PlaceOrderErrorCode,
    message: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "PlaceOrderError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// ── 5.1 Validate input structure ─────────────────────────────────────────────

function validateInput(input: PlaceOrderInput): void {
  if (!input.storefrontId?.trim()) {
    throw new PlaceOrderError("INVALID_INPUT", "storefrontId is required.");
  }
  if (!input.sessionId?.trim()) {
    throw new PlaceOrderError("INVALID_INPUT", "sessionId is required.");
  }
  if (!input.cartItems || input.cartItems.length === 0) {
    throw new PlaceOrderError(
      "EMPTY_CART",
      "Your cart is empty. Please add items before placing an order."
    );
  }
  // Guest checkout requires at minimum an email address.
  if (!input.authUserId && !input.guestEmail?.trim()) {
    throw new PlaceOrderError(
      "INVALID_INPUT",
      "An email address is required to place an order."
    );
  }
}

// ── 5.2 Validate place-order readiness ───────────────────────────────────────

/**
 * Validates the normalized CheckoutSession is in a safe-to-place state.
 * All checks must pass before any write is attempted.
 * Throws PlaceOrderError with a specific code on the first failure.
 */
function validatePlaceOrderReadiness(session: CheckoutSession): void {
  // Line items must exist
  if (!session.lineItems || session.lineItems.length === 0) {
    throw new PlaceOrderError(
      "NO_LINE_ITEMS",
      "Your cart appears to be empty. Please return to the cart and try again."
    );
  }

  // Currency must be present
  if (!session.currency?.trim()) {
    throw new PlaceOrderError(
      "MISSING_CURRENCY",
      "Unable to determine order currency. Please try again."
    );
  }

  // Customer info must be sufficient
  const customer = session.customer;
  if (!customer) {
    throw new PlaceOrderError(
      "INSUFFICIENT_CUSTOMER_INFO",
      "Customer information is missing. Please complete your details and try again."
    );
  }
  if (!customer.email?.trim()) {
    throw new PlaceOrderError(
      "INSUFFICIENT_CUSTOMER_INFO",
      "An email address is required to place an order."
    );
  }
  if (!customer.firstName?.trim() || !customer.lastName?.trim()) {
    throw new PlaceOrderError(
      "INSUFFICIENT_CUSTOMER_INFO",
      "Your first and last name are required to place an order."
    );
  }

  // Shipping address must be sufficiently present
  const shippingAddress = customer.shippingAddress;
  if (
    !shippingAddress ||
    !shippingAddress.addressLine1?.trim() ||
    !shippingAddress.city?.trim() ||
    !shippingAddress.country?.trim() ||
    !shippingAddress.postalCode?.trim()
  ) {
    throw new PlaceOrderError(
      "INSUFFICIENT_SHIPPING_ADDRESS",
      "A complete shipping address is required. Please check your address details."
    );
  }

  // A shipping method must be selected
  if (!session.selectedShippingMethod) {
    throw new PlaceOrderError(
      "NO_SHIPPING_METHOD_SELECTED",
      "Please select a shipping method before placing your order."
    );
  }
  if (!session.selectedShippingMethod.available) {
    throw new PlaceOrderError(
      "SHIPPING_METHOD_UNAVAILABLE",
      "The selected shipping method is no longer available. Please choose another."
    );
  }

  // A payment method must be selected
  if (!session.selectedPaymentMethod) {
    throw new PlaceOrderError(
      "NO_PAYMENT_METHOD_SELECTED",
      "Please select a payment method before placing your order."
    );
  }
  if (!session.selectedPaymentMethod.available) {
    throw new PlaceOrderError(
      "PAYMENT_METHOD_UNAVAILABLE",
      "The selected payment method is no longer available. Please choose another."
    );
  }

  // No line item may be out of stock
  const outOfStockItem = session.lineItems.find(
    (item) => item.availability === "out_of_stock"
  );
  if (outOfStockItem) {
    throw new PlaceOrderError(
      "LINE_ITEM_OUT_OF_STOCK",
      `"${outOfStockItem.productName}" is out of stock. Please remove it from your cart.`
    );
  }

  // Readiness flags must indicate all sections are complete
  if (!session.readiness.allReady) {
    const missing: string[] = [];
    if (!session.readiness.customerReady) missing.push("customer details");
    if (!session.readiness.shippingReady) missing.push("shipping");
    if (!session.readiness.paymentReady) missing.push("payment");
    throw new PlaceOrderError(
      "CHECKOUT_NOT_READY",
      `Your checkout is not complete. Please review: ${missing.join(", ")}.`
    );
  }
}

// ── 5.3 Resolve or create customer ───────────────────────────────────────────

/**
 * Customer resolution strategy (explicit, in priority order):
 *
 *   A) If the session already carries a customerId — use it directly.
 *      This is the fast path and avoids any ambiguous lookup.
 *
 *   B) If the session has no customerId but has an authUserId — attempt to
 *      find an existing customer row scoped to this storefront by auth user.
 *      If found, use it. If not found, fall through to C.
 *
 *   C) If no customer row exists — create a new customer row using the
 *      checkout customer and shipping address data from the session.
 *      Guest checkouts always land here.
 *
 * The backend customers table does NOT have a direct FK to auth.users.
 * Customer resolution relies on storefront-scoped email or auth_user_id
 * column matching (where available). This strategy is explicit about that.
 */
async function resolveOrCreateCustomer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: CheckoutSession,
  input: PlaceOrderInput
): Promise<string> {
  // Path A: customerId already resolved on the session
  if (session.customer?.customerId) {
    return session.customer.customerId;
  }

  const customer = session.customer!;
  const shippingAddress = customer.shippingAddress!;

  // Path B: try to find existing customer by authUserId (storefront-scoped)
  if (input.authUserId) {
    const { data: existingByAuth, error: authLookupError } = await supabase
      .from("customers")
      .select("id")
      .eq("storefront_id", session.storefrontId)
      .eq("auth_user_id", input.authUserId)
      .maybeSingle();

    if (authLookupError) {
      throw new PlaceOrderError(
        "CUSTOMER_RESOLVE_ERROR",
        "Unable to verify your account. Please try again.",
        authLookupError.message
      );
    }

    if (existingByAuth?.id) {
      return existingByAuth.id;
    }
  }

  // Path B-fallback: try to find existing customer by storefront + email
  // Only safe when storefront is single-tenant relative to the email.
  // In multi-tenant scenarios a customer may exist under a different
  // distributor_id — this lookup is intentionally storefront-scoped.
  const { data: existingByEmail, error: emailLookupError } = await supabase
    .from("customers")
    .select("id")
    .eq("storefront_id", session.storefrontId)
    .eq("email", customer.email)
    .maybeSingle();

  if (emailLookupError) {
    throw new PlaceOrderError(
      "CUSTOMER_RESOLVE_ERROR",
      "Unable to verify your account details. Please try again.",
      emailLookupError.message
    );
  }

  if (existingByEmail?.id) {
    return existingByEmail.id;
  }

  // Path C: create a new customer row
  const { data: newCustomer, error: createError } = await supabase
    .from("customers")
    .insert({
      storefront_id: session.storefrontId,
      distributor_id: session.operatorDistributorId,
      first_name: customer.firstName,
      last_name: customer.lastName,
      email: customer.email,
      phone: customer.phone ?? null,
      country: shippingAddress.country,
      address_line_1: shippingAddress.addressLine1,
      address_line_2: shippingAddress.addressLine2 ?? null,
      city: shippingAddress.city,
      state_province: shippingAddress.stateProvince ?? null,
      region: shippingAddress.region ?? null,
      postal_code: shippingAddress.postalCode,
    })
    .select("id")
    .single();

  if (createError || !newCustomer?.id) {
    throw new PlaceOrderError(
      "CUSTOMER_RESOLVE_ERROR",
      "Unable to create your account record. Please try again.",
      createError?.message
    );
  }

  return newCustomer.id;
}

// ── 5.4 Generate order number ─────────────────────────────────────────────────

/**
 * Generates a readable, collision-resistant order number.
 *
 * Format: BF-{YYYYMMDD}-{6-char uppercase hex suffix}
 * Example: BF-20240315-A3F2E1
 *
 * The date prefix aids human readability and support tooling.
 * The hex suffix uses crypto.randomUUID entropy (first 6 chars after stripping
 * dashes) for collision resistance. Not globally unique by construction,
 * but collision probability is negligible at expected order volumes.
 *
 * When a centralized order-number service is needed (sequential, guaranteed
 * unique across distributed nodes), this function is the extraction point.
 */
function generateOrderNumber(): string {
  const now = new Date();
  const datePart = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");

  // Use crypto.randomUUID for entropy — strip dashes, take first 6 chars
  const rawUuid = crypto.randomUUID().replace(/-/g, "");
  const suffix = rawUuid.slice(0, 6).toUpperCase();

  return `BF-${datePart}-${suffix}`;
}

// ── 5.5 Create order row ──────────────────────────────────────────────────────

interface CreatedOrder {
  id: string;
  orderNumber: string;
}

async function createOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: CheckoutSession,
  customerId: string,
  orderNumber: string
): Promise<CreatedOrder> {
  // Initial order status is always pending_payment.
  // An order is NOT processing until payment is confirmed.
  const initialStatus: OrderStatusReference = "pending_payment";

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      storefront_id: session.storefrontId,
      operator_distributor_id: session.operatorDistributorId,
      customer_id: customerId,
      order_number: orderNumber,
      status: initialStatus,
      currency: session.currency,
      subtotal: session.totals.subtotal,
      shipping: session.totals.shipping,
      total: session.totals.total,
      notes: session.notes ?? null,
    })
    .select("id, order_number")
    .single();

  if (error || !order?.id) {
    throw new PlaceOrderError(
      "ORDER_CREATE_ERROR",
      "Unable to create your order. Please try again.",
      error?.message
    );
  }

  return { id: order.id, orderNumber: order.order_number as string };
}

// ── 5.6 Create order items ────────────────────────────────────────────────────

/**
 * Persists order items using only the fields that actually exist on the
 * backend order_items table today:
 *   order_id, product_name, variant_label, qty, unit_price
 *
 * product_id and variant_id are NOT written here because they are not
 * confirmed backend columns on order_items. When richer item linkage is
 * added to the backend schema, the insert can be extended here without
 * changing the session contract.
 *
 * unit_price is taken from the normalized session line item — the
 * canonical server-side resolved price. Client-supplied prices are
 * never trusted.
 */
async function createOrderItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  session: CheckoutSession
): Promise<void> {
  const rows = session.lineItems.map((item) => ({
    order_id: orderId,
    product_name: item.productName,
    variant_label: item.variantLabel ?? null,
    qty: item.quantity,
    unit_price: item.unitPrice,
  }));

  const { error } = await supabase.from("order_items").insert(rows);

  if (error) {
    throw new PlaceOrderError(
      "ORDER_ITEMS_CREATE_ERROR",
      "Unable to save your order items. Please contact support.",
      error.message
    );
  }
}

// ── 5.7 Create payment intent ─────────────────────────────────────────────────

interface CreatedPaymentIntent {
  id: string;
  provider: CheckoutPaymentProvider;
}

async function createPaymentIntent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: CheckoutSession,
  orderId: string
): Promise<CreatedPaymentIntent> {
  const paymentMethod = session.selectedPaymentMethod!;
  const provider = paymentMethod.provider;

  // Initial payment intent status is "created".
  // It transitions to "processing" or "succeeded" only when the payment
  // provider confirms — never set optimistically at placement time.
  const { data: intent, error } = await supabase
    .from("payment_intents")
    .insert({
      storefront_id: session.storefrontId,
      operator_distributor_id: session.operatorDistributorId,
      order_id: orderId,
      provider,
      amount: session.totals.total,
      currency: session.currency,
      status: "created",
      provider_reference: null,
      processed_at: null,
    })
    .select("id, provider")
    .single();

  if (error || !intent?.id) {
    throw new PlaceOrderError(
      "PAYMENT_INTENT_CREATE_ERROR",
      "Unable to initialize payment. Please try again.",
      error?.message
    );
  }

  return {
    id: intent.id,
    provider: intent.provider as CheckoutPaymentProvider,
  };
}

// ── 5.8 Increment coupon usage ────────────────────────────────────────────────

/**
 * Safely increments the coupon usage_count.
 * Only called after all order writes succeed.
 * Non-fatal: a failure here is logged but does not fail the placement result
 * because the order is already committed. A separate reconciliation process
 * should detect over-usage if increment fails.
 */
async function incrementCouponUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storefrontId: string,
  couponCode: string
): Promise<void> {
  const { error } = await supabase.rpc("increment_coupon_usage", {
    p_storefront_id: storefrontId,
    p_coupon_code: couponCode,
  });

  if (error) {
    // Non-fatal: log for reconciliation. Do not surface to the caller.
    // The order is committed — failing here must not roll back the result.
    console.error(
      `[place-order-action] Failed to increment coupon usage for "${couponCode}":`,
      error.message
    );
  }
}

// ── 5.9 Blackswan integration hook ───────────────────────────────────────────

/**
 * The explicit boundary where Blackframe hands the placed order to the
 * Blackswan/backend orchestration layer.
 *
 * This is a stub. It is intentionally empty until the Blackswan integration
 * contract is finalized. The function signature is the stable API surface —
 * replace the body with the real integration without changing callers.
 *
 * Downstream integrations this hook will eventually trigger:
 *   - Distributor routing and order assignment
 *   - Supplier orchestration
 *   - Fulfillment creation
 *   - Operational event emission
 *   - Downstream order processing pipeline
 */
interface BlackswanIntegrationContext {
  storefrontId: string;
  operatorDistributorId: string;
  orderId: string;
  orderNumber: string;
  paymentIntentId: string;
  provider: CheckoutPaymentProvider;
  returnUrl: string | null;
  cancelUrl: string | null;
}

interface BlackswanIntegrationResult {
  /**
   * Redirect URL for payment provider flows (e.g. Stripe Checkout, PayPal).
   * Null for manual or synchronous payment methods.
   */
  redirectUrl: string | null;
}

async function triggerBlackswanIntegrationHook(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  context: BlackswanIntegrationContext
): Promise<BlackswanIntegrationResult> {
  // TODO: implement Blackswan integration when the contract is finalized.
  // This stub returns a null redirectUrl, which is correct for manual
  // payment flows. Replace with real integration logic here.
  return { redirectUrl: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. EXPORTED SERVER ACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * placeOrderAction
 *
 * The canonical write path for placing an order from a Blackframe checkout.
 *
 * Always returns a typed PlaceOrderResult — never throws to the caller.
 * All internal errors are caught and mapped to PlaceOrderFailure.
 */
export async function placeOrderAction(
  input: PlaceOrderInput
): Promise<PlaceOrderResult> {
  try {
    // ── Step 1: Validate input structure ─────────────────────────────────────
    validateInput(input);

    // ── Step 2: Re-load canonical checkout session ────────────────────────────
    // Do NOT trust the client payload for prices, totals, or availability.
    // The normalized CheckoutSession is the authoritative source of truth.
    let session: CheckoutSession;
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
        couponCode: input.couponCode,
        notes: input.notes,
        checkoutState: "validating",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (sessionError) {
      const message =
        sessionError instanceof Error
          ? sessionError.message
          : "Failed to load checkout session.";
      return {
        ok: false,
        code: "CHECKOUT_SESSION_ERROR",
        message: "Your checkout session could not be loaded. Please try again.",
        detail: message,
      };
    }

    // ── Step 3: Validate place-order readiness ────────────────────────────────
    validatePlaceOrderReadiness(session);

    // ── Step 4: Acquire supabase client (server-side, cookie-based) ───────────
    const supabase = await createClient();

    // ── Step 5: Resolve or create customer ───────────────────────────────────
    const customerId = await resolveOrCreateCustomer(supabase, session, input);

    // ── Step 6: Generate order number ─────────────────────────────────────────
    const orderNumber = generateOrderNumber();

    // ── Step 7: Create order row ──────────────────────────────────────────────
    const createdOrder = await createOrder(
      supabase,
      session,
      customerId,
      orderNumber
    );

    // ── Step 8: Create order items ────────────────────────────────────────────
    await createOrderItems(supabase, createdOrder.id, session);

    // ── Step 9: Create payment intent ─────────────────────────────────────────
    const paymentIntent = await createPaymentIntent(
      supabase,
      session,
      createdOrder.id
    );

    // ── Step 10: Increment coupon usage (only after all writes succeed) ────────
    if (input.couponCode && session.discount) {
      await incrementCouponUsage(
        supabase,
        session.storefrontId,
        session.discount.code
      );
    }

    // ── Step 11: Trigger Blackswan integration hook ───────────────────────────
    const integrationResult = await triggerBlackswanIntegrationHook({
      storefrontId: session.storefrontId,
      operatorDistributorId: session.operatorDistributorId,
      orderId: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      paymentIntentId: paymentIntent.id,
      provider: paymentIntent.provider,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    });

    // ── Step 12: Return typed success result ──────────────────────────────────
    return {
      ok: true,
      orderId: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      paymentIntentId: paymentIntent.id,
      provider: paymentIntent.provider,
      redirectUrl: integrationResult.redirectUrl,
    };
  } catch (error) {
    // ── Known, typed placement errors ─────────────────────────────────────────
    if (error instanceof PlaceOrderError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        detail: error.detail,
      };
    }

    // ── Unexpected errors ─────────────────────────────────────────────────────
    const detail =
      error instanceof Error ? error.message : "Unknown error during placement.";

    console.error("[place-order-action] Unexpected error:", detail);

    return {
      ok: false,
      code: "UNEXPECTED_ERROR",
      message:
        "An unexpected error occurred while placing your order. Please try again or contact support.",
      detail,
    };
  }
}
