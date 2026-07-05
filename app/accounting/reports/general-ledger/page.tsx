import ProtectedLayout from "@/components/ProtectedLayout"
import GeneralLedgerScreen from "@/components/accounting/screens/GeneralLedgerScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function GeneralLedgerReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return (
    <ProtectedLayout>
      <GeneralLedgerScreen mode="accounting" businessId={businessId} />
    </ProtectedLayout>
  )
}
