import type { OrderShipmentSummary } from "@/features/orders/types/order.types";
import {
  formatDate,
  SHIPMENT_STATUS_LABELS,
} from "./order-confirmation.utils";

interface ShippingDetailsCardProps {
  shipment: OrderShipmentSummary | null;
}

interface DetailFieldProps {
  label: string;
  value: string;
  mono?: boolean;
}

function DetailField({ label, value, mono = false }: DetailFieldProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={[
          "break-words text-sm text-foreground",
          mono ? "font-mono" : "font-medium",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

export function ShippingDetailsCard({ shipment }: ShippingDetailsCardProps) {
  return (
    <section
      aria-label="Shipping details"
      className="flex flex-col rounded-lg border border-border bg-card text-card-foreground"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          Shipping
        </h2>
      </div>

      <div className="flex-1 px-5 py-4">
        {shipment === null ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Shipping information will appear here once your order has shipped.
          </p>
        ) : (
          <dl className="flex flex-col gap-3">
            {shipment.carrier ? (
              <DetailField label="Carrier" value={shipment.carrier} />
            ) : null}
            {shipment.trackingNumber ? (
              <DetailField
                label="Tracking number"
                value={shipment.trackingNumber}
                mono
              />
            ) : null}
            <DetailField
              label="Status"
              value={SHIPMENT_STATUS_LABELS[shipment.status] ?? shipment.status}
            />
            {shipment.originCountry ? (
              <DetailField label="Origin" value={shipment.originCountry} />
            ) : null}
            {shipment.destinationCountry ? (
              <DetailField
                label="Destination"
                value={shipment.destinationCountry}
              />
            ) : null}
            {shipment.shippedAt ? (
              <DetailField label="Shipped" value={formatDate(shipment.shippedAt)} />
            ) : null}
            {shipment.deliveredAt ? (
              <DetailField
                label="Delivered"
                value={formatDate(shipment.deliveredAt)}
              />
            ) : null}

            {shipment.tracking?.lastEventAt ? (
              <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-3">
                <dt className="text-xs text-muted-foreground">Latest update</dt>
                <dd className="text-sm text-foreground">
                  {shipment.tracking.currentLocation ? (
                    <span className="font-medium">
                      {shipment.tracking.currentLocation}
                    </span>
                  ) : null}
                  {shipment.tracking.currentLocation ? " — " : null}
                  {formatDate(shipment.tracking.lastEventAt)}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>
    </section>
  );
}