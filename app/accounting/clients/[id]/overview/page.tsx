"use client"

import { useParams } from "next/navigation"
import ClientCommandCenter from "@/components/accounting/ClientCommandCenter"

export default function ClientOverviewPage() {
  const params = useParams()
  const businessId = params.id as string
  return <ClientCommandCenter businessId={businessId} />
}
