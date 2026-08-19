import { redirect } from "next/navigation"
import LedgerScreen from "@/components/accounting/screens/LedgerScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function AccountingLedgerPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  if (businessId) {
    redirect(`/service/ledger?business_id=${encodeURIComponent(businessId)}`)
  }
  return <LedgerScreen mode="accounting" businessId={null} />
}
