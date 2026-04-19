"use client"

import { Suspense } from "react"
import { RetailPosSurfaceReceiptView } from "@/app/retail/pos/_components/RetailPosSurfaceReceiptView"

export default function RetailPosReceiptPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center p-6 text-muted-foreground">
          Loading receipt…
        </div>
      }
    >
      <RetailPosSurfaceReceiptView />
    </Suspense>
  )
}
