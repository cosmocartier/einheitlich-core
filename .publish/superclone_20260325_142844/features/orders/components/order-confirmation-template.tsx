import type { OrderSummary } from "@/features/orders/types/order.types";
import { BillingDetailsCard } from "./billing-details-card";
import { ContinueShoppingCTA } from "./continue-shopping-cta";
import { OrderItemsList } from "./order-items-list";
import { OrderSuccessHeader } from "./order-success-header";
import { OrderSummaryCard } from "./order-summary-card";
import { ShippingDetailsCard } from "./shipping-details-card";
import { SupportContactBlock } from "./support-contact-block";

interface OrderConfirmationTemplateProps {
  order: OrderSummary;
}

export function OrderConfirmationTemplate({
  order,
}: OrderConfirmationTemplateProps) {
  const billingAddress = order.customer.billingSameAsShipping
    ? order.customer.shippingAddress
    : (order.customer.billingAddress ?? order.customer.shippingAddress);

  return (
    <main className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 md:px-8 md:py-16">
        <OrderSuccessHeader
          orderNumber={order.orderNumber}
          createdAt={order.createdAt}
          timelineStatus={order.timelineStatus}
        />

        <OrderSummaryCard order={order} />

        <OrderItemsList items={order.items} currency={order.currency} />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ShippingDetailsCard shipment={order.shipment} />
          <BillingDetailsCard
            customer={order.customer}
            billingAddress={billingAddress}
          />
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <SupportContactBlock orderNumber={order.orderNumber} />
          <ContinueShoppingCTA />
        </div>
      </div>
    </main>
  );
}

export default OrderConfirmationTemplate;