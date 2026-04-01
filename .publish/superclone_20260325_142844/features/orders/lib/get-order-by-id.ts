// ─────────────────────────────────────────────────────────────────────────────
// features/orders/lib/get-order-by-id.ts
//
// Main read function for customer-facing order retrieval in Blackframe.
//
// Responsibilities:
//   1. Fetch the order by id and verify it exists
//   2. Fetch all related raw data needed for the storefront order view
//   3. Compose a RawOrderSource and hand it to mapOrderSummary
//   4. Return one clean OrderSummary
//
// This function is the read boundary behind:
//   - Order confirmation page
//   - Account order detail page
//   - Support-facing storefront order retrieval
//
// Note: The base order_items table does not guarantee product_id or variant_id.
// Optional item enrichment is supported when those relations can be resolved
// honestly, but it is never assumed.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import {
  mapOrderSummary,
  type RawOrderSource,
} from "@/lib/mappers/order.mapper";
import type { OrderSummary } from "@/features/orders/types/order.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT / RESULT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional catalog-resolved enrichment for a single order item.
 * The calling layer may supply these when product data is available.
 * The base order_items table does not guarantee product linkage,
 * so these are always optional — never assumed.
 */
export interface OrderItemEnrichment {
  /** Matches order_items.id */
  orderItemId: string;
  sku?: string;
  imageUrl?: string;
  productSlug?: string;
}

/**
 * Optional input for catalog enrichment.
 * Pass this when the calling layer has already resolved product catalog
 * data for the order's line items and wants richer item display.
 */
export interface GetOrderByIdOptions {
  /**
   * Pre-resolved catalog enrichments keyed to order item ids.
   * When omitted, items are normalized from raw order_items columns only.
   */
  itemEnrichments?: OrderItemEnrichment[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERNAL ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order "${orderId}" not found.`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderFetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ORDER_FETCH_FAILED"
      | "ITEMS_FETCH_FAILED"
      | "CUSTOMER_FETCH_FAILED"
      | "PAYMENT_INTENTS_FETCH_FAILED"
      | "SHIPMENTS_FETCH_FAILED"
      | "TRACKING_EVENTS_FETCH_FAILED"
      | "ORDER_EVENTS_FETCH_FAILED"
  ) {
    super(message);
    this.name = "OrderFetchError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MAIN EXPORTED FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch and return a normalized OrderSummary for the given order id.
 *
 * Executes a disciplined sequence of Supabase queries to retrieve all
 * related records, composes a RawOrderSource, and delegates normalization
 * to mapOrderSummary.
 *
 * Throws OrderNotFoundError when the order does not exist.
 * Throws OrderFetchError on unexpected Supabase query failures.
 */
export async function getOrderById(
  orderId: string,
  options?: GetOrderByIdOptions
): Promise<OrderSummary> {
  const supabase = await createClient();

  // ── 3.1 Fetch the order ───────────────────────────────────────────────────
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, storefront_id, operator_distributor_id, customer_id, order_number, status, currency, subtotal, shipping, total, notes, created_at, updated_at"
    )
    .eq("id", orderId)
    .single();

  if (orderError) {
    if (orderError.code === "PGRST116") {
      throw new OrderNotFoundError(orderId);
    }
    throw new OrderFetchError(
      `Failed to fetch order "${orderId}": ${orderError.message}`,
      "ORDER_FETCH_FAILED"
    );
  }

  if (!order) {
    throw new OrderNotFoundError(orderId);
  }

  // ── 3.2 Fetch order items ─────────────────────────────────────────────────
  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id, order_id, product_name, variant_label, qty, unit_price, created_at")
    .eq("order_id", orderId);

  if (itemsError) {
    throw new OrderFetchError(
      `Failed to fetch items for order "${orderId}": ${itemsError.message}`,
      "ITEMS_FETCH_FAILED"
    );
  }

  // ── 3.3 Fetch customer ────────────────────────────────────────────────────
  //   Customer is expected to exist. If missing, we surface it explicitly
  //   rather than silently substituting placeholder data.
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select(
      "id, storefront_id, distributor_id, first_name, last_name, email, phone, country, tags, address_line_1, address_line_2, city, state_province, region, postal_code, created_at, updated_at"
    )
    .eq("id", order.customer_id)
    .single();

  if (customerError) {
    if (customerError.code === "PGRST116") {
      // Customer record is missing. This is an integrity anomaly — surface it
      // rather than masking it with silent fallbacks.
      throw new OrderFetchError(
        `Customer "${order.customer_id}" for order "${orderId}" not found.`,
        "CUSTOMER_FETCH_FAILED"
      );
    }
    throw new OrderFetchError(
      `Failed to fetch customer for order "${orderId}": ${customerError.message}`,
      "CUSTOMER_FETCH_FAILED"
    );
  }

  if (!customer) {
    throw new OrderFetchError(
      `Customer "${order.customer_id}" for order "${orderId}" not found.`,
      "CUSTOMER_FETCH_FAILED"
    );
  }

  // ── 3.4 Fetch payment intents ─────────────────────────────────────────────
  //   An order may have zero payment intents (e.g., newly created pending
  //   orders). An empty array is valid — the mapper handles this case.
  const { data: paymentIntents, error: paymentIntentsError } = await supabase
    .from("payment_intents")
    .select(
      "id, storefront_id, operator_distributor_id, order_id, provider, amount, currency, status, provider_reference, processed_at, created_at, updated_at"
    )
    .eq("order_id", orderId);

  if (paymentIntentsError) {
    throw new OrderFetchError(
      `Failed to fetch payment intents for order "${orderId}": ${paymentIntentsError.message}`,
      "PAYMENT_INTENTS_FETCH_FAILED"
    );
  }

  // ── 3.5 Fetch shipments ───────────────────────────────────────────────────
  //   An order may have zero, one, or multiple shipments.
  //   An empty array is valid — the mapper handles this case.
  const { data: shipments, error: shipmentsError } = await supabase
    .from("shipments")
    .select(
      "id, storefront_id, operator_distributor_id, order_id, supplier_id, carrier, tracking_number, status, origin_country, destination_country, shipped_at, delivered_at, created_at, updated_at"
    )
    .eq("order_id", orderId);

  if (shipmentsError) {
    throw new OrderFetchError(
      `Failed to fetch shipments for order "${orderId}": ${shipmentsError.message}`,
      "SHIPMENTS_FETCH_FAILED"
    );
  }

  // ── 3.6 Fetch tracking events ─────────────────────────────────────────────
  //   Only fetch if there are shipments to attach events to.
  let trackingEvents: RawOrderSource["trackingEvents"] = [];

  if (shipments && shipments.length > 0) {
    const shipmentIds = shipments.map((s) => s.id);

    const { data: eventsData, error: eventsError } = await supabase
      .from("shipment_tracking_events")
      .select("id, shipment_id, status, location, message, event_time, created_at")
      .in("shipment_id", shipmentIds);

    if (eventsError) {
      throw new OrderFetchError(
        `Failed to fetch tracking events for order "${orderId}": ${eventsError.message}`,
        "TRACKING_EVENTS_FETCH_FAILED"
      );
    }

    trackingEvents = (eventsData ?? []) as RawOrderSource["trackingEvents"];
  }

  // ── 3.7 Fetch order events (optional — used for future timeline enrichment)
  const { data: orderEvents, error: orderEventsError } = await supabase
    .from("order_events")
    .select(
      "id, order_id, type, payload, actor_type, actor_user_id, created_at"
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (orderEventsError) {
    throw new OrderFetchError(
      `Failed to fetch order events for order "${orderId}": ${orderEventsError.message}`,
      "ORDER_EVENTS_FETCH_FAILED"
    );
  }

  // ── 3.8 Compose RawOrderSource and delegate to mapper ─────────────────────
  const source: RawOrderSource = {
    order: order as RawOrderSource["order"],
    items: (items ?? []) as RawOrderSource["items"],
    itemEnrichments: options?.itemEnrichments,
    customer: customer as RawOrderSource["customer"],
    paymentIntents: (paymentIntents ?? []) as RawOrderSource["paymentIntents"],
    shipments: (shipments ?? []) as RawOrderSource["shipments"],
    trackingEvents,
    orderEvents: (orderEvents ?? []) as RawOrderSource["orderEvents"],
  };

  return mapOrderSummary(source);
}
