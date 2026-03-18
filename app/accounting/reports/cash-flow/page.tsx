import CashFlowScreen from "@/components/accounting/screens/CashFlowScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function CashFlowReportPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <CashFlowScreen mode="accounting" businessId={businessId} />
}
