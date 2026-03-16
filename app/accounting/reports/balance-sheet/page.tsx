import BalanceSheetScreen from "@/components/accounting/screens/BalanceSheetScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function BalanceSheetReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <BalanceSheetScreen mode="accounting" businessId={businessId} />
}
