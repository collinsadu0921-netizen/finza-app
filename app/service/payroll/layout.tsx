"use client"

import TierGate from "@/components/service/TierGate"
import { PayrollBasePathProvider } from "@/lib/payrollBasePathContext"

export default function ServicePayrollLayout({ children }: { children: React.ReactNode }) {
  return (
    <TierGate minTier="professional">
      <PayrollBasePathProvider basePath="/service/payroll">{children}</PayrollBasePathProvider>
    </TierGate>
  )
}
