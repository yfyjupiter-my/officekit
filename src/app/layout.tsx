import type { Metadata } from "next"
import { Cormorant_Garamond, DM_Sans, Geist_Mono } from "next/font/google"
import { AppProviders } from "@/components/app-providers"
import "./globals.css"

const titleFont = Cormorant_Garamond({
  weight: ["300", "400"],
  subsets: ["latin"],
  variable: "--font-title-font",
})

const bodyFont = DM_Sans({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-body-font",
})

const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono-font",
})

export const metadata: Metadata = {
  title: "Tools",
  description: "Simple tools for everyday work.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${titleFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-muji-bg font-body text-muji-text-primary">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  )
}
