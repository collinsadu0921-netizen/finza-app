import { redirect } from "next/navigation"
import TrialBalanceScreen from "@/components/accounting/screens/TrialBalanceScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function TrialBalanceReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  if (businessId) {
    redirect(`/service/reports/trial-balance?business_id=${encodeURIComponent(businessId)}`)
  }
  return <TrialBalanceScreen mode="accounting" businessId={null} />
}
