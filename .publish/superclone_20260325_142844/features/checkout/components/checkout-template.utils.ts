import type { CheckoutAddress, CheckoutState } from "@/features/checkout/types/checkout.types";

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatAddress(address: CheckoutAddress): string {
  const parts = [
    [address.firstName, address.lastName].filter(Boolean).join(" "),
    address.addressLine1,
    address.addressLine2,
    [address.city, address.stateProvince ?? address.region, address.postalCode]
      .filter(Boolean)
      .join(", "),
    address.country,
  ].filter(Boolean);

  return parts.join(", ");
}

export function stateToStepIndex(state: CheckoutState): number {
  switch (state) {
    case "idle":
    case "validating":
      return 1;
    case "ready":
      return 2;
    case "processing":
    case "failed":
    case "succeeded":
      return 3;
    default:
      return 0;
  }
}

export const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Credit / Debit Card",
  paypal: "PayPal",
  crypto: "Cryptocurrency",
  manual: "Manual Payment",
};

export const CHECKOUT_STEPS = ["Cart", "Shipping", "Payment", "Review"] as const;