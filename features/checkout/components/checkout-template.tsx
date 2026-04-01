"use client";

import type { CheckoutSession } from "@/features/checkout/types/checkout.types";
import { CheckoutErrorBanner } from "./checkout-error-banner";
import { CheckoutForm } from "./checkout-form";
import { CheckoutLayout } from "./checkout-layout";
import { CheckoutProgress } from "./checkout-progress";
import { OrderSummary } from "./order-summary";

interface CheckoutTemplateProps {
  session: CheckoutSession;
}

export function CheckoutTemplate({ session }: CheckoutTemplateProps) {
  const hasError =
    session.state === "failed" ||
    session.lineItems.some((item) => item.availability === "out_of_stock");

  return (
    <main className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Checkout
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Session <span className="font-mono text-xs">{session.sessionId}</span>
          </p>
        </header>

        <CheckoutProgress state={session.state} />

        {hasError ? (
          <CheckoutErrorBanner
            state={session.state}
            lineItems={session.lineItems}
            availableShippingMethods={session.availableShippingMethods}
            availablePaymentMethods={session.availablePaymentMethods}
          />
        ) : null}

        <CheckoutLayout
          form={
            <CheckoutForm
              session={session}
              customer={session.customer}
              shippingMethods={session.availableShippingMethods}
              paymentMethods={session.availablePaymentMethods}
              notes={session.notes}
            />
          }
          summary={
            <OrderSummary
              lineItems={session.lineItems}
              totals={session.totals}
              discount={session.discount}
              selectedShippingMethod={session.selectedShippingMethod}
            />
          }
        />
      </div>
    </main>
  );
}

export default CheckoutTemplate;