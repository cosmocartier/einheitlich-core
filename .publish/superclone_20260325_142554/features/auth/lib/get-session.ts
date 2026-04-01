// ─────────────────────────────────────────────────────────────────────────────
// features/auth/lib/get-session.ts
//
// Single source of truth for current identity state in Blackframe.
//
// Reads the Supabase Auth session server-side, resolves the related profile
// and storefront customer record, and returns one normalized AuthSession.
//
// This file is ONLY for session reading.
// No sign-in, sign-out, sign-up, redirects, guards, or mutations here.
//
// Backend separation this file respects:
//   auth.users          → root identity (Supabase Auth)
//   public.profiles     → account-level profile (user_id FK → auth.users.id)
//   public.customers    → storefront-scoped commercial identity (no direct auth FK)
//   public.platform_users → platform operator roles (NOT consumed by this file)
//
// Customer linkage is best-effort via email match:
//   There is no direct FK from customers → auth.users in the current schema.
//   We resolve by matching customers.email to the authenticated user's email,
//   optionally narrowed by storefront_id when storefront context is supplied.
//   This is explicitly documented at each resolution point below.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import type {
  AuthSession,
  AuthUserReference,
  AuthProfile,
  AuthenticatedCustomer,
  AuthCustomerAddressSummary,
  AuthStorefrontRole,
  CustomerLinkState,
} from "@/features/auth/types/auth.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. INPUT TYPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional storefront context for scoped customer resolution.
 * Without it, customer linkage falls back to email-only matching across all
 * storefronts — which may match the wrong customer row in multi-tenant setups.
 * Providing storefrontId is strongly preferred in storefront-scoped route code.
 */
export interface GetSessionInput {
  /** Narrow customer resolution to this storefront's rows. Preferred. */
  storefrontId?: string;
  /**
   * If provided, customer resolution is also validated against this email.
   * Useful when the caller wants an extra assertion on top of the profile email.
   * Normally left unset — the profile email is the primary resolution signal.
   */
  expectedCustomerEmail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RAW DB ROW TYPES (internal — not exported)
//
// Typed to the exact columns we SELECT. No `any`, no full-table wildcards.
// ─────────────────────────────────────────────────────────────────────────────

interface RawProfile {
  user_id: string;
  full_name: string | null;
  email: string;
  created_at: string;
  updated_at: string;
}

interface RawCustomer {
  id: string;
  storefront_id: string;
  distributor_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  tags: string[] | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state_province: string | null;
  region: string | null;
  postal_code: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HELPER — anonymous session
// ─────────────────────────────────────────────────────────────────────────────

function buildAnonymousSession(): AuthSession {
  return {
    status: "anonymous",
    identityState: "unresolved",
    isAuthenticated: false,
    isAnonymous: true,
    isReady: true,
    user: null,
    profile: null,
    customer: null,
    storefrontId: null,
    storefrontRole: null,
    mode: "standalone",
    sessionCreatedAt: null,
    lastSeenAt: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. HELPER — error session
//
// Returned when the auth state itself cannot be determined (token corrupt,
// network failure, unexpected Supabase error). Distinct from anonymous:
// the user *may* have a valid session we just cannot read right now.
// ─────────────────────────────────────────────────────────────────────────────

function buildErrorSession(): AuthSession {
  return {
    status: "anonymous",
    identityState: "error",
    isAuthenticated: false,
    isAnonymous: false,
    isReady: false,
    user: null,
    profile: null,
    customer: null,
    storefrontId: null,
    storefrontRole: null,
    mode: "standalone",
    sessionCreatedAt: null,
    lastSeenAt: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. HELPER — normalize AuthUserReference from Supabase User object
// ─────────────────────────────────────────────────────────────────────────────

function normalizeUserReference(
  // Supabase User type uses `any` for some metadata fields internally;
  // we extract only what we need with safe fallbacks.
  user: { id: string; email?: string; created_at: string; last_sign_in_at?: string }
): AuthUserReference {
  return {
    authUserId: user.id,
    email: user.email ?? "",
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. HELPER — normalize AuthProfile from raw DB row
// ─────────────────────────────────────────────────────────────────────────────

function normalizeProfile(raw: RawProfile): AuthProfile {
  return {
    userId: raw.user_id,
    fullName: raw.full_name,
    email: raw.email,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. HELPER — normalize address summary from raw customer row
//
// Returns null when all primary address fields are absent so callers
// can safely treat null as "no address on file" without checking each field.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAddressSummary(
  raw: RawCustomer
): AuthCustomerAddressSummary | null {
  if (!raw.address_line_1 || !raw.city || !raw.postal_code || !raw.country) {
    return null;
  }
  return {
    addressLine1: raw.address_line_1,
    addressLine2: raw.address_line_2 ?? null,
    city: raw.city,
    stateProvince: raw.state_province ?? null,
    region: raw.region ?? null,
    postalCode: raw.postal_code,
    country: raw.country,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. HELPER — normalize AuthenticatedCustomer from raw customer row
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAuthenticatedCustomer(
  authUserId: string,
  profileUserId: string | null,
  raw: RawCustomer,
  linkState: CustomerLinkState
): AuthenticatedCustomer {
  return {
    authUserId,
    profileUserId,
    customerId: raw.id,
    storefrontId: raw.storefront_id,
    distributorId: raw.distributor_id ?? null,
    email: raw.email,
    firstName: raw.first_name,
    lastName: raw.last_name,
    fullName: `${raw.first_name} ${raw.last_name}`.trim(),
    phone: raw.phone ?? null,
    country: raw.country ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    address: normalizeAddressSummary(raw),
    customerLinkState: linkState,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. HELPER — fetch profile row for the authenticated user
//
// Guaranteed: profile.user_id === authUserId when found.
// Not guaranteed: a profile row exists for every auth user.
// On Supabase error: returns null (does not break the session).
// ─────────────────────────────────────────────────────────────────────────────

async function fetchProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authUserId: string
): Promise<RawProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, created_at, updated_at")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (error) {
    // Profile fetch failure is non-critical — authenticated session continues.
    console.error("[get-session] profile fetch error:", error.message);
    return null;
  }

  return (data as RawProfile) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. HELPER — resolve customer row via email (+ optional storefront narrowing)
//
// Linkage strategy:
//   There is no direct FK from public.customers → auth.users in the current
//   schema. Resolution is best-effort via email match, optionally narrowed
//   by storefront_id to prevent cross-tenant row collisions in multi-tenant data.
//
// Priority:
//   1. storefrontId + email match  → most precise, preferred
//   2. email-only match            → fallback, may match across storefronts
//   3. no match                    → customer row does not exist for this user
//
// On multiple rows with email-only match:
//   Returns the most recently updated row. Callers expecting precise linkage
//   should always supply storefrontId to avoid ambiguity.
// ─────────────────────────────────────────────────────────────────────────────

async function resolveCustomer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  storefrontId: string | undefined
): Promise<RawCustomer | null> {
  const columns = [
    "id",
    "storefront_id",
    "distributor_id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "country",
    "tags",
    "address_line_1",
    "address_line_2",
    "city",
    "state_province",
    "region",
    "postal_code",
    "created_at",
    "updated_at",
  ].join(", ");

  // Path A: storefront-scoped match (preferred)
  if (storefrontId) {
    const { data, error } = await supabase
      .from("customers")
      .select(columns)
      .eq("email", email)
      .eq("storefront_id", storefrontId)
      .maybeSingle();

    if (error) {
      console.error("[get-session] customer (scoped) fetch error:", error.message);
      return null;
    }

    if (data) return data as RawCustomer;
  }

  // Path B: email-only fallback (may match across storefronts — take most recent)
  const { data, error } = await supabase
    .from("customers")
    .select(columns)
    .eq("email", email)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[get-session] customer (email-only) fetch error:", error.message);
    return null;
  }

  return (data as RawCustomer) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. HELPER — derive storefront role from customer tags
//
// Blackframe does not have a dedicated storefront-roles table in the current
// schema. Role is inferred from customer.tags as a best-effort heuristic.
// Returns "customer" as the safe default when no elevated tag is found.
// This should be replaced with a proper role column/table when one exists.
// ─────────────────────────────────────────────────────────────────────────────

function deriveStorefrontRole(
  tags: string[]
): AuthStorefrontRole {
  const normalized = tags.map((t) => t.toLowerCase());
  if (normalized.includes("staff")) return "staff";
  if (normalized.includes("vip")) return "vip";
  return "customer";
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. EXPORTED — getSession
//
// The single source of truth for current identity state in Blackframe.
//
// Returns one normalized AuthSession. Never throws to callers — errors are
// captured and surfaced as identityState: "error" or graceful partial sessions.
// ─────────────────────────────────────────────────────────────────────────────

export async function getSession(
  input?: GetSessionInput
): Promise<AuthSession> {
  const storefrontId = input?.storefrontId;
  const expectedEmail = input?.expectedCustomerEmail;

  // ── Step 1: create server client ──────────────────────────────────────────
  const supabase = await createClient();

  // ── Step 2: read Supabase Auth user ───────────────────────────────────────
  // getUser() validates the token server-side. Preferred over getSession()
  // for server-side usage because it hits the Supabase Auth server — not
  // just the local JWT — ensuring the session has not been revoked.
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError) {
    // Unexpected auth layer failure — cannot determine identity.
    // PGRST errors and "no session" are different: "no session" surfaces as
    // null user with no error, so reaching here means a real failure.
    console.error("[get-session] auth.getUser() error:", authError.message);
    return buildErrorSession();
  }

  if (!authData.user) {
    // No active session — visitor is anonymous.
    return buildAnonymousSession();
  }

  const authUser = authData.user;
  const userRef = normalizeUserReference(authUser);

  // ── Step 3: fetch public profile ──────────────────────────────────────────
  // Best-effort. A missing profile row produces identityState: "partial"
  // but does NOT invalidate the authenticated session.
  const rawProfile = await fetchProfile(supabase, authUser.id);
  const profile = rawProfile ? normalizeProfile(rawProfile) : null;

  // Resolution email: profile email is most reliable when present;
  // fall back to auth.users.email which is always present for email auth.
  const resolutionEmail =
    (expectedEmail ?? rawProfile?.email ?? authUser.email ?? "").toLowerCase();

  // ── Step 4: resolve customer row ──────────────────────────────────────────
  // Best-effort. A missing customer row produces identityState: "partial"
  // and customer: null, but does NOT invalidate the authenticated session.
  let customer: AuthenticatedCustomer | null = null;
  let resolvedStorefrontId: string | null = storefrontId ?? null;
  let storefrontRole: AuthStorefrontRole | null = null;

  if (resolutionEmail) {
    const rawCustomer = await resolveCustomer(supabase, resolutionEmail, storefrontId);

    if (rawCustomer) {
      customer = normalizeAuthenticatedCustomer(
        authUser.id,
        rawProfile?.user_id ?? null,
        rawCustomer,
        "linked"
      );

      // Use the customer row's storefront_id as the resolved context —
      // more reliable than the input hint if they differ.
      resolvedStorefrontId = rawCustomer.storefront_id;
      storefrontRole = deriveStorefrontRole(customer.tags);
    }
  }

  // ── Step 5: determine identity state ─────────────────────────────────────
  // resolved  → auth user + profile + customer all present
  // partial   → auth user confirmed but profile or customer is missing
  const identityState =
    profile !== null && customer !== null ? "resolved" : "partial";

  // ── Step 6: return normalized AuthSession ─────────────────────────────────
  return {
    status: "authenticated",
    identityState,
    isAuthenticated: true,
    isAnonymous: false,
    isReady: true,
    user: userRef,
    profile,
    customer,
    storefrontId: resolvedStorefrontId,
    storefrontRole,
    mode: "standalone",
    sessionCreatedAt: authUser.created_at,
    lastSeenAt: authUser.last_sign_in_at ?? null,
  };
}
