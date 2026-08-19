import TrialBalanceScreen from "@/components/accounting/screens/TrialBalanceScreen"
import PracticeClientBooksFrame from "@/components/practice/PracticeClientBooksFrame"
import TierGate from "@/components/service/TierGate"
import { loadPracticeClientBooksPage } from "@/lib/practice/loadPracticeClientBooksPage"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ServiceTrialBalancePage({ searchParams }: Props) {
  const { context, businessId } = await loadPracticeClientBooksPage(searchParams)
  const screen = <TrialBalanceScreen mode="service" businessId={businessId} />

  return (
    <PracticeClientBooksFrame context={context}>
      {context.kind === "practice" ? screen : <TierGate minTier="business">{screen}</TierGate>}
    </PracticeClientBooksFrame>
  )
}
