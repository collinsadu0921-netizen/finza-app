"use client"

import TierGate from "@/components/service/TierGate"
import AssetsPage from "@/app/assets/page"

export default function ServiceAssetsPage() {
  return (
    <TierGate minTier="professional">
      <AssetsPage />
    </TierGate>
  )
}
