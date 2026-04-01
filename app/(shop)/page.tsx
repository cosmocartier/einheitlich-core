import type { Metadata } from "next"
import { StorefrontEarlyAccess } from "@/components/storefront/storefront-early-access"
import { subscribeToNewsletter } from "@/actions/newsletter/subscribe-action"

/** Unique Supabase storefront ID for einheitlich */
const STOREFRONT_ID = "88af01b7-1719-4420-bfba-ed2075ba0686"

export const metadata: Metadata = {
  title: "EINHEITLICH — Private Access",
  description: "Access reserved for early collectors. Launching soon.",
}

export default function EinheitlichPage() {
  async function subscribe(email: string) {
    "use server"
    return subscribeToNewsletter(email, STOREFRONT_ID, "early_access")
  }

  return (
    <StorefrontEarlyAccess
      storefrontName="EINHEITLICH"
      theme="minimal"
      onSubscribe={subscribe}
    />
  )
}
