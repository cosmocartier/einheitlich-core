// ─────────────────────────────────────────────────────────────────────────────
// features/orders/types/order.types.ts
//
// Canonical type system for the Blackframe / Blackswan order domain.
// Server-first. Storefront-scoped. Infrastructure-grade.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. CORE ENUMS / UNIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the backend orders.status enum exactly. */
export type OrderStatusReference =
  | "pending_payment"
  | "processing"
  | "shipped"
  | "delivered"
  | "returned"
  | "refunded"
  | "canceled";

/** Mirrors the backend payment_intents.provider enum exactly. */
export type PaymentProvider = "stripe" | "paypal" | "crypto" | "manual";

/** Mirrors the backend payment_intents.status enum exactly. */
export type PaymentIntentStatusReference =
  | "created"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "canceled";

/** Mirrors the backend shipments.status enum exactly. */
export type ShipmentStatusReference =
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "returned"
  | "canceled";

/**
 * Actor type for order events.
 * Mirrors the backend order_events.actor_type enum exactly.
 */
export type OrderEventActorType =
  | "platform"
  | "distributor"
  | "supplier"
  | "system";

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUPPORTING SUBTYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A normalized monetary amount with its associated currency. */
export interface OrderMoney {
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
}

/**
 * Summary of a single tracking event within a shipment.
 * Aligns with the backend shipment_tracking_events table.
 */
export interface OrderTrackingEvent {
  id: string;
  shipmentId: string;
  /** Shipment lifecycle status at the time of this event. */
  status: ShipmentStatusReference;
  location: string | null;
  message: string | null;
  eventTime: string;
  createdAt: string;
}

/**
 * Minimal tracking summary surfaced on the storefront order view.
 * Derived from the most recent tracking event on the attached shipment.
 */
export interface OrderTrackingSummary {
  carrier: string | null;
  trackingNumber: string | null;
  currentStatus: ShipmentStatusReference;
  /** Human-readable location from the latest tracking event, if available. */
  currentLocation: string | null;
  /** ISO 8601 timestamp of the latest tracking event. */
  lastEventAt: string | null;
  estimatedDeliveryAt: string | null;
  events: OrderTrackingEvent[];
}

/**
 * Minimal shipment summary surfaced on the storefront order.
 * Full operational shipment detail is not exposed here.
 */
export interface OrderShipmentSummary {
  shipmentId: string;
  status: ShipmentStatusReference;
  carrier: string | null;
  trackingNumber: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  tracking: OrderTrackingSummary | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OrderAddress
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A normalized address aligned with the backend customers table address fields.
 * Used for both shipping and billing contexts within the order domain.
 */
export interface OrderAddress {
  firstName: string | null;
  lastName: string | null;
  /** Convenience field — derived from firstName + lastName if not stored separately. */
  fullName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string | null;
  region: string | null;
  postalCode: string;
  country: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. OrderCustomer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The customer attached to a placed order.
 * Aligns with the backend customers table.
 * Storefront-scoped and distributor-scoped.
 */
export interface OrderCustomer {
  customerId: string;
  storefrontId: string;
  distributorId: string;
  firstName: string;
  lastName: string;
  /** Convenience field — firstName + lastName. */
  fullName: string;
  email: string;
  phone: string | null;
  country: string | null;
  /** Operator-defined customer tags, e.g. ["vip", "wholesale"]. */
  tags: string[];
  shippingAddress: OrderAddress;
  /**
   * Billing address if distinct from shipping.
   * Null when billing is the same as shipping.
   */
  billingAddress: OrderAddress | null;
  /** When true, billing address is identical to shipping address. */
  billingSameAsShipping: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. OrderItem
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A normalized customer-facing order line item.
 *
 * Fields guaranteed by the backend order_items table today:
 *   id, order_id, product_name, variant_label, qty, unit_price, created_at
 *
 * Optional enrichment fields below are normalized additions sourced
 * from product catalog data at order-creation time. They are NOT
 * guaranteed raw DB columns on order_items — treat them as optional.
 */
export interface OrderItem {
  id: string;
  orderId: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  /** unitPrice × quantity, computed for storefront convenience. */
  lineSubtotal: number;

  // ── Optional normalized enrichments (not guaranteed backend columns) ──
  /** Product SKU at time of purchase. */
  sku?: string;
  /** Primary product image URL for order confirmation / history rendering. */
  imageUrl?: string;
  /** Canonical product slug for linking back to the PDP. */
  productSlug?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. OrderPaymentStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized storefront-facing payment status for an order.
 *
 * Structured as a small contract rather than a plain union so that
 * storefront pages can reason about both the current intent state
 * and optional provider context without conflating payment status
 * with order lifecycle status.
 *
 * The `status` field mirrors payment_intents.status exactly,
 * keeping storefront display logic grounded in backend truth.
 */
export interface OrderPaymentStatus {
  status: PaymentIntentStatusReference;
  provider: PaymentProvider | null;
  /**
   * Opaque provider-side reference (e.g. Stripe Payment Intent ID).
   * Present after the intent reaches "processing" or later.
   */
  providerReference: string | null;
  /** ISO 8601 timestamp when the payment was successfully processed. */
  processedAt: string | null;
  /** Currency of the payment intent — should match the order currency. */
  currency: string;
  amount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. OrderFulfillmentStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized storefront-facing fulfillment / delivery state.
 *
 * Grounded in the backend shipments.status enum. Intentionally separate
 * from order status — communicates where the physical order is in its
 * delivery lifecycle, not the overall order record state.
 *
 * `not_yet_shipped` is a storefront convenience value for orders that
 * have been confirmed but have no shipment record yet.
 */
export type OrderFulfillmentStatus =
  | "not_yet_shipped"
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "returned"
  | "canceled";

// ─────────────────────────────────────────────────────────────────────────────
// 8. OrderTimelineStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean customer-facing timeline state for an order's overall journey.
 *
 * Derived conceptually from order status, payment state, shipment state,
 * tracking events, and order events. Useful for order confirmation pages,
 * account order cards, and future tracking views.
 *
 * Intentionally coarser than the raw backend enums to remain
 * legible to the customer without exposing internal operational state.
 */
export type OrderTimelineStatus =
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "ready_to_ship"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "returned"
  | "refunded"
  | "canceled";

// ─────────────────────────────────────────────────────────────────────────────
// 9. OrderSummary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level normalized storefront order contract.
 *
 * Suitable for:
 *   - Order confirmation page
 *   - Account order history list
 *   - Order detail page
 *   - Support / debug visibility at the storefront layer
 *
 * Reflects the backend orders table columns directly where specified.
 * Payment, fulfillment, and timeline statuses are separate normalized
 * contracts — never collapsed into a single ambiguous status field.
 */
export interface OrderSummary {
  /** Matches backend orders.id. */
  id: string;
  /** Human-readable order number shown to the customer. */
  orderNumber: string;
  /** Blackswan storefront id scoping this order. */
  storefrontId: string;
  /** Operator / distributor id scoping this order. */
  operatorDistributorId: string;
  customer: OrderCustomer;
  items: OrderItem[];
  /** ISO 4217 currency code derived from storefront default_currency. */
  currency: string;
  subtotal: number;
  shipping: number;
  /**
   * Tax amount. Not currently modeled in the backend.
   * Reserved for future use — must not be displayed unless explicitly populated.
   */
  tax?: number;
  total: number;
  notes: string | null;

  /** Raw backend order status — kept for traceability and support tooling. */
  orderStatus: OrderStatusReference;

  /** Normalized payment state — separate from order and fulfillment status. */
  paymentStatus: OrderPaymentStatus;

  /**
   * Normalized physical delivery state.
   * "not_yet_shipped" when no shipment record exists yet.
   */
  fulfillmentStatus: OrderFulfillmentStatus;

  /** Customer-facing timeline state derived from order, payment, and shipment state. */
  timelineStatus: OrderTimelineStatus;

  /**
   * Shipment summary if a shipment record exists.
   * Null until the order reaches fulfillment.
   */
  shipment: OrderShipmentSummary | null;

  createdAt: string;
  updatedAt: string;
}
