import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import LedgerScreen from "@/components/accounting/screens/LedgerScreen"

type Props = {
  searchParams: Promise<{ business_id?: string; highlight?: string }>
}

export default async function ServiceLedgerPage({ searchParams }: Props) {
  const p = await searchParams
  const businessIdFromUrl = p.business_id?.trim() ?? null
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ctx = user ? await resolveServiceBusinessContext(supabase, user.id) : { error: "NO_CONTEXT" as const }
  const businessId = businessIdFromUrl ?? ("businessId" in ctx ? ctx.businessId : null)
  return <LedgerScreen mode="service" businessId={businessId} />
}
