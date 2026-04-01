import type { Metadata } from "next"
import { StorefrontEarlyAccess } from "@/components/storefront/storefront-early-access"

export const metadata: Metadata = {
  title: "EINHEITLICH — Private Access",
  description:
    "Access reserved for early collectors. Launching soon.",
}

export default function EinheitlichPage() {
  return <StorefrontEarlyAccess storefrontName="EINHEITLICH" theme="minimal" />
}
