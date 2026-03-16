import PeriodsScreen from "@/components/accounting/screens/PeriodsScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function AccountingPeriodsPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <PeriodsScreen mode="accounting" businessId={businessId} />
}
