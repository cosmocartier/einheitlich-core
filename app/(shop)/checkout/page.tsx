// ─────────────────────────────────────────────────────────────────────────────
// app/(shop)/checkout/page.tsx
//
// Checkout route — /checkout
//
// Responsibilities (and only these):
//   1. Extract route-level context from searchParams
//   2. Call requireCheckoutSession — validates access and returns the session
//   3. Render CheckoutTemplate with the resolved CheckoutSession
//
// The guard (requireCheckoutSession) internally calls getCheckoutSession.
// This page does NOT call getCheckoutSession directly — the guard already
// returns the fully normalized CheckoutSession on success, so duplicating
// the call would add a redundant DB round-trip with no benefit.
//
// No normalization, no mapper logic, no UI composition beyond CheckoutTemplate.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { requireCheckoutSession } from "@/lib/guards/require-checkout-session";
import { CheckoutTemplate } from "@/features/checkout/components/checkout-template";
import type { GetCheckoutSessionInput } from "@/features/checkout/lib/get-checkout-session";

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page props
// ─────────────────────────────────────────────────────────────────────────────

interface CheckoutPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route-level input extraction
//
// Extracts the minimal set of values the checkout layer needs from the URL.
// All cart contents, shipping options, and payment options are caller-supplied
// context that flows from session state — not reconstructed from the URL.
// The page extracts only what is genuinely route-scoped:
//   - storefrontId  (identifies the tenant / storefront)
//   - sessionId     (stable client-generated session token)
//   - couponCode    (optional — applied via query param from cart/marketing)
//
// authUserId, customerId, cartItems, shippingOptions, paymentOptions, and
// notes are left as null / [] here because they are not route-level concerns.
// The CheckoutTemplate is responsible for hydrating session state client-side
// from its own context layer (cart store, auth context, etc.) and submitting
// updates via Server Actions — not via URL params.
// ─────────────────────────────────────────────────────────────────────────────

function extractCheckoutInput(
  params: Record<string, string | string[] | undefined>
): GetCheckoutSessionInput {
  const storefrontId = typeof params.storefrontId === "string"
    ? params.storefrontId.trim()
    : "";

  const sessionId = typeof params.sessionId === "string"
    ? params.sessionId.trim()
    : "";

  const couponCode = typeof params.coupon === "string"
    ? params.coupon.trim() || null
    : null;

  const now = new Date().toISOString();

  return {
    storefrontId,
    sessionId,
    authUserId: null,
    customerId: null,
    guestEmail: null,
    guestFirstName: null,
    guestLastName: null,
    guestPhone: null,
    cartItems: [],
    shippingOptions: [],
    selectedShippingOptionId: null,
    paymentOptions: [],
    selectedPaymentOptionId: null,
    couponCode,
    notes: null,
    checkoutState: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  // 1. Resolve searchParams (Next.js 16 — async)
  const params = await searchParams;

  // 2. Build the typed checkout context from route-level inputs
  const checkoutInput = extractCheckoutInput(params);

  // 3. Guard: validates the session is structurally sound, fetches and
  //    normalizes the CheckoutSession, redirects to /cart on failure.
  //    Returns the fully resolved CheckoutSession on success.
  const session = await requireCheckoutSession({
    checkout: checkoutInput,
    onFailure: "redirect",
    fallbackPath: "/cart",
  });

  // 4. Render the checkout template with the resolved session
  return <CheckoutTemplate session={session} />;
}

