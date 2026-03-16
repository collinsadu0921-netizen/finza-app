import ReconciliationScreen from "@/components/accounting/screens/ReconciliationScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ReconciliationPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <ReconciliationScreen mode="accounting" businessId={businessId} />
}
