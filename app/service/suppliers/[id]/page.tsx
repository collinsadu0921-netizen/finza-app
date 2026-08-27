"use client"

import { useParams } from "next/navigation"
import { Suspense } from "react"
import TierGate from "@/components/service/TierGate"
import SupplierDetailPage from "@/components/suppliers/SupplierDetailPage"

function SupplierDetailRoute() {
  const params = useParams()
  const supplierId = String(params.id || "")
  return <SupplierDetailPage supplierId={supplierId} />
}

export default function ServiceSupplierDetailPage() {
  return (
    <TierGate minTier="professional">
      <Suspense fallback={<p className="p-8 text-sm text-gray-500">Loading supplier…</p>}>
        <SupplierDetailRoute />
      </Suspense>
    </TierGate>
  )
}
