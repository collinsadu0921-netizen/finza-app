"use client"

import TierGate from "@/components/service/TierGate"
import PayrollPage from "@/app/payroll/page"

export default function ServicePayrollPage() {
  return (
    <TierGate minTier="professional">
      <PayrollPage />
    </TierGate>
  )
}
