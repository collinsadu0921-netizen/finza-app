import type { SupabaseClient } from "@supabase/supabase-js"
import { computeStaffScopeFingerprint } from "@/lib/payroll/payrollPeriod"

/** Recompute and persist staff_scope_fingerprint from included payroll entries. */
export async function syncPayrollRunStaffScopeFingerprint(
  supabase: SupabaseClient,
  runId: string
): Promise<string> {
  const { data: entries, error } = await supabase
    .from("payroll_entries")
    .select("staff_id, is_included")
    .eq("payroll_run_id", runId)

  if (error) throw error

  const includedStaffIds = (entries || [])
    .filter((entry) => entry.is_included !== false)
    .map((entry) => String(entry.staff_id))

  const fingerprint = computeStaffScopeFingerprint(includedStaffIds)

  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({
      staff_scope_fingerprint: fingerprint,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)

  if (updateError) throw updateError

  return fingerprint
}
