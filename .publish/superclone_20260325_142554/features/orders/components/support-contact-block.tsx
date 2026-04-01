interface SupportContactBlockProps {
  orderNumber: string;
}

export function SupportContactBlock({
  orderNumber,
}: SupportContactBlockProps) {
  return (
    <section
      aria-label="Customer support"
      className="flex max-w-sm flex-col gap-3"
    >
      <h2 className="text-sm font-semibold text-foreground">
        Need help with your order?
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Reference your order number{" "}
        <span className="font-mono font-semibold text-foreground">
          {orderNumber}
        </span>{" "}
        when contacting support.
      </p>
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Email: <span className="text-foreground">support@example.com</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Phone: <span className="text-foreground">—</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Help center:{" "}
          <a
            href="/help"
            className="text-foreground underline underline-offset-2 transition-opacity hover:opacity-70"
          >
            Visit help center
          </a>
        </p>
      </div>
    </section>
  );
}