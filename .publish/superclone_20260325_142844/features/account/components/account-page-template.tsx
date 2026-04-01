// ─────────────────────────────────────────────────────────────────────────────
// features/account/components/account-page-template.tsx
//
// Presentation-layer template for the storefront account page.
// Receives normalized data — does NOT fetch, normalize, or guard.
//
// Architecture purpose:
//   This template proves the relationship between authenticated storefront
//   identity, linked customer data, order history, and wishlist in a single
//   testable surface. It is intentionally transparent about the identity
//   separation between auth.users, profiles, and customers.
//
// Sub-components (inline — colocated until extracted to dedicated files):
//   AccountSidebar, AccountOverview, OrderHistorySection,
//   WishlistSection, AddressSection, EmptyState
// ─────────────────────────────────────────────────────────────────────────────

import type { AuthSession, AuthenticatedCustomer } from "@/features/auth/types/auth.types";
import type { OrderSummary } from "@/features/orders/types/order.types";
import type { WishlistItem } from "@/features/wishlist/types/wishlist.types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Props
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountOverviewData {
  customerId: string | null;
  authUserId: string;
  storefrontId: string | null;
  /** Profile-level identity (from auth.users / public.profiles). */
  profileFullName: string | null;
  profileEmail: string;
  /** Customer-level identity (from public.customers). */
  customerFirstName: string | null;
  customerLastName: string | null;
  customerFullName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCountry: string | null;
  customerTags: string[];
  /** ISO 8601 account creation date. */
  memberSince: string | null;
}

export interface AccountPageTemplateProps {
  session: AuthSession;
  overview: AccountOverviewData;
  orders: OrderSummary[];
  wishlist: WishlistItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatMemberSince(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  refunded: "Refunded",
  canceled: "Canceled",
};

const TIMELINE_STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  confirmed: "bg-blue-100 text-blue-800",
  processing: "bg-blue-100 text-blue-800",
  ready_to_ship: "bg-indigo-100 text-indigo-800",
  shipped: "bg-indigo-100 text-indigo-800",
  out_for_delivery: "bg-violet-100 text-violet-800",
  delivered: "bg-emerald-100 text-emerald-800",
  returned: "bg-orange-100 text-orange-800",
  refunded: "bg-orange-100 text-orange-800",
  canceled: "bg-zinc-100 text-zinc-500",
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. EmptyState — shared local primitive
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  description: string;
  action?: { label: string; href: string };
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
        <span className="block w-4 h-px bg-zinc-400" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      {action && (
        <a
          href={action.href}
          className="mt-5 inline-block text-xs font-medium text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SectionCard — visual container for each content zone
// ─────────────────────────────────────────────────────────────────────────────

interface SectionCardProps {
  title: string;
  children: React.ReactNode;
  badge?: string;
}

function SectionCard({ title, children, badge }: SectionCardProps) {
  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card">
        <h2 className="text-sm font-semibold text-foreground tracking-wide">{title}</h2>
        {badge !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{badge}</span>
        )}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. AccountSidebar
// ─────────────────────────────────────────────────────────────────────────────

interface AccountSidebarProps {
  customer: AuthenticatedCustomer | null;
  overview: AccountOverviewData;
}

function AccountSidebar({ customer, overview }: AccountSidebarProps) {
  const displayName =
    customer?.fullName ||
    overview.customerFullName ||
    overview.profileFullName ||
    "Account";

  const displayEmail =
    customer?.email ||
    overview.customerEmail ||
    overview.profileEmail;

  const memberSince = formatMemberSince(overview.memberSince);

  return (
    <aside className="flex flex-col gap-6">
      {/* Identity summary */}
      <div className="border border-border rounded-lg p-5 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <span className="text-sm font-semibold text-zinc-600 uppercase select-none">
              {displayName.charAt(0)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{displayEmail}</p>
          </div>
        </div>

        <dl className="space-y-2 text-xs">
          {customer?.phone && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="text-foreground font-medium">{customer.phone}</dd>
            </div>
          )}
          {customer?.country && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Country</dt>
              <dd className="text-foreground font-medium">{customer.country}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Member since</dt>
            <dd className="text-foreground font-medium">{memberSince}</dd>
          </div>
          {overview.storefrontId && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Storefront</dt>
              <dd className="text-foreground font-medium font-mono text-[10px] truncate max-w-[120px]">
                {overview.storefrontId}
              </dd>
            </div>
          )}
        </dl>

        {/* Customer tags */}
        {customer?.tags && customer.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {customer.tags.map((tag) => (
              <span
                key={tag}
                className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 uppercase tracking-wider"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Identity layer visibility — helps test auth/profile/customer separation */}
      <div className="border border-border rounded-lg p-5 bg-card">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Identity layers
        </p>
        <dl className="space-y-2 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Auth user</dt>
            <dd className="font-mono text-[10px] text-foreground truncate max-w-[140px]">
              {overview.authUserId}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Customer row</dt>
            <dd className={`font-mono text-[10px] truncate max-w-[140px] ${overview.customerId ? "text-foreground" : "text-muted-foreground italic"}`}>
              {overview.customerId ?? "not linked"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Link state</dt>
            <dd className={`text-[10px] font-medium ${customer?.customerLinkState === "linked" ? "text-emerald-600" : "text-amber-600"}`}>
              {customer?.customerLinkState ?? "unknown"}
            </dd>
          </div>
        </dl>
      </div>

      {/* Sign out */}
      <form action="/auth/sign-out" method="POST">
        <button
          type="submit"
          className="w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-2 px-4 border border-border rounded-md bg-card hover:bg-zinc-50"
        >
          Sign out
        </button>
      </form>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. AccountOverviewSection
// ─────────────────────────────────────────────────────────────────────────────

interface AccountOverviewSectionProps {
  overview: AccountOverviewData;
  customer: AuthenticatedCustomer | null;
}

function AccountOverviewSection({ overview, customer }: AccountOverviewSectionProps) {
  return (
    <SectionCard title="Overview">
      <div className="p-5">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground mb-0.5">Full name</dt>
            <dd className="font-medium text-foreground">
              {customer?.fullName || overview.customerFullName || overview.profileFullName || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground mb-0.5">Email</dt>
            <dd className="font-medium text-foreground">
              {customer?.email || overview.customerEmail || overview.profileEmail}
            </dd>
          </div>
          {(customer?.phone || overview.customerPhone) && (
            <div>
              <dt className="text-xs text-muted-foreground mb-0.5">Phone</dt>
              <dd className="font-medium text-foreground">
                {customer?.phone ?? overview.customerPhone}
              </dd>
            </div>
          )}
          {(customer?.country || overview.customerCountry) && (
            <div>
              <dt className="text-xs text-muted-foreground mb-0.5">Country</dt>
              <dd className="font-medium text-foreground">
                {customer?.country ?? overview.customerCountry}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. OrderHistorySection
// ─────────────────────────────────────────────────────────────────────────────

interface OrderHistorySectionProps {
  orders: OrderSummary[];
}

function OrderCard({ order }: { order: OrderSummary }) {
  const statusLabel =
    ORDER_STATUS_LABELS[order.timelineStatus] ??
    ORDER_STATUS_LABELS[order.orderStatus] ??
    order.orderStatus;

  const statusColor =
    TIMELINE_STATUS_COLORS[order.timelineStatus] ?? "bg-zinc-100 text-zinc-500";

  return (
    <article className="p-5 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Order {order.orderNumber}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDate(order.createdAt)}
          </p>
        </div>
        <span
          className={`inline-block text-[10px] font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0 ${statusColor}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Line items */}
      <ul className="space-y-2 mb-4" aria-label="Order items">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.productName}
                className="w-10 h-10 rounded object-cover border border-border shrink-0"
              />
            ) : (
              <div
                className="w-10 h-10 rounded border border-border bg-zinc-50 shrink-0"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">
                {item.productName}
              </p>
              {item.variantLabel && (
                <p className="text-[10px] text-muted-foreground">{item.variantLabel}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-medium text-foreground tabular-nums">
                {formatCurrency(item.lineSubtotal, order.currency)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Qty {item.quantity}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* Order totals */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {order.shipment?.trackingNumber && (
            <span>
              Tracking: <span className="font-mono text-foreground">{order.shipment.trackingNumber}</span>
            </span>
          )}
          {order.paymentStatus.provider && (
            <span className="capitalize">{order.paymentStatus.provider}</span>
          )}
        </div>
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {formatCurrency(order.total, order.currency)}
        </p>
      </div>
    </article>
  );
}

function OrderHistorySection({ orders }: OrderHistorySectionProps) {
  return (
    <SectionCard
      title="Order History"
      badge={orders.length > 0 ? String(orders.length) : undefined}
    >
      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="Your order history will appear here once you have placed your first order."
          action={{ label: "Start shopping", href: "/" }}
        />
      ) : (
        <div>
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. WishlistSection
// ─────────────────────────────────────────────────────────────────────────────

interface WishlistSectionProps {
  items: WishlistItem[];
}

function WishlistSection({ items }: WishlistSectionProps) {
  return (
    <SectionCard
      title="Saved Items"
      badge={items.length > 0 ? String(items.length) : undefined}
    >
      {items.length === 0 ? (
        <EmptyState
          title="No saved items"
          description="Products you save will appear here for quick access."
          action={{ label: "Browse products", href: "/" }}
        />
      ) : (
        <ul className="divide-y divide-border" aria-label="Wishlist items">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 p-5">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.productName}
                  className="w-12 h-12 rounded object-cover border border-border shrink-0"
                />
              ) : (
                <div
                  className="w-12 h-12 rounded border border-border bg-zinc-50 shrink-0"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {item.productName}
                </p>
                {item.variantLabel && (
                  <p className="text-xs text-muted-foreground">{item.variantLabel}</p>
                )}
                {item.price !== undefined && item.currency && (
                  <p className="text-xs font-semibold text-foreground mt-1 tabular-nums">
                    {formatCurrency(item.price, item.currency)}
                  </p>
                )}
              </div>
              {item.productSlug && (
                <a
                  href={`/products/${item.productSlug}`}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label={`View ${item.productName}`}
                >
                  View
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. AddressSection
// ─────────────────────────────────────────────────────────────────────────────

interface AddressSectionProps {
  customer: AuthenticatedCustomer | null;
}

function AddressSection({ customer }: AddressSectionProps) {
  const address = customer?.address;

  return (
    <SectionCard title="Address">
      {!address ? (
        <div className="p-5">
          <p className="text-sm text-muted-foreground">No address on file.</p>
        </div>
      ) : (
        <div className="p-5">
          <address className="not-italic text-sm text-foreground leading-relaxed space-y-0.5">
            {customer?.fullName && (
              <p className="font-medium">{customer.fullName}</p>
            )}
            <p>{address.addressLine1}</p>
            {address.addressLine2 && <p>{address.addressLine2}</p>}
            <p>
              {[address.city, address.stateProvince, address.postalCode]
                .filter(Boolean)
                .join(", ")}
            </p>
            {address.country && (
              <p className="text-muted-foreground">{address.country}</p>
            )}
          </address>
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. AccountPageTemplate — main export
// ─────────────────────────────────────────────────────────────────────────────

export function AccountPageTemplate({
  session,
  overview,
  orders,
  wishlist,
}: AccountPageTemplateProps) {
  const customer = session.customer ?? null;

  const displayName =
    customer?.fullName ||
    overview.customerFullName ||
    overview.profileFullName ||
    "My Account";

  return (
    <main className="min-h-screen bg-background font-sans">
      {/* Page header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-semibold text-foreground text-balance">
            My Account
          </h1>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            {displayName !== "My Account"
              ? `Welcome back, ${displayName}.`
              : "Manage your orders, saved items, and account details."}
          </p>
        </div>
      </header>

      {/* Main layout */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Sidebar */}
          <div className="w-full lg:w-64 shrink-0">
            <AccountSidebar customer={customer} overview={overview} />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <AccountOverviewSection overview={overview} customer={customer} />
            <OrderHistorySection orders={orders} />
            <WishlistSection items={wishlist} />
            <AddressSection customer={customer} />
          </div>

        </div>
      </div>
    </main>
  );
}
