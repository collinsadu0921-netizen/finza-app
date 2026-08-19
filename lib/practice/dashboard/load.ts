/**
 * Practice dashboard read model.
 * Resolves active firm + authorized scope once, reuses the Work index,
 * then derives portfolio summaries in memory. No per-client / per-staff waterfall.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { isPracticeFirmRole, type PracticeFirmRole } from "@/lib/practice/assignment/policy"
import {
  loadPracticeWorkIndex,
  staffDisplayName,
  type PracticeWorkIndexErr,
} from "@/lib/practice/work/loadIndex"
import { derivePracticeDashboard } from "./derive"
import type { PracticeDashboard, PracticeDashboardStaffMember } from "./types"

export type PracticeDashboardLoadResult =
  | { ok: true; dashboard: PracticeDashboard }
  | PracticeWorkIndexErr

export async function loadPracticeDashboard(opts: {
  supabase: SupabaseClient
  userId: string
  requestedFirmId?: string | null
  now?: Date
}): Promise<PracticeDashboardLoadResult> {
  const index = await loadPracticeWorkIndex(opts)
  if (!index.ok) return index

  const [staffRes, assignRes, firmRes] = await Promise.all([
    opts.supabase
      .from("accounting_firm_users")
      .select("user_id, role")
      .eq("firm_id", index.firmId),
    opts.supabase
      .from("accounting_firm_client_assignments")
      .select("user_id, client_business_id")
      .eq("firm_id", index.firmId)
      .is("unassigned_at", null),
    opts.supabase.from("accounting_firms").select("name").eq("id", index.firmId).maybeSingle(),
  ])

  if (staffRes.error) {
    return { ok: false, status: 500, error: staffRes.error.message }
  }
  if (assignRes.error) {
    return { ok: false, status: 500, error: assignRes.error.message }
  }
  if (firmRes.error) {
    return { ok: false, status: 500, error: firmRes.error.message }
  }

  const firmStaffIds = (staffRes.data ?? []).map((row) => row.user_id as string)
  const usersRes = firmStaffIds.length
    ? await opts.supabase.from("users").select("id, email, full_name").in("id", firmStaffIds)
    : { data: [], error: null }
  if (usersRes.error) {
    return { ok: false, status: 500, error: usersRes.error.message }
  }
  const names = new Map(
    (usersRes.data ?? []).map((row) => [row.id as string, staffDisplayName(row as { id: string; email?: string | null; full_name?: string | null })])
  )
  for (const row of index.staff) {
    if (!names.has(row.user_id)) names.set(row.user_id, row.name)
  }

  const staff: PracticeDashboardStaffMember[] = (staffRes.data ?? [])
    .map((row) => {
      const role: PracticeFirmRole = isPracticeFirmRole(row.role) ? row.role : "readonly"
      return {
        user_id: row.user_id as string,
        name: names.get(row.user_id as string) ?? "Firm user",
        role,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const assignments = (assignRes.data ?? []).map((row) => ({
    user_id: row.user_id as string,
    client_business_id: row.client_business_id as string,
  }))

  return {
    ok: true,
    dashboard: {
      ...derivePracticeDashboard({
        firmId: index.firmId,
        role: index.scope.role,
        currentUserId: opts.userId,
        enforcementActive: index.scope.enforcementActive,
        authorizedBusinessIds: index.scope.authorizedBusinessIds,
        effectiveBusinessIds: index.scope.effectiveBusinessIds,
        clients: index.clients.filter((c) => index.scope.authorizedBusinessIds.includes(c.id)),
        staff,
        assignments,
        items: index.items,
      }),
      firm_name: (firmRes.data?.name as string | undefined)?.trim() || null,
    },
  }
}
