import BankReconciliationScreen from "@/components/accounting/screens/BankReconciliationScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function BankReconciliationPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <BankReconciliationScreen mode="accounting" businessId={businessId} />
}
