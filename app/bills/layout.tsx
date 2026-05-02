"use client"

import ProtectedLayout from "@/components/ProtectedLayout"
import TierGate from "@/components/service/TierGate"

/**
 * Applies auth shell for /bills/* only. /service/bills uses app/service/layout.tsx
 * so we must not wrap BillsPage in ProtectedLayout again (avoids double lg:pl-64).
 * Professional plan gate matches sidebar — blocks legacy /bills/* URL bypass.
 */
export default function BillsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedLayout>
      <TierGate minTier="professional">{children}</TierGate>
    </ProtectedLayout>
  )
}
