import type {
  OrderAddress,
  OrderCustomer,
} from "@/features/orders/types/order.types";
import { formatAddress } from "./order-confirmation.utils";

interface BillingDetailsCardProps {
  customer: OrderCustomer;
  billingAddress: OrderAddress;
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

export function BillingDetailsCard({
  customer,
  billingAddress,
}: BillingDetailsCardProps) {
  return (
    <section
      aria-label="Billing details"
      className="flex flex-col rounded-lg border border-border bg-card text-card-foreground"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          Billing
        </h2>
      </div>

      <div className="flex-1 px-5 py-4">
        <dl className="flex flex-col gap-3">
          <DetailField label="Name" value={customer.fullName} />
          <DetailField label="Email" value={customer.email} />
          {customer.phone ? <DetailField label="Phone" value={customer.phone} /> : null}
          <DetailField label="Address" value={formatAddress(billingAddress)} />
          {billingAddress.city ? (
            <DetailField label="City" value={billingAddress.city} />
          ) : null}
          {billingAddress.stateProvince ?? billingAddress.region ? (
            <DetailField
              label="State / Province"
              value={billingAddress.stateProvince ?? billingAddress.region ?? "—"}
            />
          ) : null}
          {billingAddress.postalCode ? (
            <DetailField label="Postal code" value={billingAddress.postalCode} />
          ) : null}
          <DetailField label="Country" value={billingAddress.country} />
        </dl>
      </div>
    </section>
  );
}