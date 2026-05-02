"use client"

import TierGate from "@/components/service/TierGate"

export default function ServiceEquityChangesLayout({ children }: { children: React.ReactNode }) {
  return <TierGate minTier="professional">{children}</TierGate>
}
