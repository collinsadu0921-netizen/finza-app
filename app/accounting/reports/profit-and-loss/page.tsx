import ProfitAndLossScreen from "@/components/accounting/screens/ProfitAndLossScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ProfitAndLossReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <ProfitAndLossScreen mode="accounting" businessId={businessId} />
}
