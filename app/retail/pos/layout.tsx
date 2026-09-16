import type { Metadata } from "next"
import RetailPosPwaRoot from "./RetailPosPwaRoot"

export const metadata: Metadata = {
  title: "Finza Retail",
  applicationName: "Finza Retail",
  manifest: "/retail/pos/retail-pos-manifest.json",
  themeColor: "#0f172a",
  appleWebApp: {
    capable: true,
    title: "Finza Retail",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
}

export default function RetailPosLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RetailPosPwaRoot />
      {children}
    </>
  )
}
