import type { Metadata } from "next"
import { StorefrontEarlyAccess } from "@/components/storefront/storefront-early-access"
import { subscribeToNewsletter } from "@/actions/newsletter/subscribe-action"

/** Unique Supabase storefront ID for einheitlich */
const STOREFRONT_ID = "88af01b7-1719-4420-bfba-ed2075ba0686"

/** Unique Supabase operator/distributor ID for einheitlich */
const OPERATOR_DISTRIBUTOR_ID = "41f0e221-3f4f-42c9-ac44-932467f43a4c"

export const metadata: Metadata = {
  title: "EINHEITLICH — Private Access",
  description: "Access reserved for early collectors. Launching soon.",
}

export default function EinheitlichPage() {
  async function subscribe(email: string) {
    "use server"
    return subscribeToNewsletter(email, STOREFRONT_ID, "early_access", OPERATOR_DISTRIBUTOR_ID)
  }

  return (
    <StorefrontEarlyAccess
      storefrontName="EINHEITLICH"
      theme="minimal"
      onSubscribe={subscribe}
    />
  )
}
