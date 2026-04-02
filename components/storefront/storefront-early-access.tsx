"use client"

import { useState, type FormEvent } from "react"
import type { SubscribeResult } from "@/actions/newsletter/subscribe-action"

export interface StorefrontEarlyAccessProps {
  storefrontName: string
  theme?: "minimal"
  /** Server action bound with the storefront's ID — receives only the email. */
  onSubscribe: (email: string) => Promise<SubscribeResult>
}

export function StorefrontEarlyAccess({
  storefrontName,
  onSubscribe,
}: StorefrontEarlyAccessProps) {
  const [email, setEmail] = useState("")
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
    const result = await onSubscribe(email)
    setLoading(false)

    if (!result.success) {
      setError(result.error)
      return
    }

    setSubmitted(true)
  }

  return (
    <main className="min-h-screen w-full bg-[var(--color-background)]">

      {/* ── Viewport grid ── */}
      <div className="min-h-screen flex flex-col justify-between p-8 md:p-12 lg:p-16">

        {/* TOP ROW — brand centred */}
        <header className="flex items-start justify-center">
          <span
            className="font-sans text-[10px] tracking-[0.3em] uppercase text-[var(--color-foreground)] opacity-90"
            aria-label={`Storefront: ${storefrontName}`}
          >
            {storefrontName}
          </span>
        </header>

        {/* MIDDLE — form centred both axes */}
        <div className="flex-1 flex items-center justify-center">
          {submitted ? (
            <SuccessState />
          ) : (
            <AccessForm
              email={email}
              error={error}
              loading={loading}
              onEmailChange={setEmail}
              onSubmit={handleSubmit}
            />
          )}
        </div>

        {/* BOTTOM ROW — descriptor */}
        <footer className="flex justify-center">
          <p className="font-sans text-[10px] tracking-[0.25em] uppercase text-[var(--color-muted)]">
            Invitations issued privately
          </p>
        </footer>
      </div>
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
  error: string
  loading: boolean
  onEmailChange: (v: string) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
}

function AccessForm({ email, error, loading, onEmailChange, onSubmit }: AccessFormProps) {
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
        Register Interest
      </label>

      <div className="flex flex-col gap-2">
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
