/**
 * Resolves inclusive movement dates for P&L (ledger activity in range).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveAccountingPeriodForReport, type ResolvedPeriod } from "@/lib/accounting/resolveAccountingPeriodForReport"
import type { PnLReportInput } from "./getProfitAndLossReport"

export type PnLMovementRange = {
  movementStart: string
  movementEnd: string
  period: ResolvedPeriod
}

export async function resolvePnLMovementRange(
  supabase: SupabaseClient,
  input: PnLReportInput
): Promise<{ range: PnLMovementRange | null; error: string }> {
  const { businessId } = input
  const rangeStart = input.start_date?.trim() ?? ""
  const rangeEnd = input.end_date?.trim() ?? ""
  const hasExplicitDateRange =
    !!(
      rangeStart &&
      rangeEnd &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) &&
      rangeStart <= rangeEnd
    )

  if (hasExplicitDateRange) {
    const { data: anchor } = await supabase
      .from("accounting_periods")
      .select("id")
      .eq("business_id", businessId)
      .lte("period_start", rangeEnd)
      .gte("period_end", rangeStart)
      .order("period_start", { ascending: true })
      .limit(1)
      .maybeSingle()

    return {
      range: {
        movementStart: rangeStart,
        movementEnd: rangeEnd,
        period: {
          period_id: anchor?.id ?? "",
          period_start: rangeStart,
          period_end: rangeEnd,
          resolution_reason: "date_range",
        },
      },
      error: "",
    }
  }

  const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
    supabase,
    {
      businessId,
      period_id: input.period_id,
      period_start: input.period_start,
      as_of_date: input.as_of_date,
      start_date: input.start_date,
      end_date: input.end_date,
    }
  )
  if (resolveError || !resolvedPeriod) {
    return { range: null, error: resolveError ?? "Accounting period could not be resolved" }
  }

  return {
    range: {
      movementStart: resolvedPeriod.period_start,
      movementEnd: resolvedPeriod.period_end,
      period: resolvedPeriod,
    },
    error: "",
  }
}
