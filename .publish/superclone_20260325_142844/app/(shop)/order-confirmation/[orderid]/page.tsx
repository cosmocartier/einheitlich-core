// ─────────────────────────────────────────────────────────────────────────────
// app/(shop)/order-confirmation/[orderid]/page.tsx
//
// Order confirmation route — /order-confirmation/[orderid]
//
// Responsibilities (and only these):
//   1. Resolve the dynamic route param and route-level access context
//   2. Call requireOrderAccess — validates access and returns the OrderSummary
//   3. Render OrderConfirmationTemplate with the resolved OrderSummary
//
// Architecture note:
//   requireOrderAccess internally calls getOrderById and returns the
//   normalized OrderSummary on success. This page does NOT call
//   getOrderById directly — that would add a redundant DB round-trip.
//   The guard's return value is the canonical order payload for this route.
//
// Security note:
//   Knowing an orderid alone is NOT sufficient for access.
//   The guard enforces either authenticated ownership (customerId match)
//   or validated guest proof (email, optionally + order number).
//   Neither path is bypassable from URL params alone.
//
// No normalization, no mapper logic, no UI composition beyond the template.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { requireOrderAccess } from "@/lib/guards/require-order-access";
import { OrderConfirmationTemplate } from "@/features/orders/components/order-confirmation-template";

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Order Confirmation",
  robots: { index: false, follow: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page props
// ─────────────────────────────────────────────────────────────────────────────

interface OrderConfirmationPageProps {
  params: Promise<{ orderid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route-level access context extraction
//
// This page supports two access paths, both assembled from route-level
// inputs only — no external service calls, no UI state:
//
// Path A — Authenticated:
//   Caller provides authUserId + customerId via session cookie / server
//   auth context. The page does not implement auth resolution here; it
//   accepts null for both when the auth layer is not wired yet, which
//   will cause the guard to fall through to Path B or deny.
//
//   In production, replace the null placeholders with real auth context
//   resolved from the server session (e.g. Supabase getUser(), or a
//   thin auth utility that reads the session server-side).
//
// Path B — Guest:
//   email is extracted from searchParams (?email=...).
//   orderNumber is extracted from searchParams (?order=...) when present.
//   Both are optional — the guard accepts either email-only or email+number.
//   Neither alone exposes the order; the guard validates them against the
//   fetched order's customer record.
//
// The page intentionally leaves auth resolution as a null placeholder so
// the route contract compiles cleanly against the guard's typed interface.
// Auth integration is wired here once the project's server-side session
// utility exists — not pre-empted with speculative patterns.
// ─────────────────────────────────────────────────────────────────────────────

function extractGuestProof(
  params: Record<string, string | string[] | undefined>
): { email: string | null; orderNumber: string | null } {
  const email =
    typeof params.email === "string" && params.email.trim().length > 0
      ? params.email.trim()
      : null;

  const orderNumber =
    typeof params.order === "string" && params.order.trim().length > 0
      ? params.order.trim()
      : null;

  return { email, orderNumber };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: OrderConfirmationPageProps) {
  // 1. Resolve dynamic route param and search params (Next.js 16 — async)
  const { orderid } = await params;
  const query = await searchParams;

  // 2. Extract guest proof from search params (Path B context)
  //    Replace the auth placeholders below (null, null) with real server-side
  //    session resolution once the project's auth layer is in place.
  const { email, orderNumber } = extractGuestProof(query);

  const authUserId: string | null = null;   // TODO: resolve from server session
  const customerId: string | null = null;   // TODO: resolve from server session

  // 3. Guard: validates access, fetches and normalizes the OrderSummary,
  //    redirects to "/" on failure. Returns the OrderSummary on success.
  //    Does NOT call getOrderById separately — the guard already does this.
  const order = await requireOrderAccess({
    orderId: orderid,
    authContext:
      authUserId !== null
        ? { authUserId, customerId }
        : null,
    guestProof:
      authUserId === null && email !== null
        ? { email, orderNumber, trustedByCallerLayer: false }
        : null,
    onFailure: "redirect",
    fallbackPath: "/",
  });

  // 4. Render the order confirmation template with the resolved summary
  return <OrderConfirmationTemplate order={order} />;
}

