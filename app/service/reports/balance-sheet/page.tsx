import BalanceSheetScreen from "@/components/accounting/screens/BalanceSheetScreen"
import PracticeClientBooksFrame from "@/components/practice/PracticeClientBooksFrame"
import { loadPracticeClientBooksPage } from "@/lib/practice/loadPracticeClientBooksPage"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ServiceBalanceSheetPage({ searchParams }: Props) {
  const { context, businessId } = await loadPracticeClientBooksPage(searchParams)
  return (
    <PracticeClientBooksFrame context={context}>
      <BalanceSheetScreen mode="service" businessId={businessId} />
    </PracticeClientBooksFrame>
  )
}
