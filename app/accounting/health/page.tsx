import HealthScreen from "@/components/accounting/screens/HealthScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function AccountingHealthPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <HealthScreen mode="accounting" businessId={businessId} />
}
