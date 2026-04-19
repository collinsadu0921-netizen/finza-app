import { Suspense } from "react"
import RetailInventoryAddStockPage from "@/components/retail/inventory/RetailInventoryAddStockPage"

export default function AddStockPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-600">Loading…</div>}>
      <RetailInventoryAddStockPage />
    </Suspense>
  )
}
