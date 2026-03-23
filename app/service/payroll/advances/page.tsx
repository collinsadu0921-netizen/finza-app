"use client"

import TierGate from "@/components/service/TierGate"
import AdvancesPage from "@/app/payroll/advances/page"

export default function ServicePayrollAdvancesPage() {
  return (
    <TierGate minTier="professional">
      <AdvancesPage />
    </TierGate>
  )
}
