"use client"

import ProtectedLayout from "@/components/ProtectedLayout"
import TierGate from "@/components/service/TierGate"

/**
 * Legacy `/assets/*` — matches sidebar Professional tier and `/service/assets` gate.
 */
export default function AssetsSegmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedLayout>
      <TierGate minTier="professional">{children}</TierGate>
    </ProtectedLayout>
  )
}
