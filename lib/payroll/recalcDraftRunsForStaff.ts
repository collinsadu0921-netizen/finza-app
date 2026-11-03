import type { SupabaseClient } from "@supabase/supabase-js"
import { recalcPayrollEntryForStaffOnDraftRun } from "./recalcPayrollEntryForStaff"

/**
 * Recalculate the draft payroll runs affected by a staff allowance/deduction
 * change.
 *
 * - A one-off item passes its linked run id, so only that draft is touched.
 * - A recurring item passes no run id; every draft run containing the employee
 *   is recalculated so the recurring change is reflected consistently.
 *
 * Approved, locked and reversed runs are never returned or modified.
 */
export async function recalcDraftRunsForStaffChange(params: {
  supabase: SupabaseClient
  businessId: string
  businessCountry: string
  staffId: string
  runId?: string | null
}): Promise<
  | { ok: true; runIds: string[] }
  | { ok: false; error: string; status: number; runIds: string[] }
> {
  const { supabase, businessId, businessCountry, staffId, runId } = params

  let runIds: string[]
  if (runId) {
    runIds = [String(runId)]
  } else {
    const { data: entries, error: entriesError } = await supabase
      .from("payroll_entries")
      .select("payroll_run_id")
      .eq("staff_id", staffId)
      .not("payroll_run_id", "is", null)

    if (entriesError) {
      return { ok: false, error: entriesError.message, status: 500, runIds: [] }
    }

    const candidateRunIds = Array.from(
      new Set(
        (entries || [])
          .map((entry) => entry.payroll_run_id)
          .filter((value): value is string => Boolean(value))
          .map(String)
      )
    ).sort()

    if (candidateRunIds.length === 0) {
      return { ok: true, runIds: [] }
    }

    const { data: runs, error: runsError } = await supabase
      .from("payroll_runs")
      .select("id")
      .in("id", candidateRunIds)
      .eq("business_id", businessId)
      .eq("status", "draft")
      .is("deleted_at", null)

    if (runsError) {
      return { ok: false, error: runsError.message, status: 500, runIds: [] }
    }

    runIds = (runs || []).map((run) => String(run.id)).sort()
  }

  const recalculated: string[] = []
  for (const id of runIds) {
    const result = await recalcPayrollEntryForStaffOnDraftRun({
      supabase,
      businessId,
      businessCountry,
      runId: id,
      staffId,
    })
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        status: result.status,
        runIds: recalculated,
      }
    }
    recalculated.push(id)
  }

  return { ok: true, runIds: recalculated }
}
