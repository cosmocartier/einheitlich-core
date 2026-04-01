import type { OrderTimelineStatus } from "@/features/orders/types/order.types";
import { formatDate, TIMELINE_STATUS_LABELS } from "./order-confirmation.utils";

interface OrderSuccessHeaderProps {
  orderNumber: string;
  createdAt: string;
  timelineStatus: OrderTimelineStatus;
}

export function OrderSuccessHeader({
  orderNumber,
  createdAt,
  timelineStatus,
}: OrderSuccessHeaderProps) {
  const isCanceled =
    timelineStatus === "canceled" || timelineStatus === "refunded";

  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div
        className={[
          "flex h-16 w-16 items-center justify-center rounded-full",
          isCanceled ? "bg-muted" : "bg-foreground",
        ].join(" ")}
        aria-hidden="true"
      >
        {isCanceled ? (
          <svg
            className="h-7 w-7 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg
            className="h-7 w-7 text-background"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {isCanceled
            ? `Order ${TIMELINE_STATUS_LABELS[timelineStatus]}`
            : "Order Confirmed"}
        </h1>
        <p className="text-sm text-muted-foreground text-balance">
          {isCanceled
            ? `This order has been ${TIMELINE_STATUS_LABELS[
              timelineStatus
            ].toLowerCase()}.`
            : "Your order has been successfully placed."}
        </p>
      </div>

      <div className="flex flex-col items-center gap-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Order number
        </p>
        <p className="text-base font-mono font-semibold text-foreground">
          {orderNumber}
        </p>
        {createdAt ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Placed on {formatDate(createdAt)}
          </p>
        ) : null}
      </div>
    </div>
  );
}