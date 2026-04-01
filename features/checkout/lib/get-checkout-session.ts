// ─────────────────────────────────────────────────────────────────────────────
// features/checkout/lib/get-checkout-session.ts
//
// Main read function for the Blackframe checkout page.
//
// Responsibilities:
//   1. Accept a strongly-typed checkout input
//   2. Validate storefront existence and cart integrity
//   3. Fetch all raw backend data needed to assemble checkout
//   4. Compose a RawCheckoutSource and hand it to mapCheckoutSession
//   5. Return one clean CheckoutSession
//
// There is no dedicated checkout_sessions table in the backend.
// Checkout is assembled from storefront, customer, product, variant,
// image, storefront_product, and coupon source records.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import {
  mapCheckoutSession,
  type RawCheckoutSource,
} from "@/lib/mappers/checkout.mapper";
import type {
  CheckoutSession,
  CheckoutPaymentProvider,
  CheckoutPaymentIntentStatus,
  CheckoutState,
  CheckoutAuthMode,
} from "@/features/checkout/types/checkout.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A single item in the caller-supplied cart payload. */
export interface CheckoutCartItem {
  /** Stable client-side line item identifier (caller-generated UUID). */
  lineItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

/** A caller-supplied shipping option to present during checkout. */
export interface CheckoutShippingOption {
  id: string;
  label: string;
  description: string | null;
  carrier: string | null;
  price: number;
  currency: string;
  estimatedDelivery: string | null;
  available: boolean;
}

/** A caller-supplied payment option to present during checkout. */
export interface CheckoutPaymentOption {
  id: string;
  provider: CheckoutPaymentProvider;
  label: string;
  description: string | null;
  available: boolean;
  intentStatus: CheckoutPaymentIntentStatus | null;
}

/**
 * The full input required to assemble a checkout session.
 * Callers supply cart contents, selected options, and optional identity
 * context. The function resolves all backend data from these inputs.
 */
export interface GetCheckoutSessionInput {
  /** Blackswan storefront id scoping this session. */
  storefrontId: string;

  /** Stable session identifier — caller-generated on session init. */
  sessionId: string;

  /**
   * Supabase Auth user id, if the customer is authenticated.
   * When provided, the function will attempt to load the customers record
   * scoped to this storefront.
   */
  authUserId: string | null;

  /**
   * Backend customers.id, if already known (e.g. from a prior session).
   * Takes precedence over authUserId for customer lookup when provided.
   */
  customerId: string | null;

  /** Guest identity fields — used when no customer record can be resolved. */
  guestEmail: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestPhone: string | null;

  /** Line items in the cart. Must be non-empty. */
  cartItems: CheckoutCartItem[];

  /** Caller-defined shipping options to present in checkout. */
  shippingOptions: CheckoutShippingOption[];

  /** The id of the currently selected shipping option, if any. */
  selectedShippingOptionId: string | null;

  /** Caller-defined payment options to present in checkout. */
  paymentOptions: CheckoutPaymentOption[];

  /** The id of the currently selected payment option, if any. */
  selectedPaymentOptionId: string | null;

  /** Optional coupon code to validate and apply. */
  couponCode: string | null;

  /** Optional order notes from the customer. */
  notes: string | null;

  /**
   * Current checkout flow state — supplied by the calling layer.
   * Defaults to "idle" when not provided.
   */
  checkoutState?: CheckoutState;

  /**
   * ISO 8601 session creation timestamp.
   * Caller provides this so the session contract reflects when the
   * checkout was initiated, not when this function ran.
   */
  createdAt: string;

  /** ISO 8601 session last-updated timestamp. */
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERNAL ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class CheckoutSessionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "STOREFRONT_NOT_FOUND"
      | "EMPTY_CART"
      | "PRODUCT_NOT_FOUND"
      | "VARIANT_NOT_FOUND"
      | "COUPON_INVALID"
      | "COUPON_EXPIRED"
      | "COUPON_EXHAUSTED"
      | "FETCH_ERROR"
  ) {
    super(message);
    this.name = "CheckoutSessionError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Assert a coupon is currently usable. Throws CheckoutSessionError if not. */
function assertCouponUsable(
  coupon: {
    status: string;
    usage_limit: number | null;
    usage_count: number;
    starts_at: string | null;
    ends_at: string | null;
  },
  code: string
): void {
  if (coupon.status !== "active") {
    throw new CheckoutSessionError(
      `Coupon "${code}" is not active.`,
      "COUPON_INVALID"
    );
  }

  const now = new Date();

  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    throw new CheckoutSessionError(
      `Coupon "${code}" is not yet valid.`,
      "COUPON_EXPIRED"
    );
  }

  if (coupon.ends_at && new Date(coupon.ends_at) < now) {
    throw new CheckoutSessionError(
      `Coupon "${code}" has expired.`,
      "COUPON_EXPIRED"
    );
  }

  if (
    coupon.usage_limit !== null &&
    coupon.usage_count >= coupon.usage_limit
  ) {
    throw new CheckoutSessionError(
      `Coupon "${code}" has reached its usage limit.`,
      "COUPON_EXHAUSTED"
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MAIN EXPORTED FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble and return a normalized CheckoutSession for the given input.
 *
 * Fetches all raw backend records required by the checkout page,
 * composes a RawCheckoutSource, and delegates normalization to
 * mapCheckoutSession.
 *
 * Throws CheckoutSessionError on validation failures.
 * Throws on unexpected Supabase errors.
 */
export async function getCheckoutSession(
  input: GetCheckoutSessionInput
): Promise<CheckoutSession> {
  const supabase = await createClient();

  // ── 4.1 Validate cart is non-empty ────────────────────────────────────────
  if (input.cartItems.length === 0) {
    throw new CheckoutSessionError(
      "Cart is empty. Cannot initialize a checkout session.",
      "EMPTY_CART"
    );
  }

  // ── 4.2 Fetch and verify storefront ───────────────────────────────────────
  const { data: storefront, error: storefrontError } = await supabase
    .from("storefronts")
    .select("id, default_currency, status, operator_distributor_id")
    .eq("id", input.storefrontId)
    .single();

  if (storefrontError || !storefront) {
    throw new CheckoutSessionError(
      `Storefront "${input.storefrontId}" not found.`,
      "STOREFRONT_NOT_FOUND"
    );
  }

  const currency = storefront.default_currency as string;
  const operatorDistributorId = storefront.operator_distributor_id as string;

  // ── 4.3 Resolve customer record ───────────────────────────────────────────
  //   Priority: customerId → authUserId → guest (null customer record)
  const customerSelect =
    "id, storefront_id, distributor_id, first_name, last_name, email, phone, country, address_line_1, address_line_2, city, state_province, region, postal_code, created_at, updated_at";

  let customer: RawCheckoutSource["customer"] = null;

  if (input.customerId) {
    const { data, error } = await supabase
      .from("customers")
      .select(customerSelect)
      .eq("id", input.customerId)
      .eq("storefront_id", input.storefrontId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new CheckoutSessionError(
        `Failed to fetch customer: ${error.message}`,
        "FETCH_ERROR"
      );
    }

    customer = (data as RawCheckoutSource["customer"]) ?? null;
  } else if (input.authUserId) {
    const { data, error } = await supabase
      .from("customers")
      .select(customerSelect)
      .eq("storefront_id", input.storefrontId)
      .eq("auth_user_id", input.authUserId)
      .maybeSingle();

    if (error) {
      throw new CheckoutSessionError(
        `Failed to fetch customer by auth user: ${error.message}`,
        "FETCH_ERROR"
      );
    }

    customer = (data as RawCheckoutSource["customer"]) ?? null;
  }

  const authMode: CheckoutAuthMode =
    input.authUserId !== null ? "authenticated" : "guest";

  // ── 4.4 Collect unique product and variant ids from cart ──────────────────
  const productIds = [
    ...new Set(input.cartItems.map((item) => item.productId)),
  ];
  const variantIds = [
    ...new Set(
      input.cartItems
        .map((item) => item.variantId)
        .filter((id): id is string => id !== null)
    ),
  ];

  // ── 4.5 Fetch products ────────────────────────────────────────────────────
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select(
      "id, slug, name, description, price, retail_price, category, sub_category"
    )
    .in("id", productIds);

  if (productsError) {
    throw new CheckoutSessionError(
      `Failed to fetch products: ${productsError.message}`,
      "FETCH_ERROR"
    );
  }

  for (const cartItem of input.cartItems) {
    if (!products?.find((p) => p.id === cartItem.productId)) {
      throw new CheckoutSessionError(
        `Product "${cartItem.productId}" not found.`,
        "PRODUCT_NOT_FOUND"
      );
    }
  }

  // ── 4.6 Fetch variants ────────────────────────────────────────────────────
  let variants: RawCheckoutSource["variants"] = [];

  if (variantIds.length > 0) {
    const { data: variantData, error: variantError } = await supabase
      .from("product_variants")
      .select(
        "id, product_id, sku, variant_label, size_value, color_value, material_value, price_override, retail_price_override, status, sort_order, created_at, updated_at"
      )
      .in("id", variantIds);

    if (variantError) {
      throw new CheckoutSessionError(
        `Failed to fetch product variants: ${variantError.message}`,
        "FETCH_ERROR"
      );
    }

    for (const cartItem of input.cartItems) {
      if (
        cartItem.variantId &&
        !variantData?.find((v) => v.id === cartItem.variantId)
      ) {
        throw new CheckoutSessionError(
          `Product variant "${cartItem.variantId}" not found.`,
          "VARIANT_NOT_FOUND"
        );
      }
    }

    variants = (variantData ?? []) as RawCheckoutSource["variants"];
  }

  // ── 4.7 Fetch product images ──────────────────────────────────────────────
  const { data: images, error: imagesError } = await supabase
    .from("product_images")
    .select(
      "id, product_id, alt_text, sort_order, is_primary, source, cloudflare_image_id, created_at, updated_at"
    )
    .in("product_id", productIds);

  if (imagesError) {
    throw new CheckoutSessionError(
      `Failed to fetch product images: ${imagesError.message}`,
      "FETCH_ERROR"
    );
  }

  // ── 4.8 Fetch storefront product pricing overrides ────────────────────────
  const { data: storefrontPricing, error: pricingError } = await supabase
    .from("storefront_products")
    .select("product_id, price_override, retail_price_override")
    .eq("storefront_id", input.storefrontId)
    .in("product_id", productIds);

  if (pricingError) {
    throw new CheckoutSessionError(
      `Failed to fetch storefront product pricing: ${pricingError.message}`,
      "FETCH_ERROR"
    );
  }

  // ── 4.9 Optionally validate and fetch coupon ──────────────────────────────
  let coupon: RawCheckoutSource["coupon"] = null;

  if (input.couponCode) {
    const { data: couponData, error: couponError } = await supabase
      .from("coupons")
      .select(
        "code, discount_type, discount_value, status, usage_limit, usage_count, starts_at, ends_at"
      )
      .eq("storefront_id", input.storefrontId)
      .eq("code", input.couponCode)
      .single();

    if (couponError || !couponData) {
      throw new CheckoutSessionError(
        `Coupon "${input.couponCode}" is not valid for this storefront.`,
        "COUPON_INVALID"
      );
    }

    assertCouponUsable(
      couponData as {
        status: string;
        usage_limit: number | null;
        usage_count: number;
        starts_at: string | null;
        ends_at: string | null;
      },
      input.couponCode
    );

    coupon = couponData as RawCheckoutSource["coupon"];
  }

  // ── 4.10 Compose RawCheckoutSource and delegate to mapper ─────────────────
  const source: RawCheckoutSource = {
    sessionId: input.sessionId,
    storefrontId: input.storefrontId,
    operatorDistributorId,
    currency,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,

    authUserId: input.authUserId,
    authMode,
    authVerified: input.authUserId !== null,

    customer,
    guestEmail: input.guestEmail,
    guestFirstName: input.guestFirstName,
    guestLastName: input.guestLastName,
    guestPhone: input.guestPhone,

    shippingAddressOverride: null,
    billingAddressOverride: null,
    billingSameAsShipping: true,

    cartItems: input.cartItems,
    products: (products ?? []) as RawCheckoutSource["products"],
    variants,
    images: (images ?? []) as RawCheckoutSource["images"],
    storefrontPricing: (storefrontPricing ?? []) as RawCheckoutSource["storefrontPricing"],

    shippingOptions: input.shippingOptions,
    selectedShippingOptionId: input.selectedShippingOptionId,

    paymentOptions: input.paymentOptions,
    selectedPaymentOptionId: input.selectedPaymentOptionId,

    coupon,
    notes: input.notes,
    checkoutState: input.checkoutState ?? "idle",
  };

  return mapCheckoutSession(source);
}
