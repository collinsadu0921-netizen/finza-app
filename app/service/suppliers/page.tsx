"use client"

import TierGate from "@/components/service/TierGate"
import SuppliersDirectoryPage from "@/components/suppliers/SuppliersDirectoryPage"

export default function ServiceSuppliersPage() {
  return (
    <TierGate minTier="professional">
      <SuppliersDirectoryPage />
    </TierGate>
  )
}
