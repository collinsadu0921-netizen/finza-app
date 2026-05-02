"use client"

import TierGate from "@/components/service/TierGate"
import ProtectedLayout from "@/components/ProtectedLayout"

/**
 * Legacy `/payroll/*` shell — mirrors `/service/payroll` plan gate so Essentials
 * cannot use bookmarked URLs to bypass subscription.
 */
export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedLayout>
      <TierGate minTier="professional">{children}</TierGate>
    </ProtectedLayout>
  )
}
