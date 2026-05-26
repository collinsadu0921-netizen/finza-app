/**
 * Ghana system tax schedule metadata for invoice tax_lines (Phase 2A).
 * Read-only resolution + non-mutating enrichment of TaxResult.lines meta only.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { TaxLine, TaxResult } from "@/lib/taxEngine/types"

export type GhanaScheduleLineMeta = {
  tax_schedule_id: string
  tax_schedule_code: string
  tax_schedule_line_id: string
  gra_field_name: string | null
  gra_levy_slot: string | null
  classification: string
}

const GH_SYSTEM_SCHEDULE_CODE = "GH_EVAT_LEVY_MAP_V8_2" as const

type ScheduleRow = {
  id: string
  code: string
  tax_schedule_lines?: Array<{
    id: string
    internal_code: string
    gra_field_name: string | null
    gra_levy_slot: string | null
    classification: string
  }> | null
}

/**
 * Load system GH E-VAT levy schedule + lines. Returns null if missing, RLS denied, or any error.
 * Non-blocking: callers continue with unenriched tax lines.
 */
export async function fetchGhanaEvatLevyScheduleMetadataMap(
  supabase: SupabaseClient,
  options?: { effectiveDate?: string }
): Promise<Map<string, GhanaScheduleLineMeta> | null> {
  try {
    const effectiveDate = (options?.effectiveDate ?? "1970-01-01").split("T")[0]

    const { data, error } = await supabase
      .from("tax_schedules")
      .select(
        `
        id,
        code,
        tax_schedule_lines (
          id,
          internal_code,
          gra_field_name,
          gra_levy_slot,
          classification
        )
      `
      )
      .eq("jurisdiction", "GH")
      .eq("code", GH_SYSTEM_SCHEDULE_CODE)
      .is("business_id", null)
      .lte("effective_from", effectiveDate)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    const schedule = data as ScheduleRow
    const lines = schedule.tax_schedule_lines
    if (!Array.isArray(lines) || lines.length === 0) {
      return null
    }

    const map = new Map<string, GhanaScheduleLineMeta>()
    for (const row of lines) {
      if (!row?.internal_code) continue
      const key = row.internal_code.trim().toUpperCase()
      map.set(key, {
        tax_schedule_id: schedule.id,
        tax_schedule_code: schedule.code,
        tax_schedule_line_id: row.id,
        gra_field_name: row.gra_field_name,
        gra_levy_slot: row.gra_levy_slot != null ? String(row.gra_levy_slot).trim() : null,
        classification: row.classification,
      })
    }

    return map.size > 0 ? map : null
  } catch {
    return null
  }
}

/**
 * Clone tax lines and merge schedule metadata into line.meta for matching internal_code only.
 * Does not change code, amount, rate, name, base, or ledger fields.
 */
export function enrichGhanaTaxLinesWithScheduleMetadata(
  lines: TaxLine[],
  scheduleByInternalCode: Map<string, GhanaScheduleLineMeta> | null
): TaxLine[] {
  if (!scheduleByInternalCode || scheduleByInternalCode.size === 0) {
    return lines
  }

  return lines.map((line) => {
    const key = line.code.trim().toUpperCase()
    const ref = scheduleByInternalCode.get(key)
    if (!ref) {
      return line
    }
    return {
      ...line,
      meta: {
        ...(line.meta ?? {}),
        tax_schedule_id: ref.tax_schedule_id,
        tax_schedule_code: ref.tax_schedule_code,
        tax_schedule_line_id: ref.tax_schedule_line_id,
        gra_field_name: ref.gra_field_name,
        gra_levy_slot: ref.gra_levy_slot,
        classification: ref.classification,
      },
    }
  })
}

/**
 * Returns a new TaxResult with enriched lines when jurisdiction is GH and a map is provided.
 */
export function enrichGhanaTaxResultWithScheduleMetadata(
  result: TaxResult,
  scheduleByInternalCode: Map<string, GhanaScheduleLineMeta> | null
): TaxResult {
  if (result.meta.jurisdiction !== "GH" || !scheduleByInternalCode?.size) {
    return result
  }
  const enrichedLines = enrichGhanaTaxLinesWithScheduleMetadata(result.lines, scheduleByInternalCode)
  if (enrichedLines === result.lines) {
    return result
  }
  return {
    ...result,
    lines: enrichedLines,
  }
}
