"use client"

import { useParams } from "next/navigation"
import PeriodsScreen from "@/components/accounting/screens/PeriodsScreen"

export default function ClientPeriodsPage() {
  const params = useParams()
  const businessId = params.id as string
  return <PeriodsScreen mode="accounting" businessId={businessId} />
}
