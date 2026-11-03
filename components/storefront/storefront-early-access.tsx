"use client"

import { useState, type FormEvent } from "react"
import type { SubscribeResult } from "@/actions/newsletter/subscribe-action"

export interface StorefrontEarlyAccessProps {
  storefrontName: string
  theme?: "minimal"
  /** Server action bound with the storefront's IDs — receives email and phone. */
  onSubscribe: (email: string, phone: string) => Promise<SubscribeResult>
}

export function StorefrontEarlyAccess({
  storefrontName,
  onSubscribe,
}: StorefrontEarlyAccessProps) {
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim()) return

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setError("Invalid address.")
      return
    }

    setError("")
    setLoading(true)
    if (!phone.trim()) {
      setError("Enter a phone number.")
      return
    }

    const result = await onSubscribe(email, phone)
    setLoading(false)

    if (!result.success) {
      setError(result.error)
      return
    }

    setSubmitted(true)
  }

  return (
    <main className="relative min-h-screen w-full bg-[var(--color-background)]">

      {/* Brand name — same margin from top as footer has from bottom */}
      <header className="absolute left-0 right-0 top-8 flex justify-center">
        <span
          className="font-sans text-[12px] tracking-[0.3em] uppercase text-[var(--color-foreground)] opacity-90"
          aria-label={`Storefront: ${storefrontName}`}
        >
          {storefrontName}
        </span>
      </header>

      {/* Form — true viewport centre */}
      <div className="min-h-screen flex items-center justify-center px-8">
        {submitted ? (
          <SuccessState />
        ) : (
          <AccessForm
            email={email}
            phone={phone}
            error={error}
            loading={loading}
            onEmailChange={setEmail}
            onPhoneChange={setPhone}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      {/* Footer — pinned to bottom, centred */}
      <footer className="absolute bottom-8 left-0 right-0 flex justify-center">
        <p className="font-sans text-[10px] tracking-[0.25em] uppercase text-[var(--color-muted)]">
          By invitation only
        </p>
      </footer>

    </main>
  )
}

/* ── Sub-components ── */

function SuccessState() {
  return (
    <div className="flex flex-col gap-3 animate-fade-in max-w-xs">
      <p className="font-sans text-[10px] tracking-[0.3em] uppercase text-[var(--color-muted)]">
        Confirmed
      </p>
      <p className="font-sans text-sm leading-relaxed text-[var(--color-foreground)]">
        {"You'll receive a private invitation when access opens."}
      </p>
    </div>
  )
}

interface AccessFormProps {
  email: string
  phone: string
  error: string
  loading: boolean
  onEmailChange: (v: string) => void
  onPhoneChange: (v: string) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
}

function AccessForm({ email, phone, error, loading, onEmailChange, onPhoneChange, onSubmit }: AccessFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 w-full max-w-xs"
      noValidate
    >
      <label
        htmlFor="email"
        className="font-sans text-[10px] tracking-[0.3em] uppercase text-[var(--color-muted)]"
      >
        Private Access
      </label>

      <div className="flex flex-col gap-3">
        <input
          id="phone"
          type="tel"
          name="phone"
          autoComplete="tel"
          inputMode="tel"
          placeholder="phone number"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          disabled={loading}
          aria-describedby={error ? "email-error" : undefined}
          className="w-full border-b border-[var(--color-border)] bg-transparent py-2 font-sans text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none disabled:opacity-40"
        />

        <div className="flex items-center gap-0 border-b border-[var(--color-border)]">
          <input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="email address"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            disabled={loading}
            aria-describedby={error ? "email-error" : undefined}
            aria-invalid={!!error}
            className="
              flex-1 bg-transparent
              font-sans text-xs text-[var(--color-foreground)]
              placeholder:text-[var(--color-muted)]
              py-2 pr-4
              focus:outline-none
              disabled:opacity-40
            "
          />
          <button
            type="submit"
            disabled={loading}
            className="
              font-sans text-[10px] tracking-[0.25em] uppercase
              text-[var(--color-foreground)] whitespace-nowrap
              pb-2 hover:opacity-50 active:opacity-30
              transition-opacity duration-150
              disabled:opacity-30 disabled:cursor-not-allowed
              focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-foreground)]
            "
          >
            {loading ? "—" : "Request →"}
          </button>
        </div>

        {error && (
          <p
            id="email-error"
            role="alert"
            className="font-sans text-[10px] tracking-wide text-[var(--color-muted)]"
          >
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
