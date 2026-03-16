import AuditScreen from "@/components/accounting/screens/AuditScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function AccountingAuditPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <AuditScreen mode="accounting" businessId={businessId} />
}
