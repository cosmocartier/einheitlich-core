// ─────────────────────────────────────────────────────────────────────────────
// features/auth/types/auth.types.ts
//
// Canonical type system for the Blackframe / Blackswan auth and identity domain.
// Server-first. Storefront-scoped. Infrastructure-grade.
//
// Backend facts this file is grounded in:
//   - Supabase Auth owns auth.users(id) — the root identity anchor
//   - public.profiles(user_id → auth.users.id) — profile data separate from auth
//   - public.customers(id, storefront_id, distributor_id, ...) — separate domain
//   - public.platform_users(user_id → auth.users.id, role) — operator-level roles
//   - orders.customer_id → customers.id (NOT auth users directly)
//   - Not every auth user has a customer row; not every customer has an auth user
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. CORE ENUMS / UNIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether the storefront visitor is signed in or anonymous.
 * Distinct from guest checkout — a guest checkout customer is anonymous
 * at the auth layer but may still have a customer row created post-purchase.
 */
export type AuthSessionStatus = "authenticated" | "anonymous" | "loading";

/**
 * The identity resolution state of the session.
 *
 * resolved    → auth user confirmed server-side, profile and customer linkage attempted
 * partial     → auth user confirmed, but profile or customer linkage is incomplete
 * unresolved  → no valid auth session (anonymous visitor)
 * error       → auth state could not be determined (token expired, network, etc.)
 */
export type AuthIdentityState = "resolved" | "partial" | "unresolved" | "error";

/**
 * Whether the storefront customer record is linked and usable.
 *
 * linked          → customer row exists and is tied to the auth user
 * not_linked      → auth user exists but no customer row found for this storefront
 * provisioning    → customer row creation is in progress (post-signup flow)
 * deprovisioned   → customer row existed but has been removed or deactivated
 */
export type CustomerLinkState =
  | "linked"
  | "not_linked"
  | "provisioning"
  | "deprovisioned";

/**
 * Storefront-level role hint for the authenticated user.
 *
 * Represents the highest-privilege role relevant to the storefront layer only.
 * Platform operator / Blackswan admin roles are NOT represented here —
 * those live in platform_users and are resolved outside the storefront contract.
 *
 * customer    → standard authenticated storefront customer (default)
 * vip         → customer with elevated storefront permissions (e.g. early access)
 * staff       → storefront staff with limited admin visibility
 */
export type AuthStorefrontRole = "customer" | "vip" | "staff";

/**
 * The mode the auth session is operating in relative to checkout.
 * Useful for checkout-linked auth flows (e.g. login-to-continue-checkout).
 *
 * standalone   → auth flow is independent of any checkout session
 * checkout     → auth flow was initiated in the context of an active checkout
 */
export type AuthSessionMode = "standalone" | "checkout";

/**
 * The reason a redirect was triggered within an auth flow.
 * Enables the login / sign-up pages to render appropriate messaging
 * and restore the intended destination after auth completes.
 *
 * guard           → route guard intercepted an unauthenticated request
 * login_required  → explicit login prompt (e.g. from account link)
 * checkout_gate   → checkout flow required auth before proceeding
 * post_signup     → redirect after successful sign-up
 * post_signout    → redirect after sign-out
 * session_expired → prior session expired, re-authentication required
 */
export type AuthRedirectReason =
  | "guard"
  | "login_required"
  | "checkout_gate"
  | "post_signup"
  | "post_signout"
  | "session_expired";

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUPPORTING SUBTYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A minimal reference to the Supabase Auth user.
 * This is NOT a raw dump of auth.users — only the fields
 * the storefront layer meaningfully consumes.
 */
export interface AuthUserReference {
  /** auth.users.id — the root identity anchor across all Blackswan tables. */
  authUserId: string;
  email: string;
  /** ISO 8601 — from auth.users.created_at. */
  createdAt: string;
  /** ISO 8601 — from auth.users.last_sign_in_at. */
  lastSignInAt: string | null;
}

/**
 * Normalized public profile for the authenticated user.
 * Aligns with public.profiles(user_id, full_name, email, created_at, updated_at).
 *
 * Separate from customer data — profiles are account-level identity,
 * customers are storefront-scoped commercial records.
 */
export interface AuthProfile {
  /** Foreign key: public.profiles.user_id → auth.users.id */
  userId: string;
  fullName: string | null;
  email: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal address summary surfaced on the authenticated customer.
 * Not the full OrderAddress — this is a lightweight convenience
 * for account pages and pre-filling checkout.
 * Aligns with the address columns on public.customers.
 */
export interface AuthCustomerAddressSummary {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string | null;
  region: string | null;
  postalCode: string;
  country: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AuthenticatedCustomer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The normalized customer identity attached to an authenticated storefront user.
 *
 * Bridges three separate backend concerns:
 *   1. Supabase Auth identity (auth.users)
 *   2. Public profile (public.profiles)
 *   3. Storefront-scoped customer record (public.customers)
 *
 * This is the primary identity object consumed by account pages,
 * order history, checkout pre-fill, and guard logic after login.
 *
 * Honest about the backend:
 *   - Not every auth user has a customer row — `customerLinkState` reflects this
 *   - Profile and customer data are separate — both are optional enrichment
 *   - customerId / storefrontId / distributorId are only present when linked
 */
export interface AuthenticatedCustomer {
  /** From auth.users.id — always present for authenticated users. */
  authUserId: string;

  /** From public.profiles.user_id — matches authUserId when profile exists. */
  profileUserId: string | null;

  /** From public.customers.id — null when no customer row is linked. */
  customerId: string | null;

  /** Blackswan storefront id scoping the customer record. */
  storefrontId: string | null;

  /** Operator / distributor id scoping the customer record. */
  distributorId: string | null;

  email: string;
  firstName: string;
  lastName: string;
  /** Convenience: firstName + " " + lastName. */
  fullName: string;
  phone: string | null;
  country: string | null;

  /**
   * Operator-defined customer tags (e.g. ["vip", "wholesale"]).
   * Empty array when no tags or when customer row is not linked.
   */
  tags: string[];

  /**
   * Primary address summary for account/checkout pre-fill.
   * Null when the customer row is not linked or address is unpopulated.
   */
  address: AuthCustomerAddressSummary | null;

  /** Whether the customer row is fully provisioned and linked to this auth user. */
  customerLinkState: CustomerLinkState;

  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. AuthRedirectTarget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized redirect destination for storefront auth flows.
 *
 * Structured as a typed contract rather than a bare URL string so that
 * the login page, sign-up page, guards, and middleware can reason about
 * intent, restore destination context, and render appropriate messaging —
 * without parsing or reconstructing URL state manually.
 *
 * path        → the destination path within the storefront (e.g. "/account/orders")
 * reason      → why the redirect was triggered (for UI messaging and analytics)
 * mode        → whether this auth flow is standalone or checkout-linked
 * returnPath  → the original path to restore after auth completes
 *               (e.g. "/checkout?sessionId=..." for checkout-gate flows)
 * params      → optional key/value context to forward to the destination
 *               (e.g. { sessionId: "...", coupon: "SAVE10" } for checkout return)
 */
export interface AuthRedirectTarget {
  /** Destination path after the auth action completes. */
  path: string;
  reason: AuthRedirectReason;
  mode: AuthSessionMode;
  /**
   * The path the user originally requested before auth intercepted.
   * Null for flows that do not require restoring a prior destination
   * (e.g. post_signout → home, post_signup → sign-up-success).
   */
  returnPath: string | null;
  /**
   * Optional query / context params to carry to the destination.
   * Typed as string values to remain URL-safe without manual encoding.
   */
  params: Record<string, string> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. AuthSession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level normalized storefront auth contract.
 *
 * Represents the current authenticated identity context for the storefront layer.
 * Suitable for:
 *   - Route guards and middleware
 *   - Protected account page contracts
 *   - Checkout-linked auth flows
 *   - Server Components that need to branch on auth state
 *   - Anonymous visitor handling
 *
 * Honest about the backend separation:
 *   - `user` is present only when Supabase Auth confirms a valid session
 *   - `profile` is present only when public.profiles has a row for this user
 *   - `customer` is present only when a customer row is linked for this storefront
 *   - Being authenticated does NOT imply having a profile or customer record
 *   - Being anonymous does NOT preclude having a guest checkout customer row elsewhere
 *
 * This type is NOT the checkout session — it does not carry cart, line items,
 * or payment state. It is strictly identity context for the storefront layer.
 */
export interface AuthSession {
  status: AuthSessionStatus;
  identityState: AuthIdentityState;

  /** True when status is "authenticated" and identityState is "resolved" or "partial". */
  isAuthenticated: boolean;

  /** True when status is "anonymous". */
  isAnonymous: boolean;

  /**
   * True when the session has been confirmed server-side and is safe
   * to use for guarded operations. False during loading or error states.
   */
  isReady: boolean;

  /** Supabase Auth user reference. Null when anonymous or on error. */
  user: AuthUserReference | null;

  /**
   * Public profile for the authenticated user.
   * Null when anonymous, or when no profile row exists yet (partial identity).
   */
  profile: AuthProfile | null;

  /**
   * Authenticated customer identity bridging auth + profile + customer row.
   * Null when anonymous, or when no customer row is linked for this storefront.
   * Check `customer.customerLinkState` to distinguish "not yet linked" from errors.
   */
  customer: AuthenticatedCustomer | null;

  /**
   * Storefront id scoping this session.
   * Present when the session is resolved within a known storefront context.
   * Null for platform-level or tenant-indeterminate sessions.
   */
  storefrontId: string | null;

  /**
   * Highest-privilege storefront role for this user.
   * Null when anonymous or when no role has been resolved.
   * Does NOT represent platform-admin or Blackswan operator roles.
   */
  storefrontRole: AuthStorefrontRole | null;

  /**
   * Whether this session is operating in a checkout-linked auth mode.
   * Used to restore checkout context after login / sign-up.
   */
  mode: AuthSessionMode;

  /** ISO 8601 — when this auth session was established. Null when anonymous. */
  sessionCreatedAt: string | null;

  /** ISO 8601 — last confirmed activity timestamp. Null when anonymous. */
  lastSeenAt: string | null;
}
