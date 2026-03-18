import EquityChangesScreen from "@/components/accounting/screens/EquityChangesScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function EquityChangesReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <EquityChangesScreen mode="accounting" businessId={businessId} />
}
