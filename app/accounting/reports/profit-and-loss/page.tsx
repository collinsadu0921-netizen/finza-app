import { redirect } from "next/navigation"
import ProfitAndLossScreen from "@/components/accounting/screens/ProfitAndLossScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ProfitAndLossReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  if (businessId) {
    redirect(`/service/reports/profit-and-loss?business_id=${encodeURIComponent(businessId)}`)
  }
  return <ProfitAndLossScreen mode="accounting" businessId={null} />
}
