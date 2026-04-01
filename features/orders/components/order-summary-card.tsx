import type { OrderSummary } from "@/features/orders/types/order.types";
import {
  FULFILLMENT_STATUS_LABELS,
  formatCurrency,
  formatDate,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  TIMELINE_STATUS_LABELS,
} from "./order-confirmation.utils";

interface OrderSummaryCardProps {
  order: OrderSummary;
}

interface SummaryFieldProps {
  label: string;
  value: string;
  mono?: boolean;
}

interface TotalsRowProps {
  label: string;
  value: string;
  bold?: boolean;
}

function SummaryField({ label, value, mono = false }: SummaryFieldProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={[
          "text-sm text-foreground",
          mono ? "font-mono" : "font-medium",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function TotalsRow({ label, value, bold = false }: TotalsRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span
        className={[
          "text-sm",
          bold ? "font-semibold text-foreground" : "text-muted-foreground",
        ].join(" ")}
      >
        {label}
      </span>
      <span
        className={[
          "text-sm tabular-nums",
          bold ? "font-semibold text-foreground" : "text-foreground",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

export function OrderSummaryCard({ order }: OrderSummaryCardProps) {
  return (
    <section
      aria-label="Order summary"
      className="rounded-lg border border-border bg-card text-card-foreground"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          Order Summary
        </h2>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <SummaryField label="Order number" value={order.orderNumber} mono />
          <SummaryField label="Order date" value={formatDate(order.createdAt)} />
          <SummaryField
            label="Order status"
            value={ORDER_STATUS_LABELS[order.orderStatus]}
          />
          <SummaryField
            label="Payment"
            value={
              PAYMENT_STATUS_LABELS[order.paymentStatus.status] ??
              order.paymentStatus.status
            }
          />
          <SummaryField
            label="Fulfillment"
            value={FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}
          />
          <SummaryField
            label="Timeline"
            value={TIMELINE_STATUS_LABELS[order.timelineStatus]}
          />
        </div>

        <div className="border-t border-border" aria-hidden="true" />

        <div className="flex flex-col gap-2">
          <TotalsRow
            label="Subtotal"
            value={formatCurrency(order.subtotal, order.currency)}
          />
          <TotalsRow
            label="Shipping"
            value={formatCurrency(order.shipping, order.currency)}
          />
          {typeof order.tax === "number" ? (
            <TotalsRow
              label="Tax"
              value={formatCurrency(order.tax, order.currency)}
            />
          ) : null}
          <div className="mt-1 border-t border-border pt-2">
            <TotalsRow
              label="Total"
              value={formatCurrency(order.total, order.currency)}
              bold
            />
          </div>
        </div>
      </div>
    </section>
  );
}