import type { Metadata } from "next"
import RetailPosPwaRoot from "./RetailPosPwaRoot"

export const metadata: Metadata = {
  manifest: "/retail/pos/retail-pos-manifest.json",
  themeColor: "#0f172a",
  appleWebApp: {
    capable: true,
    title: "Finza POS",
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
