import type { OrderItem } from "@/features/orders/types/order.types";
import { formatCurrency } from "./order-confirmation.utils";

interface OrderItemsListProps {
  items: OrderItem[];
  currency: string;
}

interface OrderItemRowProps {
  item: OrderItem;
  currency: string;
}

function OrderItemRow({ item, currency }: OrderItemRowProps) {
  return (
    <li className="flex items-start gap-4 px-5 py-4">
      {item.imageUrl ? (
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
          <img
            src={item.imageUrl}
            alt={item.productName}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium leading-snug text-foreground text-pretty">
          {item.productName}
        </p>
        {item.variantLabel ? (
          <p className="text-xs text-muted-foreground">{item.variantLabel}</p>
        ) : null}
        {item.sku ? (
          <p className="font-mono text-xs text-muted-foreground">
            SKU: {item.sku}
          </p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          Qty: {item.quantity} × {formatCurrency(item.unitPrice, currency)}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatCurrency(item.lineSubtotal, currency)}
        </span>
      </div>
    </li>
  );
}

export function OrderItemsList({ items, currency }: OrderItemsListProps) {
  return (
    <section
      aria-label="Order items"
      className="rounded-lg border border-border bg-card text-card-foreground"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          Items Ordered
        </h2>
      </div>

      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No items found for this order.
        </p>
      ) : (
        <ul className="divide-y divide-border" role="list">
          {items.map((item) => (
            <OrderItemRow key={item.id} item={item} currency={currency} />
          ))}
        </ul>
      )}
    </section>
  );
}