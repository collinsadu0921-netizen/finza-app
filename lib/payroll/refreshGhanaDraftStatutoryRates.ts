import type { SupabaseClient } from "@supabase/supabase-js"
import { recalcPayrollEntryForStaffOnDraftRun } from "@/lib/payroll/recalcPayrollEntryForStaff"
import { isGhanaMonthlyStatutoryEngine } from "@/lib/payroll/salaryBasis"
import { resolveGhanaStatutoryRatesForPeriod } from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"

/**
 * Refresh a draft Ghana payroll run to the currently configured statutory versions.
 *
 * This is intentionally draft-only. It is used when:
 * - an annual SSNIT notice was published after the draft was created, or
 * - a provisional draft must be moved onto newly configured official limits
 *   before approval.
 *
 * Approved/locked/reversed runs are immutable; their differences are handled
 * through the existing reversal/correction workflow.
 */
export async function refreshGhanaDraftStatutoryRates(params: {
  supabase: SupabaseClient
  businessId: string
  businessCountry: string | null | undefined
  runId: string
}): Promise<
  | { ok: true; changed: boolean }
  | { ok: false; error: string; status: number }
> {
  const { supabase, businessId, businessCountry, runId } = params
  if (!isGhanaMonthlyStatutoryEngine(businessCountry)) {
    return { ok: true, changed: false }
  }

  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select(
      "id, status, payroll_month, paye_rate_version, pension_rate_version, pension_limits_provisional, pension_minimum_insurable_earnings, pension_maximum_insurable_earnings, pension_limits_effective_from"
    )
    .eq("id", runId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (runError || !run) {
    return { ok: false, error: runError?.message || "Payroll run not found", status: 404 }
  }
  if (run.status !== "draft") {
    return {
      ok: false,
      error: "Only draft payroll runs can be refreshed to new statutory versions",
      status: 400,
    }
  }

  let resolved
  try {
    resolved = resolveGhanaStatutoryRatesForPeriod(run.payroll_month)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unable to resolve Ghana statutory rates",
      status: 400,
    }
  }

  const next = {
    paye_rate_version: resolved.paye.version,
    pension_rate_version: resolved.pension.version,
    pension_limits_provisional: resolved.pension.isProvisional === true,
    pension_minimum_insurable_earnings: resolved.pension.minimumInsurableEarnings,
    pension_maximum_insurable_earnings: resolved.pension.maximumInsurableEarnings,
    pension_limits_effective_from:
      resolved.pension.limitsEffectiveFrom ?? resolved.pension.effectiveFrom,
  }

  const changed =
    String(run.paye_rate_version || "") !== next.paye_rate_version ||
    String(run.pension_rate_version || "") !== next.pension_rate_version ||
    Boolean(run.pension_limits_provisional) !== next.pension_limits_provisional ||
    Number(run.pension_minimum_insurable_earnings ?? NaN) !==
      next.pension_minimum_insurable_earnings ||
    Number(run.pension_maximum_insurable_earnings ?? NaN) !==
      next.pension_maximum_insurable_earnings ||
    String(run.pension_limits_effective_from || "") !== next.pension_limits_effective_from

  if (!changed) return { ok: true, changed: false }

  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({
      ...next,
      // A refreshed draft needs a fresh acknowledgement if it remains provisional.
      provisional_ssnit_acknowledged_at: null,
      provisional_ssnit_acknowledged_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("business_id", businessId)
    .eq("status", "draft")

  if (updateError) {
    return { ok: false, error: updateError.message, status: 500 }
  }

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_entries")
    .select("staff_id")
    .eq("payroll_run_id", runId)

  if (entriesError) {
    return { ok: false, error: entriesError.message, status: 500 }
  }

  for (const entry of entries || []) {
    const result = await recalcPayrollEntryForStaffOnDraftRun({
      supabase,
      businessId,
      businessCountry: String(businessCountry),
      runId,
      staffId: String(entry.staff_id),
    })
    if (!result.ok) return result
  }

  return { ok: true, changed: true }
}
