import { redirect } from "next/navigation"
import LegacyTrialBalanceClient from "./LegacyTrialBalanceClient"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function AccountingTrialBalancePage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  if (businessId) {
    redirect(`/service/reports/trial-balance?business_id=${encodeURIComponent(businessId)}`)
  }
  return <LegacyTrialBalanceClient />
}
