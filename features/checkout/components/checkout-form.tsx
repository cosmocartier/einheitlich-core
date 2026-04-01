import * as React from "react";
import type {
  CheckoutAddress,
  CheckoutCustomer,
  CheckoutPaymentMethod,
  CheckoutSession,
  CheckoutShippingMethod,
} from "@/features/checkout/types/checkout.types";
import { formatCurrency, PROVIDER_LABELS } from "./checkout-template.utils";

interface CheckoutFormProps {
  session: CheckoutSession;
  customer: CheckoutCustomer | null;
  shippingMethods: CheckoutShippingMethod[];
  paymentMethods: CheckoutPaymentMethod[];
  notes: string | null;
}

interface FormSectionProps {
  title: string;
  children: React.ReactNode;
}

interface FormFieldProps {
  label: string;
  value: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}

interface AddressFieldsProps {
  prefix: string;
  address: CheckoutAddress | null;
  autoCompleteGroup: "shipping" | "billing";
}

interface ShippingMethodOptionProps {
  method: CheckoutShippingMethod;
}

interface PaymentMethodOptionProps {
  method: CheckoutPaymentMethod;
}

function FormSection({ title, children }: FormSectionProps) {
  return (
    <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold uppercase tracking-widest text-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function FormField({
  label,
  value,
  name,
  type = "text",
  autoComplete,
  required = false,
}: FormFieldProps) {
  const id = `field-${name}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
        {required ? (
          <span className="ml-1 text-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <input
        id={id}
        type={type}
        name={name}
        defaultValue={value}
        autoComplete={autoComplete}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
      />
    </div>
  );
}

function AddressFields({
  prefix,
  address,
  autoCompleteGroup,
}: AddressFieldsProps) {
  const group = autoCompleteGroup;

  return (
    <div className="flex flex-col gap-4">
      <FormField
        label="Address line 1"
        value={address?.addressLine1 ?? ""}
        name={`${prefix}AddressLine1`}
        autoComplete={`${group} address-line1`}
      />
      <FormField
        label="Address line 2"
        value={address?.addressLine2 ?? ""}
        name={`${prefix}AddressLine2`}
        autoComplete={`${group} address-line2`}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="City"
          value={address?.city ?? ""}
          name={`${prefix}City`}
          autoComplete={`${group} address-level2`}
        />
        <FormField
          label="State / Province"
          value={address?.stateProvince ?? address?.region ?? ""}
          name={`${prefix}StateProvince`}
          autoComplete={`${group} address-level1`}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Postal code"
          value={address?.postalCode ?? ""}
          name={`${prefix}PostalCode`}
          autoComplete={`${group} postal-code`}
        />
        <FormField
          label="Country"
          value={address?.country ?? ""}
          name={`${prefix}Country`}
          autoComplete={`${group} country-name`}
        />
      </div>
    </div>
  );
}

function ShippingMethodOption({ method }: ShippingMethodOptionProps) {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors",
        method.selected
          ? "border-foreground bg-muted"
          : "border-border bg-background hover:bg-muted/50",
        !method.available ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      <input
        type="radio"
        name="shippingMethodId"
        value={method.id}
        defaultChecked={method.selected}
        disabled={!method.available}
        className="mt-0.5 shrink-0 accent-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">
            {method.label}
          </span>
          <span className="shrink-0 text-sm font-semibold text-foreground">
            {formatCurrency(method.price, method.currency)}
          </span>
        </div>
        {method.estimatedDelivery ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {method.estimatedDelivery}
          </p>
        ) : null}
        {method.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {method.description}
          </p>
        ) : null}
        {!method.available ? (
          <p className="mt-0.5 text-xs text-destructive">
            Unavailable for this order
          </p>
        ) : null}
      </div>
    </label>
  );
}

function PaymentMethodOption({ method }: PaymentMethodOptionProps) {
  const label = PROVIDER_LABELS[method.provider] ?? method.label;

  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors",
        method.selected
          ? "border-foreground bg-muted"
          : "border-border bg-background hover:bg-muted/50",
        !method.available ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      <input
        type="radio"
        name="paymentMethodId"
        value={method.id}
        defaultChecked={method.selected}
        disabled={!method.available}
        className="mt-0.5 shrink-0 accent-foreground"
      />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {method.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {method.description}
          </p>
        ) : null}
        {method.intentStatus && method.intentStatus !== "created" ? (
          <p className="mt-0.5 text-xs capitalize text-muted-foreground">
            Status: {method.intentStatus}
          </p>
        ) : null}
        {!method.available ? (
          <p className="mt-0.5 text-xs text-destructive">
            Unavailable for this order
          </p>
        ) : null}
      </div>
    </label>
  );
}

export function CheckoutForm({
  customer,
  shippingMethods,
  paymentMethods,
  notes,
}: CheckoutFormProps) {
  return (
    <div className="flex flex-col gap-8">
      <FormSection title="Customer information">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="First name"
            value={customer?.firstName ?? ""}
            name="firstName"
            autoComplete="given-name"
          />
          <FormField
            label="Last name"
            value={customer?.lastName ?? ""}
            name="lastName"
            autoComplete="family-name"
          />
        </div>
        <FormField
          label="Email"
          value={customer?.email ?? ""}
          name="email"
          type="email"
          autoComplete="email"
        />
        <FormField
          label="Phone"
          value={customer?.phone ?? ""}
          name="phone"
          type="tel"
          autoComplete="tel"
        />
      </FormSection>

      <FormSection title="Shipping address">
        <AddressFields
          prefix="shipping"
          address={customer?.shippingAddress ?? null}
          autoCompleteGroup="shipping"
        />
      </FormSection>

      <FormSection title="Billing address">
        <div className="mb-4 flex items-center gap-3">
          <input
            type="checkbox"
            id="billingSameAsShipping"
            name="billingSameAsShipping"
            defaultChecked={customer?.billingSameAsShipping ?? true}
            className="h-4 w-4 accent-foreground"
          />
          <label
            htmlFor="billingSameAsShipping"
            className="cursor-pointer select-none text-sm text-foreground"
          >
            Same as shipping address
          </label>
        </div>

        {customer && !customer.billingSameAsShipping ? (
          <AddressFields
            prefix="billing"
            address={customer.billingAddress ?? null}
            autoCompleteGroup="billing"
          />
        ) : null}
      </FormSection>

      <FormSection title="Shipping method">
        {shippingMethods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shipping methods available for this session.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {shippingMethods.map((method) => (
              <ShippingMethodOption key={method.id} method={method} />
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="Payment method">
        {paymentMethods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payment methods available for this session.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {paymentMethods.map((method) => (
              <PaymentMethodOption key={method.id} method={method} />
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="Order notes">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="text-sm text-muted-foreground">
            Special instructions (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={notes ?? ""}
            placeholder="Add a note about your order..."
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </div>
      </FormSection>

      <div className="pt-2">
        <button
          type="submit"
          disabled
          aria-disabled="true"
          className="w-full cursor-not-allowed rounded-md bg-foreground px-6 py-3 text-sm font-semibold tracking-wide text-background opacity-50 transition-opacity"
        >
          Place order
        </button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Order submission is handled by the checkout action layer.
        </p>
      </div>
    </div>
  );
}