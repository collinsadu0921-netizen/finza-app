import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveWorkFirmId } from "@/lib/practice/work/scope"
import { loadFirmUserClientScope, type FirmUserClientScope } from "./scope"

export type ActivePracticeFirmScope =
  | { ok: true; firmId: string; scope: FirmUserClientScope }
  | { ok: false; status: 403; error: string }

/**
 * One validated firm context for firm-wide Practice lists.
 * requestedFirmId is treated as a hint and must be a membership.
 * If omitted, uses the same deterministic first-membership fallback as Work.
 */
export async function resolveActivePracticeFirmScope(opts: {
  supabase: SupabaseClient
  userId: string
  requestedFirmId?: string | null
  now?: Date
}): Promise<ActivePracticeFirmScope> {
  const { data: memberships } = await opts.supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", opts.userId)

  const resolved = resolveWorkFirmId({
    memberships: memberships ?? [],
    requestedFirmId: opts.requestedFirmId,
  })
  if (!resolved.firmId) {
    return {
      ok: false,
      status: 403,
      error:
        resolved.reason === "firm_not_member"
          ? "Forbidden. Not a member of the requested firm."
          : "Forbidden. Accounting firm membership required.",
    }
  }

  const scope = await loadFirmUserClientScope(opts.supabase, {
    userId: opts.userId,
    firmId: resolved.firmId,
    now: opts.now,
  })
  if (!scope) {
    return { ok: false, status: 403, error: "Forbidden. Accounting firm membership required." }
  }
  return { ok: true, firmId: resolved.firmId, scope }
}
