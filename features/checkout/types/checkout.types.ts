// ─────────────────────────────────────────────────────────────────────────────
// features/checkout/types/checkout.types.ts
//
// Canonical type system for the Blackframe / Blackswan checkout domain.
// Server-first. Storefront-scoped. Infrastructure-grade.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. CORE ENUMS / UNIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the backend payment_intents.provider enum exactly. */
export type CheckoutPaymentProvider = "stripe" | "paypal" | "crypto" | "manual";

/** Mirrors the backend payment_intents.status enum exactly. */
export type CheckoutPaymentIntentStatus =
  | "created"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "canceled";

/**
 * Reference-only alias for the backend orders.status enum.
 * Not used to drive checkout flow — kept here for traceability only.
 */
export type CheckoutOrderStatusReference =
  | "pending_payment"
  | "processing"
  | "shipped"
  | "delivered"
  | "returned"
  | "refunded"
  | "canceled";

/** Whether the customer is transacting as a guest or an authenticated user. */
export type CheckoutAuthMode = "guest" | "authenticated";

/** Stock / fulfillability state of a line item at checkout time. */
export type CheckoutLineItemAvailability =
  | "available"
  | "low_stock"
  | "out_of_stock"
  | "discontinued";

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUPPORTING SUBTYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Authentication context for the active checkout session. */
export interface CheckoutAuthState {
  mode: CheckoutAuthMode;
  /** Supabase Auth user id — present only when mode is "authenticated". */
  authUserId: string | null;
  /** Whether the session has been verified server-side. */
  verified: boolean;
}

/** Applied discount or coupon summary. */
export interface CheckoutDiscountSummary {
  code: string;
  label: string;
  /** Absolute discount amount in the session currency. */
  discountAmount: number;
  /** Percentage off, if applicable. */
  discountPercent: number | null;
}

/**
 * Readiness flags indicating whether each checkout section
 * is complete enough to proceed to the next step.
 */
export interface CheckoutReadiness {
  customerReady: boolean;
  shippingReady: boolean;
  paymentReady: boolean;
  /** True only when all sections are ready and submission is safe. */
  allReady: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CheckoutAddress
// ─────────────────────────────────────────────────────────────────────────────

/** A normalized address for shipping or billing use. Aligns with backend customer address fields. */
export interface CheckoutAddress {
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string | null;
  region: string | null;
  postalCode: string;
  country: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CheckoutCustomer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Customer identity during checkout.
 * Supports both guest and authenticated flows.
 * Scoped to the active storefront and distributor.
 */
export interface CheckoutCustomer {
  /** Backend customers.id — null for unregistered guests. */
  customerId: string | null;
  /** Supabase Auth user id — null for guests. */
  authUserId: string | null;
  authMode: CheckoutAuthMode;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  shippingAddress: CheckoutAddress | null;
  billingAddress: CheckoutAddress | null;
  /** When true, billing address is treated as identical to shipping. */
  billingSameAsShipping: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CheckoutLineItem
// ─────────────────────────────────────────────────────────────────────────────

/** A purchasable storefront line item, normalized for UI consumption. */
export interface CheckoutLineItem {
  /** Stable client-side line item identifier. */
  lineItemId: string;
  productId: string;
  productSlug: string;
  productName: string;
  productBrand: string | null;
  /** Null when the product has no variants. */
  variantId: string | null;
  variantLabel: string | null;
  sku: string | null;
  /** Selected variant attribute values. */
  attributes: {
    size: string | null;
    color: string | null;
    material: string | null;
  };
  /** Primary product image URL for display in the line item row. */
  imageUrl: string | null;
  quantity: number;
  /** Resolved unit price after storefront and variant price overrides. */
  unitPrice: number;
  /** Retail / compare-at price before any overrides, if present. */
  retailPrice: number | null;
  /** unitPrice × quantity. */
  lineSubtotal: number;
  availability: CheckoutLineItemAvailability;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. CheckoutTotals
// ─────────────────────────────────────────────────────────────────────────────

/** All price math the checkout page cares about. */
export interface CheckoutTotals {
  subtotal: number;
  shipping: number;
  /** Total discount applied from coupons or promotions. Zero when none. */
  discount: number;
  /**
   * Tax amount. Optional — not yet modeled in the backend.
   * Reserved for future use; must not be displayed unless explicitly populated.
   */
  tax?: number;
  total: number;
  /** ISO 4217 currency code, matches session currency. */
  currency: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. CheckoutShippingMethod
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A selectable shipping option presented to the customer.
 * Modeled as a normalized storefront contract — no dedicated backend
 * shipping-method table exists yet. Carrier and tracking data live
 * on the downstream shipment record after order creation.
 */
export interface CheckoutShippingMethod {
  id: string;
  label: string;
  description: string | null;
  carrier: string | null;
  price: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Human-readable estimated delivery range, e.g. "3–5 business days". */
  estimatedDelivery: string | null;
  available: boolean;
  selected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CheckoutPaymentMethod
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A selectable payment method for the checkout.
 * Provider values align with the backend payment_intents.provider enum exactly.
 */
export interface CheckoutPaymentMethod {
  id: string;
  provider: CheckoutPaymentProvider;
  label: string;
  description: string | null;
  available: boolean;
  selected: boolean;
  /** Current processing status if a payment intent has already been created. */
  intentStatus: CheckoutPaymentIntentStatus | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. CheckoutState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The active state of the checkout flow.
 * Drives frontend transitions only — distinct from backend order status.
 *
 * idle        → session initialized, no active submission in progress
 * validating  → running pre-submission checks (stock, address, totals)
 * ready       → all sections complete, safe to submit
 * processing  → payment submission in flight
 * succeeded   → payment confirmed, order created
 * failed      → payment or submission error; session is recoverable
 */
export type CheckoutState =
  | "idle"
  | "validating"
  | "ready"
  | "processing"
  | "succeeded"
  | "failed";

// ─────────────────────────────────────────────────────────────────────────────
// 10. CheckoutSession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The top-level normalized checkout contract consumed by the storefront.
 * Canonical source of truth for one active checkout session,
 * from cart entry through to order completion.
 */
export interface CheckoutSession {
  /** Stable session identifier — generated server-side on session creation. */
  sessionId: string;
  /** Blackswan storefront id scoping this session. */
  storefrontId: string;
  /** Operator / distributor id scoping this session. */
  operatorDistributorId: string;
  /** ISO 4217 currency code derived from storefront default_currency. */
  currency: string;
  auth: CheckoutAuthState;
  customer: CheckoutCustomer | null;
  lineItems: CheckoutLineItem[];
  totals: CheckoutTotals;
  availableShippingMethods: CheckoutShippingMethod[];
  selectedShippingMethod: CheckoutShippingMethod | null;
  availablePaymentMethods: CheckoutPaymentMethod[];
  selectedPaymentMethod: CheckoutPaymentMethod | null;
  state: CheckoutState;
  readiness: CheckoutReadiness;
  discount: CheckoutDiscountSummary | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
