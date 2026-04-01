import * as React from "react";

interface CheckoutLayoutProps {
  form: React.ReactNode;
  summary: React.ReactNode;
}

export function CheckoutLayout({ form, summary }: CheckoutLayoutProps) {
  return (
    <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
      <div className="min-w-0 flex-1">{form}</div>

      <aside className="w-full lg:w-96 lg:shrink-0">
        <div className="sticky top-8">{summary}</div>
      </aside>
    </div>
  );
}