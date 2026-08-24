"use client"

import TierGate from "@/components/service/TierGate"
import MaterialsWorkspacePrefetch from "@/components/service/MaterialsWorkspacePrefetch"

export default function ServiceMaterialsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MaterialsWorkspacePrefetch />
      <TierGate minTier="professional">{children}</TierGate>
    </>
  )
}
