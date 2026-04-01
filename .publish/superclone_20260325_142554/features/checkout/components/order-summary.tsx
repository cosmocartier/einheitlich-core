import type {
  CheckoutDiscountSummary,
  CheckoutLineItem,
  CheckoutShippingMethod,
  CheckoutTotals,
} from "@/features/checkout/types/checkout.types";
import { formatCurrency } from "./checkout-template.utils";

interface OrderSummaryProps {
  lineItems: CheckoutLineItem[];
  totals: CheckoutTotals;
  discount: CheckoutDiscountSummary | null;
  selectedShippingMethod: CheckoutShippingMethod | null;
}

export function OrderSummary({
  lineItems,
  totals,
  discount,
  selectedShippingMethod,
}: OrderSummaryProps) {
  const currency = totals.currency;

  return (
    <section
      aria-label="Order summary"
      className="flex flex-col gap-6 rounded-lg border border-border bg-muted/30 p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
        Order summary
      </h2>

      {lineItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your cart is empty.</p>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Cart items">
          {lineItems.map((item) => (
            <li key={item.lineItemId} className="flex gap-3">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.productName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-muted" aria-hidden="true" />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium leading-snug text-foreground text-balance">
                  {item.productName}
                </p>
                {item.variantLabel ? (
                  <p className="text-xs text-muted-foreground">
                    {item.variantLabel}
                  </p>
                ) : null}
                {item.sku ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    SKU: {item.sku}
                  </p>
                ) : null}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Qty {item.quantity} · {formatCurrency(item.unitPrice, currency)} each
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-foreground">
                    {formatCurrency(item.lineSubtotal, currency)}
                  </span>
                </div>
                {item.availability !== "available" ? (
                  <p
                    className={[
                      "mt-0.5 text-xs",
                      item.availability === "out_of_stock"
                        ? "text-destructive"
                        : "text-amber-600",
                    ].join(" ")}
                  >
                    {item.availability === "out_of_stock"
                      ? "Out of stock"
                      : item.availability === "low_stock"
                        ? "Low stock"
                        : item.availability === "discontinued"
                          ? "Discontinued"
                          : null}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border" aria-hidden="true" />

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="font-medium text-foreground">
            {formatCurrency(totals.subtotal, currency)}
          </dd>
        </div>

        {selectedShippingMethod ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              Shipping
              <span className="ml-1 font-normal text-muted-foreground">
                ({selectedShippingMethod.label})
              </span>
            </dt>
            <dd className="font-medium text-foreground">
              {totals.shipping === 0
                ? "Free"
                : formatCurrency(totals.shipping, currency)}
            </dd>
          </div>
        ) : null}

        {totals.discount > 0 && discount ? (
          <div className="flex justify-between text-green-700 dark:text-green-400">
            <dt>
              Discount
              <span className="ml-1 font-mono text-xs">({discount.code})</span>
            </dt>
            <dd className="font-medium">
              −{formatCurrency(totals.discount, currency)}
            </dd>
          </div>
        ) : null}

        {totals.tax !== undefined && totals.tax > 0 ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="font-medium text-foreground">
              {formatCurrency(totals.tax, currency)}
            </dd>
          </div>
        ) : null}

        <div className="mt-1 flex justify-between border-t border-border pt-3">
          <dt className="font-semibold text-foreground">Total</dt>
          <dd className="text-base font-bold text-foreground">
            {formatCurrency(totals.total, currency)}
          </dd>
        </div>
      </dl>

      {discount ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2">
          <p className="text-xs text-foreground">
            <span className="font-semibold">{discount.code}</span>{" "}
            <span className="text-muted-foreground">— {discount.label}</span>
          </p>
        </div>
      ) : null}
    </section>
  );
}