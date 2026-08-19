import ProfitAndLossScreen from "@/components/accounting/screens/ProfitAndLossScreen"
import PracticeClientBooksFrame from "@/components/practice/PracticeClientBooksFrame"
import { loadPracticeClientBooksPage } from "@/lib/practice/loadPracticeClientBooksPage"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ServiceProfitAndLossPage({ searchParams }: Props) {
  const { context, businessId } = await loadPracticeClientBooksPage(searchParams)
  return (
    <PracticeClientBooksFrame context={context}>
      <ProfitAndLossScreen mode="service" businessId={businessId} />
    </PracticeClientBooksFrame>
  )
}
