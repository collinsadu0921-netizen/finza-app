import { redirect } from "next/navigation"
import BalanceSheetScreen from "@/components/accounting/screens/BalanceSheetScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function BalanceSheetReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  if (businessId) {
    redirect(`/service/reports/balance-sheet?business_id=${encodeURIComponent(businessId)}`)
  }
  return <BalanceSheetScreen mode="accounting" businessId={null} />
}
