// ─────────────────────────────────────────────────────────────────────────────
// app/(account)/account/page.tsx
//
// Account overview route — /account
//
// Responsibilities (and only these):
//   1. Protect the route via requireAuth with customer linkage enforced
//   2. Call getAccountOverview with the resolved session
//   3. Call getCustomerOrders with the resolved customer context
//   4. Call getWishlistItems with the resolved customer context
//   5. Render AccountPageTemplate with all resolved data
//
// Architecture notes:
//   - requireAuth is called with requireCustomer: true because this route
//     depends on customer-facing data (orders, wishlist, profile). Without
//     a linked customer row the page cannot render meaningfully.
//   - storefrontId is passed to requireAuth to enable precise storefront-scoped
//     customer resolution and avoid the ambiguous email-only fallback path.
//   - The normalized AuthenticatedSession returned by requireAuth carries
//     session.customer and session.storefrontId — these are passed directly
//     into the read functions without reshaping or re-deriving in the page.
//   - No normalization, no mapper logic, no UI composition beyond the template.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { requireAuth } from "@/lib/guards/require-auth";
import { getAccountOverview } from "@/features/account/lib/get-account-overview";
import { getCustomerOrders } from "@/features/orders/lib/get-customer-orders";
import { getWishlistItems } from "@/features/wishlist/lib/get-wishlist-items";
import { AccountPageTemplate } from "@/features/account/components/account-page-template";

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "My Account",
  robots: { index: false, follow: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function AccountPage() {
  // 1. Protect route — requires authentication and a linked customer record.
  //    Passing requireCustomer: true ensures the read functions below always
  //    receive a non-null customer. Without a linked customer this page cannot
  //    render order history or wishlist data meaningfully.
  //    storefrontId is resolved from the session by the guard itself when the
  //    storefront is determinable from the request context; pass it explicitly
  //    here if it is available from the route layout or env.
  const session = await requireAuth({
    requireCustomer: true,
    returnTo: "/account",
  });

  // Derive the customer and storefront context from the resolved session.
  // requireCustomer: true guarantees session.customer is non-null here.
  // TypeScript cannot narrow this automatically through the branded type
  // without a runtime assertion — the non-null assertion is intentional
  // and safe given the guard contract above.
  const customer = session.customer!;
  const storefrontId = session.storefrontId ?? customer.storefrontId ?? undefined;

  // 2. Fetch the account overview (profile, address summary, storefront context).
  const overview = await getAccountOverview({
    customerId: customer.customerId!,
    authUserId: customer.authUserId,
    storefrontId,
  });

  // 3. Fetch the customer's order history for this storefront.
  const orders = await getCustomerOrders({
    customerId: customer.customerId!,
    storefrontId,
  });

  // 4. Fetch the customer's saved wishlist items.
  const wishlist = await getWishlistItems({
    customerId: customer.customerId!,
    storefrontId,
  });

  // 5. Render the account page template with all resolved data.
  return (
    <AccountPageTemplate
      session={session}
      overview={overview}
      orders={orders}
      wishlist={wishlist}
    />
  );
}

