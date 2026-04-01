import type { CheckoutState } from "@/features/checkout/types/checkout.types";
import {
  CHECKOUT_STEPS,
  stateToStepIndex,
} from "./checkout-template.utils";

interface CheckoutProgressProps {
  state: CheckoutState;
}

export function CheckoutProgress({ state }: CheckoutProgressProps) {
  const currentIndex = stateToStepIndex(state);

  return (
    <nav aria-label="Checkout progress">
      <ol className="flex items-center gap-0">
        {CHECKOUT_STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isLast = index === CHECKOUT_STEPS.length - 1;

          return (
            <li key={step} className="flex items-center">
              <div className="flex items-center gap-2">
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    isCompleted
                      ? "bg-foreground text-background"
                      : isCurrent
                        ? "bg-foreground text-background ring-2 ring-foreground ring-offset-2"
                        : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {isCompleted ? (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  ) : (
                    String(index + 1)
                  )}
                </span>

                <span
                  className={[
                    "hidden text-sm sm:block",
                    isCompleted || isCurrent
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  ].join(" ")}
                >
                  {step}
                </span>
              </div>

              {!isLast ? (
                <div
                  aria-hidden="true"
                  className={[
                    "mx-2 h-px w-8 shrink-0 transition-colors sm:w-12",
                    isCompleted ? "bg-foreground" : "bg-border",
                  ].join(" ")}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}