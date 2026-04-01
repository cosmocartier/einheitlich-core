import type {
  OrderAddress,
  OrderFulfillmentStatus,
  OrderStatusReference,
  OrderTimelineStatus,
} from "@/features/orders/types/order.types";

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatAddress(address: OrderAddress): string {
  const nameParts = [address.firstName, address.lastName]
    .filter(Boolean)
    .join(" ");

  const stateOrRegion = address.stateProvince ?? address.region ?? null;

  const lines = [
    nameParts || null,
    address.addressLine1,
    address.addressLine2 ?? null,
    [address.city, stateOrRegion, address.postalCode].filter(Boolean).join(", "),
    address.country,
  ].filter(Boolean);

  return lines.join(", ");
}

export const ORDER_STATUS_LABELS: Record<OrderStatusReference, string> = {
  pending_payment: "Pending Payment",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  refunded: "Refunded",
  canceled: "Canceled",
};

export const TIMELINE_STATUS_LABELS: Record<OrderTimelineStatus, string> = {
  pending_payment: "Pending Payment",
  confirmed: "Confirmed",
  processing: "Processing",
  ready_to_ship: "Ready to Ship",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  returned: "Returned",
  refunded: "Refunded",
  canceled: "Canceled",
};

export const FULFILLMENT_STATUS_LABELS: Record<OrderFulfillmentStatus, string> = {
  not_yet_shipped: "Not Yet Shipped",
  label_created: "Label Created",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  exception: "Exception",
  returned: "Returned",
  canceled: "Canceled",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  created: "Created",
  processing: "Processing",
  succeeded: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  canceled: "Canceled",
};

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  label_created: "Label Created",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  exception: "Exception",
  returned: "Returned",
  canceled: "Canceled",
};