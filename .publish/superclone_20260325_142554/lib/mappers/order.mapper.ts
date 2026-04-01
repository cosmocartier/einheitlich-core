// ─────────────────────────────────────────────────────────────────────────────
// lib/mappers/order.mapper.ts
//
// Transforms composed order source payloads into normalized OrderSummary
// contracts for the Blackframe storefront layer.
//
// Source inputs are raw backend records assembled by the calling layer.
// This mapper performs no I/O and has no side effects.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  OrderSummary,
  OrderCustomer,
  OrderAddress,
  OrderItem,
  OrderPaymentStatus,
  OrderFulfillmentStatus,
  OrderTimelineStatus,
  OrderShipmentSummary,
  OrderTrackingSummary,
  OrderTrackingEvent,
  OrderStatusReference,
  PaymentIntentStatusReference,
  PaymentProvider,
  ShipmentStatusReference,
  OrderEventActorType,
} from "@/features/orders/types/order.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOCAL RAW INPUT TYPES
//    Represent raw backend record shapes. The calling layer is responsible
//    for assembling RawOrderSource from the appropriate backend records.
// ─────────────────────────────────────────────────────────────────────────────

interface RawOrder {
  id: string;
  storefront_id: string;
  operator_distributor_id: string;
  customer_id: string;
  order_number: string;
  status: OrderStatusReference;
  currency: string;
  subtotal: number;
  shipping: number;
  total: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface RawOrderItem {
  id: string;
  order_id: string;
  product_name: string;
  variant_label: string | null;
  qty: number;
  unit_price: number;
  created_at: string;
}

/**
 * Optional enrichment fields that may be supplied by a calling layer
 * that has resolved product catalog data for an order item.
 * These are NOT guaranteed backend columns on order_items.
 */
interface RawOrderItemEnrichment {
  orderItemId: string;
  sku?: string;
  imageUrl?: string;
  productSlug?: string;
}

interface RawCustomer {
  id: string;
  storefront_id: string;
  distributor_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  tags: string[] | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state_province: string | null;
  region: string | null;
  postal_code: string | null;
  created_at: string;
  updated_at: string;
}

interface RawPaymentIntent {
  id: string;
  storefront_id: string;
  operator_distributor_id: string;
  order_id: string;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  status: PaymentIntentStatusReference;
  provider_reference: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RawShipment {
  id: string;
  storefront_id: string;
  operator_distributor_id: string;
  order_id: string;
  supplier_id: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: ShipmentStatusReference;
  origin_country: string | null;
  destination_country: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RawTrackingEvent {
  id: string;
  shipment_id: string;
  status: ShipmentStatusReference;
  location: string | null;
  message: string | null;
  event_time: string;
  created_at: string;
}

// Included for completeness; order events are used only if they materially
// improve timeline normalization in future iterations.
interface RawOrderEvent {
  id: string;
  order_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  actor_type: OrderEventActorType;
  actor_user_id: string | null;
  created_at: string;
}

/**
 * The full composed source object passed into mapOrderSummary.
 * The calling layer is responsible for assembling this from backend records.
 */
export interface RawOrderSource {
  order: RawOrder;
  items: RawOrderItem[];
  /**
   * Optional catalog-resolved enrichments keyed by order item id.
   * Callers provide these when product catalog data is available at call time.
   */
  itemEnrichments?: RawOrderItemEnrichment[];
  customer: RawCustomer;
  /**
   * All payment intents associated with the order.
   * When multiple exist, see normalizePaymentStatus for the selection strategy.
   */
  paymentIntents: RawPaymentIntent[];
  /**
   * All shipments associated with the order.
   * When multiple exist, see selectPrimaryShipment for the selection strategy.
   */
  shipments: RawShipment[];
  trackingEvents: RawTrackingEvent[];
  /** Optional — reserved for future timeline enrichment. */
  orderEvents?: RawOrderEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SMALL PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Safely trim a string; return null if blank or absent. */
function nullIfBlank(value: string | null | undefined): string | null {
  if (!value || value.trim() === "") return null;
  return value.trim();
}

/** Round a monetary value to two decimal places. */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Derive fullName from firstName + lastName, trimming safely. */
function toFullName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ADDRESS NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce a normalized OrderAddress from a raw customer record.
 * Returns null when the minimum required fields (line1, city,
 * postalCode, country) are absent.
 */
function normalizeAddress(
  raw: RawCustomer,
  firstName: string | null,
  lastName: string | null
): OrderAddress | null {
  if (!raw.address_line_1 || !raw.city || !raw.postal_code || !raw.country) {
    return null;
  }
  return {
    firstName,
    lastName,
    fullName: toFullName(firstName, lastName),
    addressLine1: raw.address_line_1,
    addressLine2: nullIfBlank(raw.address_line_2),
    city: raw.city,
    stateProvince: nullIfBlank(raw.state_province),
    region: nullIfBlank(raw.region),
    postalCode: raw.postal_code,
    country: raw.country,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CUSTOMER NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCustomer(raw: RawCustomer): OrderCustomer {
  const firstName = raw.first_name;
  const lastName = raw.last_name;

  // The customers table stores a single address record. We use it for both
  // shipping and billing, exposing billingAddress: null and
  // billingSameAsShipping: true to signal they are identical at this level.
  const shippingAddress = normalizeAddress(raw, firstName, lastName);

  // Guard: produce a minimal placeholder when the customer record lacks
  // address data so the calling layer can surface incompleteness rather than
  // failing silently.
  const safeShipping: OrderAddress = shippingAddress ?? {
    firstName,
    lastName,
    fullName: toFullName(firstName, lastName),
    addressLine1: "",
    addressLine2: null,
    city: "",
    stateProvince: null,
    region: null,
    postalCode: "",
    country: raw.country ?? "",
  };

  return {
    customerId: raw.id,
    storefrontId: raw.storefront_id,
    distributorId: raw.distributor_id,
    firstName,
    lastName,
    fullName: toFullName(firstName, lastName) ?? `${firstName} ${lastName}`.trim(),
    email: raw.email,
    phone: nullIfBlank(raw.phone),
    country: nullIfBlank(raw.country),
    tags: raw.tags ?? [],
    shippingAddress: safeShipping,
    billingAddress: null,
    billingSameAsShipping: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ORDER ITEM NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function normalizeItems(
  rawItems: RawOrderItem[],
  enrichments: RawOrderItemEnrichment[] | undefined
): OrderItem[] {
  const enrichmentMap = new Map<string, RawOrderItemEnrichment>(
    (enrichments ?? []).map((e) => [e.orderItemId, e])
  );

  return rawItems.map((raw) => {
    const enrich = enrichmentMap.get(raw.id);
    const lineSubtotal = roundMoney(raw.qty * raw.unit_price);

    const item: OrderItem = {
      id: raw.id,
      orderId: raw.order_id,
      productName: raw.product_name,
      variantLabel: nullIfBlank(raw.variant_label),
      quantity: raw.qty,
      unitPrice: raw.unit_price,
      lineSubtotal,
    };

    // Assign optional enrichments only when present — these are NOT guaranteed
    // backend columns on order_items.
    if (enrich?.sku) item.sku = enrich.sku;
    if (enrich?.imageUrl) item.imageUrl = enrich.imageUrl;
    if (enrich?.productSlug) item.productSlug = enrich.productSlug;

    return item;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. PAYMENT STATUS NORMALIZATION
//
// Strategy when multiple payment intents are present:
//   1. Prefer the first "succeeded" intent — a completed payment is definitive.
//   2. Fall back to the first "processing" intent — payment is in flight.
//   3. Walk remaining statuses in priority order: created, failed, refunded,
//      canceled.
//   4. Final fallback: most recently created intent.
//
// This approach surfaces the most positive or in-progress state to the
// storefront, keeping the logic explicit and auditable.
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_INTENT_STATUS_PRIORITY: PaymentIntentStatusReference[] = [
  "succeeded",
  "processing",
  "created",
  "failed",
  "refunded",
  "canceled",
];

function selectPrimaryPaymentIntent(
  intents: RawPaymentIntent[]
): RawPaymentIntent | null {
  if (intents.length === 0) return null;
  if (intents.length === 1) return intents[0];

  for (const status of PAYMENT_INTENT_STATUS_PRIORITY) {
    const match = intents.find((pi) => pi.status === status);
    if (match) return match;
  }

  // Fallback: most recently created.
  return intents
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
}

function normalizePaymentStatus(
  intents: RawPaymentIntent[],
  orderCurrency: string
): OrderPaymentStatus {
  const primary = selectPrimaryPaymentIntent(intents);

  if (!primary) {
    // No payment intent recorded yet — order is awaiting payment initiation.
    return {
      status: "created",
      provider: null,
      providerReference: null,
      processedAt: null,
      currency: orderCurrency,
      amount: 0,
    };
  }

  return {
    status: primary.status,
    provider: primary.provider,
    providerReference: nullIfBlank(primary.provider_reference),
    processedAt: primary.processed_at ?? null,
    currency: primary.currency,
    amount: primary.amount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. FULFILLMENT STATUS NORMALIZATION
//
// Strategy when multiple shipments are present:
//   Rank shipments by the advancement of their status and select the highest.
//   This ensures the storefront shows the most relevant delivery state when an
//   order has been split across multiple shipments.
// ─────────────────────────────────────────────────────────────────────────────

const SHIPMENT_STATUS_RANK: Record<ShipmentStatusReference, number> = {
  delivered:        7,
  out_for_delivery: 6,
  in_transit:       5,
  label_created:    4,
  exception:        3,
  returned:         2,
  canceled:         1,
};

function selectPrimaryShipment(shipments: RawShipment[]): RawShipment | null {
  if (shipments.length === 0) return null;
  if (shipments.length === 1) return shipments[0];

  return shipments
    .slice()
    .sort(
      (a, b) =>
        (SHIPMENT_STATUS_RANK[b.status] ?? 0) -
        (SHIPMENT_STATUS_RANK[a.status] ?? 0)
    )[0] ?? null;
}

function normalizeFulfillmentStatus(
  shipments: RawShipment[]
): OrderFulfillmentStatus {
  const primary = selectPrimaryShipment(shipments);
  if (!primary) return "not_yet_shipped";
  // ShipmentStatusReference values map 1:1 to the OrderFulfillmentStatus union.
  return primary.status as OrderFulfillmentStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. TIMELINE STATUS NORMALIZATION
//
// Derives the coarse customer-facing order journey state from the combination
// of order status, payment state, and fulfillment state.
// Rules are evaluated in order — first match wins.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeTimelineStatus(
  orderStatus: OrderStatusReference,
  paymentStatus: OrderPaymentStatus,
  fulfillmentStatus: OrderFulfillmentStatus
): OrderTimelineStatus {
  if (orderStatus === "canceled")  return "canceled";
  if (orderStatus === "refunded")  return "refunded";
  if (orderStatus === "returned")  return "returned";

  if (
    orderStatus === "pending_payment" &&
    paymentStatus.status !== "succeeded"
  ) {
    return "pending_payment";
  }

  if (orderStatus === "delivered" || fulfillmentStatus === "delivered") {
    return "delivered";
  }

  if (fulfillmentStatus === "out_for_delivery") {
    return "out_for_delivery";
  }

  if (orderStatus === "shipped" || fulfillmentStatus === "in_transit") {
    return "shipped";
  }

  if (orderStatus === "processing" && fulfillmentStatus === "label_created") {
    return "ready_to_ship";
  }

  if (orderStatus === "processing") {
    return "processing";
  }

  // Payment succeeded but order status hasn't advanced past pending_payment.
  return "confirmed";
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. TRACKING NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function normalizeTrackingEvents(
  rawEvents: RawTrackingEvent[],
  shipmentId: string
): OrderTrackingEvent[] {
  return rawEvents
    .filter((e) => e.shipment_id === shipmentId)
    .sort(
      (a, b) =>
        new Date(b.event_time).getTime() - new Date(a.event_time).getTime()
    )
    .map((e) => ({
      id: e.id,
      shipmentId: e.shipment_id,
      status: e.status,
      location: nullIfBlank(e.location),
      message: nullIfBlank(e.message),
      eventTime: e.event_time,
      createdAt: e.created_at,
    }));
}

function normalizeTrackingSummary(
  shipment: RawShipment,
  rawEvents: RawTrackingEvent[]
): OrderTrackingSummary | null {
  const events = normalizeTrackingEvents(rawEvents, shipment.id);
  if (events.length === 0) return null;

  const latest = events[0];

  return {
    carrier: nullIfBlank(shipment.carrier),
    trackingNumber: nullIfBlank(shipment.tracking_number),
    currentStatus: latest.status,
    currentLocation: latest.location,
    lastEventAt: latest.eventTime,
    // estimatedDeliveryAt is not a current backend column.
    estimatedDeliveryAt: null,
    events,
  };
}

function normalizeShipmentSummary(
  shipment: RawShipment,
  rawTrackingEvents: RawTrackingEvent[]
): OrderShipmentSummary {
  return {
    shipmentId: shipment.id,
    status: shipment.status,
    carrier: nullIfBlank(shipment.carrier),
    trackingNumber: nullIfBlank(shipment.tracking_number),
    originCountry: nullIfBlank(shipment.origin_country),
    destinationCountry: nullIfBlank(shipment.destination_country),
    shippedAt: shipment.shipped_at ?? null,
    deliveredAt: shipment.delivered_at ?? null,
    tracking: normalizeTrackingSummary(shipment, rawTrackingEvents),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. MAIN EXPORTED MAPPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a composed order source payload into a normalized OrderSummary.
 *
 * The caller is responsible for assembling RawOrderSource from the
 * appropriate backend records before invoking this function.
 * This mapper performs no I/O and has no side effects.
 */
export function mapOrderSummary(source: RawOrderSource): OrderSummary {
  const {
    order,
    items,
    itemEnrichments,
    customer,
    paymentIntents,
    shipments,
    trackingEvents,
  } = source;

  const normalizedItems    = normalizeItems(items, itemEnrichments);
  const normalizedCustomer = normalizeCustomer(customer);
  const paymentStatus      = normalizePaymentStatus(paymentIntents, order.currency);
  const fulfillmentStatus  = normalizeFulfillmentStatus(shipments);
  const timelineStatus     = normalizeTimelineStatus(
    order.status,
    paymentStatus,
    fulfillmentStatus
  );

  // Reuse the same primary shipment selection for the summary so that
  // fulfillmentStatus and the shipment contract are always consistent.
  const primaryShipment = selectPrimaryShipment(shipments);
  const shipment = primaryShipment
    ? normalizeShipmentSummary(primaryShipment, trackingEvents)
    : null;

  return {
    id:                    order.id,
    orderNumber:           order.order_number,
    storefrontId:          order.storefront_id,
    operatorDistributorId: order.operator_distributor_id,
    customer:              normalizedCustomer,
    items:                 normalizedItems,
    currency:              order.currency,
    subtotal:              roundMoney(order.subtotal),
    shipping:              roundMoney(order.shipping),
    total:                 roundMoney(order.total),
    notes:                 nullIfBlank(order.notes),
    orderStatus:           order.status,
    paymentStatus,
    fulfillmentStatus,
    timelineStatus,
    shipment,
    createdAt:             order.created_at,
    updatedAt:             order.updated_at,
  };
}
