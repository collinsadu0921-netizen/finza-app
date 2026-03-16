import LedgerScreen from "@/components/accounting/screens/LedgerScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function AccountingLedgerPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <LedgerScreen mode="accounting" businessId={businessId} />
}
