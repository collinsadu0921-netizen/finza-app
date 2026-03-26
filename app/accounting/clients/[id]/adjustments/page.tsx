"use client"

import { useParams } from "next/navigation"
import AdjustmentsContent from "@/components/accounting/AdjustmentsContent"

export default function ClientAdjustmentsPage() {
  const params = useParams()
  const businessId = params.id as string
  return <AdjustmentsContent businessId={businessId} />
}
