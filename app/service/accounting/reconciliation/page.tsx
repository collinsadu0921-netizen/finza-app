import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import ReconciliationScreen from "@/components/accounting/screens/ReconciliationScreen"
import TierGate from "@/components/service/TierGate"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ServiceReconciliationPage({ searchParams }: Props) {
  const p = await searchParams
  const businessIdFromUrl = p.business_id?.trim() ?? null
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ctx = user ? await resolveServiceBusinessContext(supabase, user.id) : { error: "NO_CONTEXT" as const }
  const businessId = businessIdFromUrl ?? ("businessId" in ctx ? ctx.businessId : null)
  return (
    <TierGate minTier="business">
      <ReconciliationScreen mode="service" businessId={businessId} />
    </TierGate>
  )
}
