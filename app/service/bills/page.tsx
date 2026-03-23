"use client"

import TierGate from "@/components/service/TierGate"
import BillsPage from "@/app/bills/page"

export default function ServiceBillsPage() {
  return (
    <TierGate minTier="professional">
      <BillsPage />
    </TierGate>
  )
}
