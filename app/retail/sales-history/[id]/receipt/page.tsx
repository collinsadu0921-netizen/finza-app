"use client"

import { Suspense } from "react"
import { RetailSaleReceiptView } from "@/app/retail/_components/RetailSaleReceiptView"

export default function RetailSalesHistoryReceiptPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center p-6 text-muted-foreground">
          Loading receipt…
        </div>
      }
    >
      <RetailSaleReceiptView />
    </Suspense>
  )
}
