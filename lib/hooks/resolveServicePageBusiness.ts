import type { SupabaseClient } from "@supabase/supabase-js"
import { resolvePreferredBusinessForUser, setSelectedBusinessId } from "@/lib/business"
import type { WorkspaceBusiness } from "@/components/WorkspaceBusinessContext"

export type ResolveServicePageBusinessInput = {
  supabase: SupabaseClient
  ctxBusiness: WorkspaceBusiness
  sessionUserId: string | null
  urlBusinessId?: string | null
  getUser: () => Promise<{ data: { user: { id: string } | null } }>
}

export type ResolveServicePageBusinessResult =
  | { ok: true; business: NonNullable<WorkspaceBusiness> }
  | { ok: false; error: string }

/**
 * Client tenant resolution for service list pages.
 * Prefers workspace context; validates URL overrides; legacy fallback when needed.
 */
export async function resolveServicePageBusiness(
  input: ResolveServicePageBusinessInput
): Promise<ResolveServicePageBusinessResult> {
  const trimmedUrl = input.urlBusinessId?.trim() || null
  const { ctxBusiness, sessionUserId, supabase, getUser } = input

  if (!trimmedUrl && ctxBusiness?.id) {
    setSelectedBusinessId(ctxBusiness.id)
    return { ok: true, business: ctxBusiness }
  }

  let userId = sessionUserId
  if (!userId) {
    const { data: { user } } = await getUser()
    userId = user?.id ?? null
  }

  if (!userId) {
    return { ok: false, error: "Not logged in" }
  }

  const scope = await resolvePreferredBusinessForUser(supabase, userId, trimmedUrl)
  if (!scope.ok) {
    return { ok: false, error: scope.error }
  }

  if (ctxBusiness?.id === scope.businessId) {
    setSelectedBusinessId(scope.businessId)
    return { ok: true, business: ctxBusiness }
  }

  const { data: row, error: rowError } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", scope.businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (rowError || !row) {
    return { ok: false, error: "Business not found" }
  }

  const resolved = row as NonNullable<WorkspaceBusiness>
  setSelectedBusinessId(scope.businessId)
  return { ok: true, business: resolved }
}
