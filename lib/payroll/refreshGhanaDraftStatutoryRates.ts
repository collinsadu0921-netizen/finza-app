import type { SupabaseClient } from "@supabase/supabase-js"
import {
  computeDraftEntryRecalculation,
  type DraftPayrollEntryForRecalc,
  type DraftPayrollRunForRecalc,
} from "@/lib/payroll/recalcPayrollEntryForStaff"
import type { ComputedPayrollEntryRow } from "@/lib/payroll/computeStaffPayrollEntry"
import { isGhanaMonthlyStatutoryEngine } from "@/lib/payroll/salaryBasis"
import { resolveRunStatutoryPeriodDate } from "@/lib/payroll/payrollStatutoryPeriod"
import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"
import { toCalendarDate } from "@/lib/payrollEngine/versioning"
import { resolveGhanaStatutoryRatesForPeriod } from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"

/**
 * Refresh a draft Ghana payroll run to the currently configured statutory versions.
 *
 * This is intentionally draft-only. It is used when:
 * - an annual SSNIT notice was published after the draft was created, or
 * - a provisional draft must be moved onto newly configured official limits
 *   before approval.
 *
 * Every employee entry is computed first, without writing. The complete result
 * is then applied by a single database RPC that locks the run and entries,
 * verifies concurrency, reconciles totals, updates header + entries + totals,
 * and writes an audit event in one transaction. Any failure rolls back all of it.
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
    .select("*")
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

  const { data: entryRows, error: entriesError } = await supabase
    .from("payroll_entries")
    .select("*")
    .eq("payroll_run_id", runId)
    .order("id", { ascending: true })

  if (entriesError) {
    return { ok: false, error: entriesError.message, status: 500 }
  }
  const entries = (entryRows || []) as DraftPayrollEntryForRecalc[]
  if (entries.length === 0) {
    return {
      ok: false,
      error: "This payroll run has no employee entries to recalculate.",
      status: 400,
    }
  }

  // Derive the statutory period from the run's authoritative date fields. Only
  // when those are missing (legacy draft) fall back to a single consistent
  // employee snapshot; conflicting entry periods fail closed.
  let statutoryPeriod = resolveRunStatutoryPeriodDate({
    ...run,
    payroll_month: null,
  })
  if (!statutoryPeriod) {
    const includedPeriods = Array.from(
      new Set(
        entries
          .filter((entry) => entry.is_included !== false)
          .map((entry) => {
            try {
              return toCalendarDate(String(entry.statutory_period_basis ?? ""))
            } catch {
              return null
            }
          })
          .filter((value): value is string => Boolean(value))
      )
    )
    if (includedPeriods.length === 1) statutoryPeriod = includedPeriods[0]
  }

  if (!statutoryPeriod) {
    return {
      ok: false,
      error:
        "This payroll run has no single usable statutory period. Repair its calculation metadata or set the pay period before approval.",
      status: 400,
    }
  }

  let resolved
  try {
    resolved = resolveGhanaStatutoryRatesForPeriod(statutoryPeriod)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unable to resolve Ghana statutory rates",
      status: 400,
    }
  }

  const ratesChanged =
    String(run.paye_rate_version || "") !== resolved.paye.version ||
    String(run.pension_rate_version || "") !== resolved.pension.version ||
    Boolean(run.pension_limits_provisional) !== (resolved.pension.isProvisional === true) ||
    Number(run.pension_minimum_insurable_earnings ?? NaN) !==
      resolved.pension.minimumInsurableEarnings ||
    Number(run.pension_maximum_insurable_earnings ?? NaN) !==
      resolved.pension.maximumInsurableEarnings ||
    String(run.pension_limits_effective_from || "") !==
      (resolved.pension.limitsEffectiveFrom ?? resolved.pension.effectiveFrom)

  const metadataMissing =
    !run.calculation_engine_version ||
    !run.calculation_jurisdiction ||
    !run.statutory_period_basis ||
    !run.paye_rate_version ||
    !run.pension_rate_version

  if (!ratesChanged && !metadataMissing) {
    return { ok: true, changed: false }
  }

  const ghanaRateVersions = {
    payeRateVersion: resolved.paye.version,
    pensionRateVersion: resolved.pension.version,
    periodBasis: statutoryPeriod,
  }

  const computedEntries: Array<{
    entry_id: string
    expected_updated_at: string | null
    fields: Omit<ComputedPayrollEntryRow, "staff_id">
  }> = []

  for (const entry of entries) {
    const computed = await computeDraftEntryRecalculation({
      supabase,
      businessId,
      businessCountry: String(businessCountry),
      runId,
      staffId: String(entry.staff_id),
      payrollRun: run as DraftPayrollRunForRecalc,
      existingEntry: entry,
      statutoryPeriod,
      ghanaRateVersions,
    })
    if (!computed.ok) return computed

    computedEntries.push({
      entry_id: computed.entryId,
      expected_updated_at: computed.expectedUpdatedAt,
      fields: computed.entryUpdate,
    })
  }

  const totals = rollupPayrollRunTotals(computedEntries.map((entry) => entry.fields))
  const first = computedEntries[0].fields

  if (!run.updated_at) {
    return {
      ok: false,
      error: "This payroll run is missing its revision timestamp. Reload the draft and try again.",
      status: 409,
    }
  }

  const { data: applied, error: applyError } = await supabase.rpc(
    "apply_payroll_draft_recalculation_atomic",
    {
      p_business_id: businessId,
      p_payroll_run_id: runId,
      p_expected_run_updated_at: run.updated_at,
      p_entries: computedEntries,
      p_run: {
        calculation_engine_version: first.calculation_engine_version ?? null,
        calculation_jurisdiction: first.calculation_jurisdiction ?? null,
        statutory_period_basis: first.statutory_period_basis ?? statutoryPeriod,
        paye_rate_version: first.paye_rate_version ?? resolved.paye.version,
        pension_rate_version: first.pension_rate_version ?? resolved.pension.version,
        pension_limits_provisional: resolved.pension.isProvisional === true,
        pension_minimum_insurable_earnings: resolved.pension.minimumInsurableEarnings,
        pension_maximum_insurable_earnings: resolved.pension.maximumInsurableEarnings,
        pension_limits_effective_from:
          resolved.pension.limitsEffectiveFrom ?? resolved.pension.effectiveFrom,
        ...totals,
      },
      p_reset_provisional_ack: ratesChanged,
    }
  )

  if (applyError) {
    const concurrent = /concurrent|modified by another request/i.test(applyError.message)
    return {
      ok: false,
      error: applyError.message,
      status: concurrent ? 409 : 400,
    }
  }

  const appliedResult = applied as { applied?: boolean; entry_count?: number } | null
  if (!appliedResult?.applied) {
    return {
      ok: false,
      error: "The payroll recalculation was not applied. Reload the draft and try again.",
      status: 409,
    }
  }

  return { ok: true, changed: true }
}
