import type {
  CheckoutLineItem,
  CheckoutPaymentMethod,
  CheckoutShippingMethod,
  CheckoutState,
} from "@/features/checkout/types/checkout.types";

interface CheckoutErrorBannerProps {
  state: CheckoutState;
  lineItems: CheckoutLineItem[];
  availableShippingMethods: CheckoutShippingMethod[];
  availablePaymentMethods: CheckoutPaymentMethod[];
}

export function CheckoutErrorBanner({
  state,
  lineItems,
  availableShippingMethods,
  availablePaymentMethods,
}: CheckoutErrorBannerProps) {
  const messages: string[] = [];

  if (state === "failed") {
    messages.push(
      "Payment could not be processed. Please review your payment details and try again."
    );
  }

  const outOfStock = lineItems.filter(
    (item) => item.availability === "out_of_stock",
  );

  if (outOfStock.length > 0) {
    const names = outOfStock.map((item) => item.productName).join(", ");
    messages.push(
      `The following item${outOfStock.length > 1 ? "s are" : " is"} out of stock and cannot be purchased: ${names}.`,
    );
  }

  const noShipping =
    availableShippingMethods.length > 0 &&
    availableShippingMethods.every((method) => !method.available);

  if (noShipping) {
    messages.push(
      "No shipping methods are currently available for your address.",
    );
  }

  const noPayment =
    availablePaymentMethods.length > 0 &&
    availablePaymentMethods.every((method) => !method.available);

  if (noPayment) {
    messages.push(
      "No payment methods are currently available. Please contact support.",
    );
  }

  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mt-6 flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
    >
      {messages.map((message, index) => (
        <p key={index} className="text-sm leading-relaxed text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}