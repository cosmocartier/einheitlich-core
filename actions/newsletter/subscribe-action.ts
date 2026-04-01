"use server"

import { createClient } from "@/lib/supabase/server"

export type SubscribeResult =
  | { success: true }
  | { success: false; error: string }

/**
 * Inserts an email into newsletter_subscribers for the given storefront.
 * Safe to call from any client component via a passed server action.
 * Duplicate emails for the same storefront are silently ignored (upsert).
 */
export async function subscribeToNewsletter(
  email: string,
  storefrontId: string,
  source = "early_access",
): Promise<SubscribeResult> {
  const trimmed = email.trim().toLowerCase()

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmed)) {
    return { success: false, error: "Invalid email address." }
  }

  const supabase = await createClient()

  const { error } = await supabase.from("newsletter_subscribers").upsert(
    {
      email: trimmed,
      storefront_id: storefrontId,
      source,
      status: "active",
    },
    { onConflict: "email,storefront_id", ignoreDuplicates: true },
  )

  if (error) {
    console.error("[newsletter] subscribe error:", error.message)
    return { success: false, error: "Something went wrong. Please try again." }
  }

  return { success: true }
}
