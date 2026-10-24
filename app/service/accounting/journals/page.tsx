import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import { resolveServiceManualJournalAuthority } from "@/lib/service/accounting/manualJournalAuth"
import TierGate from "@/components/service/TierGate"
import ServiceManualJournalsScreen from "@/components/service/accounting/ServiceManualJournalsScreen"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

export default async function ServiceManualJournalsPage({ searchParams }: Props) {
  const p = await searchParams
  const businessIdFromUrl = p.business_id?.trim() || null
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ctx = user ? await resolveServiceBusinessContext(supabase, user.id) : { error: "NO_CONTEXT" as const }
  const businessId = businessIdFromUrl ?? ("businessId" in ctx ? ctx.businessId : null)

  if (!businessId) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Manual journals</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Select or complete a Service business before creating manual journals.
        </p>
      </div>
    )
  }

  const authority = user
    ? await resolveServiceManualJournalAuthority({
        supabase,
        userId: user.id,
        businessId,
        required: "read",
      })
    : null

  if (!authority?.ok) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Manual journals</h1>
        <p className="text-gray-600 dark:text-gray-400">
          You do not have permission to view manual journals for this Service business.
        </p>
      </div>
    )
  }

  return (
    <TierGate minTier="business">
      <ServiceManualJournalsScreen businessId={businessId} />
    </TierGate>
  )
}
