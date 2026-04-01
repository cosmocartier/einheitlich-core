"use client"

import { useState, type FormEvent } from "react"

export interface StorefrontEarlyAccessProps {
  storefrontName: string
  theme?: "minimal"
}

export function StorefrontEarlyAccess({
  storefrontName,
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
      setError("Enter a valid email address.")
      return
    }

    setError("")
    setLoading(true)

    // Simulate async request
    await new Promise((r) => setTimeout(r, 800))

    setLoading(false)
    setSubmitted(true)
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-[var(--color-background)]">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-10">

        {/* Brand label */}
        <p
          className="text-[10px] font-sans tracking-[0.35em] uppercase text-[var(--color-muted)]"
          aria-label={`Storefront: ${storefrontName}`}
        >
          {storefrontName}
        </p>

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
    </main>
  )
}

/* ---------- Sub-components ---------- */

function SuccessState() {
  return (
    <div className="flex flex-col items-center gap-6 animate-fade-in">
      <h1 className="font-serif text-4xl sm:text-5xl font-light text-[var(--color-foreground)] leading-tight tracking-tight text-balance">
        Access requested.
      </h1>
      <p className="font-sans text-sm leading-relaxed text-[var(--color-muted)] tracking-wide">
        {"You'll receive a private invitation."}
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

function AccessForm({
  email,
  error,
  loading,
  onEmailChange,
  onSubmit,
}: AccessFormProps) {
  return (
    <>
      {/* Headline */}
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl font-light text-[var(--color-foreground)] leading-none tracking-tight text-balance">
          PRIVATE
          <br />
          ACCESS
        </h1>
        <p className="font-sans text-xs leading-relaxed text-[var(--color-muted)] tracking-widest uppercase mt-2">
          Launching soon.
        </p>
        <p className="font-sans text-sm leading-relaxed text-[var(--color-muted)] max-w-xs text-balance">
          Access reserved for early collectors.
        </p>
      </div>

      {/* Form */}
      <form
        onSubmit={onSubmit}
        className="w-full flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="Your email address"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            disabled={loading}
            aria-describedby={error ? "email-error" : undefined}
            aria-invalid={!!error}
            className="
              w-full bg-transparent border-b border-[var(--color-border)]
              text-[var(--color-foreground)] font-sans text-sm
              py-3 px-0 placeholder:text-[var(--color-muted)]
              focus:outline-none focus:border-[var(--color-muted)]
              transition-colors duration-200
              disabled:opacity-40
            "
          />
          {error && (
            <p
              id="email-error"
              role="alert"
              className="text-[10px] tracking-wide text-[var(--color-muted)] mt-1"
            >
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="
            w-full bg-[var(--color-foreground)] text-[var(--color-background)]
            font-sans text-xs tracking-[0.25em] uppercase
            py-4 px-6
            transition-opacity duration-200
            hover:opacity-80 active:opacity-60
            disabled:opacity-40 disabled:cursor-not-allowed
            focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-foreground)]
          "
        >
          {loading ? "Requesting..." : "Request Access \u2192"}
        </button>
      </form>

      {/* Micro text */}
      <p className="font-sans text-[10px] tracking-[0.2em] text-[var(--color-muted)] uppercase">
        Limited access — invitations prioritized
      </p>
    </>
  )
}
