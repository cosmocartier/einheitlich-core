import type { ReactNode } from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { Cormorant } from "next/font/google"
import { Julius_Sans_One } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const cormorant = Cormorant({
  subsets: ["latin"],
  variable: "--font-cormorant",
  weight: ["300", "400", "500", "600"],
})

const juliusSansOne = Julius_Sans_One({
  subsets: ["latin"],
  variable: "--font-julius",
  weight: "400",
})

export const metadata: Metadata = {
  title: "Einheitlich — Private Access",
  description: "Early access collector page for Einheitlich. Launching soon.",
}

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable} ${juliusSansOne.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
