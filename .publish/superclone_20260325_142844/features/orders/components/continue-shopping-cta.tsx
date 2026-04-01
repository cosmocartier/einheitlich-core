import Link from "next/link";

export function ContinueShoppingCTA() {
  return (
    <div className="flex items-end">
      <Link
        href="/catalog"
        className="inline-flex items-center justify-center rounded-md bg-foreground px-6 py-3 text-sm font-semibold tracking-wide text-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
      >
        Continue Shopping
      </Link>
    </div>
  );
}