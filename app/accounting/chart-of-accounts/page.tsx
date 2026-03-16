import ChartOfAccountsScreen from "@/components/accounting/screens/ChartOfAccountsScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ChartOfAccountsPage({ searchParams }: Props) {
  const p = await searchParams
  const businessId = p.business_id?.trim() ?? null
  return <ChartOfAccountsScreen mode="accounting" businessId={businessId} />
}
