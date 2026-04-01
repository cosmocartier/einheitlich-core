// ─────────────────────────────────────────────────────────────────────────────
// lib/mappers/checkout.mapper.ts
//
// Transforms composed checkout source payloads into normalized CheckoutSession
// contracts for the Blackframe storefront layer.
//
// There is no dedicated checkout_sessions backend table. The mapper assembles
// a CheckoutSession from the set of source records the calling layer provides:
// customer, product/variant/image data, storefront pricing, coupon, selected
// shipping, and selected payment method.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CheckoutSession,
  CheckoutCustomer,
  CheckoutAddress,
  CheckoutLineItem,
  CheckoutLineItemAvailability,
  CheckoutTotals,
  CheckoutShippingMethod,
  CheckoutPaymentMethod,
  CheckoutPaymentProvider,
  CheckoutPaymentIntentStatus,
  CheckoutState,
  CheckoutReadiness,
  CheckoutDiscountSummary,
  CheckoutAuthState,
  CheckoutAuthMode,
} from "@/features/checkout/types/checkout.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOCAL RAW INPUT TYPES
//    Raw backend record shapes this mapper accepts.
//    Mapper-local only — callers compose the source object before passing in.
// ─────────────────────────────────────────────────────────────────────────────

interface RawCustomer {
  id: string;
  storefront_id: string;
  distributor_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state_province: string | null;
  region: string | null;
  postal_code: string | null;
  created_at: string;
  updated_at: string;
}

interface RawProduct {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  price: number;
  retail_price: number | null;
  category: string | null;
  sub_category: string | null;
}

interface RawProductVariant {
  id: string;
  product_id: string;
  sku: string | null;
  variant_label: string | null;
  size_value: string | null;
  color_value: string | null;
  material_value: string | null;
  price_override: number | null;
  retail_price_override: number | null;
  status: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

interface RawProductImage {
  id: string;
  product_id: string;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean;
  source: string | null;
  cloudflare_image_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Optional storefront-level price override for a product. */
interface RawStorefrontProductPricing {
  product_id: string;
  price_override: number | null;
  retail_price_override: number | null;
}

interface RawCoupon {
  code: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  status: string;
  usage_limit: number | null;
  usage_count: number;
  starts_at: string | null;
  ends_at: string | null;
}

/** A single item in the raw cart — references product/variant by id. */
interface RawCartItem {
  lineItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

/** Caller-supplied shipping option definitions. */
interface RawShippingOption {
  id: string;
  label: string;
  description: string | null;
  carrier: string | null;
  price: number;
  currency: string;
  estimatedDelivery: string | null;
  available: boolean;
}

/** Caller-supplied payment method definitions. */
interface RawPaymentOption {
  id: string;
  provider: CheckoutPaymentProvider;
  label: string;
  description: string | null;
  available: boolean;
  intentStatus: CheckoutPaymentIntentStatus | null;
}

/**
 * The full composed source object passed into mapCheckoutSession.
 * The calling layer is responsible for assembling this from backend records.
 */
export interface RawCheckoutSource {
  sessionId: string;
  storefrontId: string;
  operatorDistributorId: string;
  currency: string;
  createdAt: string;
  updatedAt: string;

  authUserId: string | null;
  authMode: CheckoutAuthMode;
  authVerified: boolean;

  /** Registered customer record. Null for pure guest sessions. */
  customer: RawCustomer | null;
  /**
   * For guest checkout: minimal identity fields when no customer record exists.
   * Ignored when customer is provided.
   */
  guestEmail: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestPhone: string | null;

  /** Override shipping address when different from the customer record address. */
  shippingAddressOverride: Partial<RawCustomer> | null;
  /** Override billing address when different from shipping. */
  billingAddressOverride: Partial<RawCustomer> | null;
  billingSameAsShipping: boolean;

  cartItems: RawCartItem[];
  products: RawProduct[];
  variants: RawProductVariant[];
  images: RawProductImage[];
  storefrontPricing: RawStorefrontProductPricing[];

  shippingOptions: RawShippingOption[];
  selectedShippingOptionId: string | null;

  paymentOptions: RawPaymentOption[];
  selectedPaymentOptionId: string | null;

  coupon: RawCoupon | null;
  notes: string | null;
  checkoutState: CheckoutState;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SMALL PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Safely trim a string; return null if blank or absent. */
function nullIfBlank(value: string | null | undefined): string | null {
  if (!value || value.trim() === "") return null;
  return value.trim();
}

/** Round a monetary value to two decimal places. */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. NORMALIZATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAuthState(source: RawCheckoutSource): CheckoutAuthState {
  return {
    mode: source.authMode,
    authUserId: source.authUserId,
    verified: source.authVerified,
  };
}

/**
 * Attempt to produce a CheckoutAddress from a partial customer record shape.
 * Returns null when mandatory fields (line1, city, postalCode, country) are absent.
 */
function normalizeAddress(
  raw: Partial<RawCustomer>,
  firstName: string,
  lastName: string
): CheckoutAddress | null {
  if (!raw.address_line_1 || !raw.city || !raw.postal_code || !raw.country) {
    return null;
  }
  return {
    firstName,
    lastName,
    addressLine1: raw.address_line_1,
    addressLine2: nullIfBlank(raw.address_line_2 ?? null),
    city: raw.city,
    stateProvince: nullIfBlank(raw.state_province ?? null),
    region: nullIfBlank(raw.region ?? null),
    postalCode: raw.postal_code,
    country: raw.country,
  };
}

function normalizeCustomer(source: RawCheckoutSource): CheckoutCustomer | null {
  const raw = source.customer;
  const email = raw?.email ?? source.guestEmail;
  // Email is a hard requirement for checkout identity.
  if (!email) return null;

  const firstName = raw?.first_name ?? source.guestFirstName ?? "";
  const lastName = raw?.last_name ?? source.guestLastName ?? "";

  // Shipping address: prefer override, fall back to customer record.
  const shippingSource: Partial<RawCustomer> = source.shippingAddressOverride ?? raw ?? {};
  const shippingAddress = normalizeAddress(shippingSource, firstName, lastName);

  let billingAddress: CheckoutAddress | null = null;
  if (!source.billingSameAsShipping && source.billingAddressOverride) {
    billingAddress = normalizeAddress(source.billingAddressOverride, firstName, lastName);
  }

  return {
    customerId: raw?.id ?? null,
    authUserId: source.authUserId,
    authMode: source.authMode,
    email,
    firstName,
    lastName,
    phone: nullIfBlank(raw?.phone ?? source.guestPhone ?? null),
    shippingAddress,
    billingAddress,
    billingSameAsShipping: source.billingSameAsShipping,
  };
}

/**
 * Resolve the primary display image URL for a product.
 * Prefers is_primary=true, then lowest sort_order. Returns the source URL only
 * — Cloudflare image IDs are a delivery-layer detail not exposed here.
 */
function resolvePrimaryImageUrl(
  images: RawProductImage[],
  productId: string
): string | null {
  const candidates = images
    .filter((img) => img.product_id === productId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const primary = candidates.find((img) => img.is_primary) ?? candidates[0] ?? null;
  return primary ? nullIfBlank(primary.source) : null;
}

/**
 * Resolve the effective unit price for a line item.
 * Priority: variant price_override → storefront price_override → product base price.
 */
function resolveUnitPrice(
  product: RawProduct,
  variant: RawProductVariant | null,
  storefrontPricing: RawStorefrontProductPricing | null
): number {
  if (variant?.price_override != null) return variant.price_override;
  if (storefrontPricing?.price_override != null) return storefrontPricing.price_override;
  return product.price;
}

/**
 * Resolve the effective retail / compare-at price.
 * Priority: variant retail_price_override → storefront retail_price_override → product retail_price.
 */
function resolveRetailPrice(
  product: RawProduct,
  variant: RawProductVariant | null,
  storefrontPricing: RawStorefrontProductPricing | null
): number | null {
  if (variant?.retail_price_override != null) return variant.retail_price_override;
  if (storefrontPricing?.retail_price_override != null) return storefrontPricing.retail_price_override;
  return product.retail_price ?? null;
}

/** Map a variant status string to a storefront availability label. */
function resolveAvailability(variantStatus: string | null): CheckoutLineItemAvailability {
  switch (variantStatus) {
    case "out_of_stock":   return "out_of_stock";
    case "low_stock":      return "low_stock";
    case "discontinued":   return "discontinued";
    default:               return "available";
  }
}

function normalizeLineItems(source: RawCheckoutSource): CheckoutLineItem[] {
  return source.cartItems.map((cartItem) => {
    const product = source.products.find((p) => p.id === cartItem.productId) ?? null;
    const variant = cartItem.variantId
      ? (source.variants.find((v) => v.id === cartItem.variantId) ?? null)
      : null;
    const storefrontPricing =
      source.storefrontPricing.find((sp) => sp.product_id === cartItem.productId) ?? null;

    // A missing product is not a hard throw — the checkout remains renderable.
    // The availability flag will surface the issue to the UI layer.
    const unitPrice = product ? resolveUnitPrice(product, variant, storefrontPricing) : 0;
    const retailPrice = product ? resolveRetailPrice(product, variant, storefrontPricing) : null;
    const lineSubtotal = roundMoney(unitPrice * cartItem.quantity);
    const imageUrl = product ? resolvePrimaryImageUrl(source.images, product.id) : null;

    return {
      lineItemId: cartItem.lineItemId,
      productId: cartItem.productId,
      productSlug: nullIfBlank(product?.slug ?? null) ?? cartItem.productId,
      productName: product?.name ?? "Unknown Product",
      productBrand: null, // Not a current backend column.
      variantId: variant?.id ?? null,
      variantLabel: nullIfBlank(variant?.variant_label ?? null),
      sku: nullIfBlank(variant?.sku ?? null),
      attributes: {
        size:     nullIfBlank(variant?.size_value ?? null),
        color:    nullIfBlank(variant?.color_value ?? null),
        material: nullIfBlank(variant?.material_value ?? null),
      },
      imageUrl,
      quantity: cartItem.quantity,
      unitPrice,
      retailPrice,
      lineSubtotal,
      availability: resolveAvailability(variant?.status ?? null),
    };
  });
}

function normalizeShippingMethods(source: RawCheckoutSource): CheckoutShippingMethod[] {
  return source.shippingOptions.map((option) => ({
    id: option.id,
    label: option.label,
    description: nullIfBlank(option.description),
    carrier: nullIfBlank(option.carrier),
    price: option.price,
    currency: option.currency,
    estimatedDelivery: nullIfBlank(option.estimatedDelivery),
    available: option.available,
    selected: option.id === source.selectedShippingOptionId,
  }));
}

function normalizePaymentMethods(source: RawCheckoutSource): CheckoutPaymentMethod[] {
  return source.paymentOptions.map((option) => ({
    id: option.id,
    provider: option.provider,
    label: option.label,
    description: nullIfBlank(option.description),
    available: option.available,
    selected: option.id === source.selectedPaymentOptionId,
    intentStatus: option.intentStatus,
  }));
}

function normalizeDiscount(
  coupon: RawCoupon | null,
  subtotal: number,
  currency: string
): CheckoutDiscountSummary | null {
  if (!coupon) return null;

  let discountAmount: number;
  let discountPercent: number | null;

  if (coupon.discount_type === "percentage") {
    discountPercent = coupon.discount_value;
    discountAmount = roundMoney((subtotal * coupon.discount_value) / 100);
  } else {
    discountPercent = null;
    // Fixed discount cannot exceed the subtotal.
    discountAmount = roundMoney(Math.min(coupon.discount_value, subtotal));
  }

  const label =
    coupon.discount_type === "percentage"
      ? `${coupon.discount_value}% off`
      : `${currency} ${discountAmount.toFixed(2)} off`;

  return { code: coupon.code, label, discountAmount, discountPercent };
}

function normalizeTotals(
  lineItems: CheckoutLineItem[],
  selectedShipping: CheckoutShippingMethod | null,
  discount: CheckoutDiscountSummary | null,
  currency: string
): CheckoutTotals {
  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.lineSubtotal, 0));
  const shipping = selectedShipping?.price ?? 0;
  const discountAmount = discount?.discountAmount ?? 0;
  const total = roundMoney(Math.max(0, subtotal + shipping - discountAmount));
  return { subtotal, shipping, discount: discountAmount, total, currency };
}

function normalizeReadiness(
  customer: CheckoutCustomer | null,
  lineItems: CheckoutLineItem[],
  selectedShipping: CheckoutShippingMethod | null,
  selectedPayment: CheckoutPaymentMethod | null
): CheckoutReadiness {
  const customerReady =
    customer !== null &&
    customer.email.trim().length > 0 &&
    customer.shippingAddress !== null;

  const shippingReady = selectedShipping !== null && selectedShipping.available;

  const paymentReady = selectedPayment !== null && selectedPayment.available;

  const itemsOrderable =
    lineItems.length > 0 &&
    lineItems.every(
      (item) =>
        item.availability !== "out_of_stock" && item.availability !== "discontinued"
    );

  const allReady = customerReady && shippingReady && paymentReady && itemsOrderable;

  return { customerReady, shippingReady, paymentReady, allReady };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MAIN EXPORTED MAPPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a composed checkout source payload into a normalized CheckoutSession.
 *
 * The caller is responsible for assembling RawCheckoutSource from the
 * appropriate backend records before invoking this function.
 * This mapper performs no I/O and has no side effects.
 */
export function mapCheckoutSession(source: RawCheckoutSource): CheckoutSession {
  const auth = normalizeAuthState(source);
  const customer = normalizeCustomer(source);
  const lineItems = normalizeLineItems(source);

  const shippingMethods = normalizeShippingMethods(source);
  const selectedShippingMethod = shippingMethods.find((m) => m.selected) ?? null;

  const paymentMethods = normalizePaymentMethods(source);
  const selectedPaymentMethod = paymentMethods.find((m) => m.selected) ?? null;

  // Compute raw subtotal first — coupon discount math depends on it.
  const rawSubtotal = lineItems.reduce((sum, item) => sum + item.lineSubtotal, 0);
  const discount = normalizeDiscount(source.coupon, rawSubtotal, source.currency);

  const totals = normalizeTotals(lineItems, selectedShippingMethod, discount, source.currency);
  const readiness = normalizeReadiness(customer, lineItems, selectedShippingMethod, selectedPaymentMethod);

  return {
    sessionId: source.sessionId,
    storefrontId: source.storefrontId,
    operatorDistributorId: source.operatorDistributorId,
    currency: source.currency,
    auth,
    customer,
    lineItems,
    totals,
    availableShippingMethods: shippingMethods,
    selectedShippingMethod,
    availablePaymentMethods: paymentMethods,
    selectedPaymentMethod,
    state: source.checkoutState,
    readiness,
    discount,
    notes: nullIfBlank(source.notes),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
