import type { SupabaseClient } from "@supabase/supabase-js"
import {
  GH_WHT_RATES,
  LEGACY_WHT_RATES,
  type WHTRate,
} from "@/lib/wht"

export type WhtRateResolutionSource = "database" | "static_fallback"

export type ResolvedWhtRate = WHTRate & {
  source: WhtRateResolutionSource
  effectiveFrom: string
  active: boolean
}

export type WhtRateResolutionErrorCode =
  | "WHT_CATEGORY_INVALID"
  | "WHT_RATE_UNAVAILABLE"
  | "WHT_RATE_INVALID"
  | "WHT_TRANSACTION_DATE_INVALID"

export class WhtRateResolutionError extends Error {
  readonly code: WhtRateResolutionErrorCode

  constructor(code: WhtRateResolutionErrorCode, message: string) {
    super(message)
    this.name = "WhtRateResolutionError"
    this.code = code
  }
}

type WhtRateRow = {
  code: string
  name: string
  rate: number | string
  description: string | null
  jurisdiction: string | null
  effective_from: string
  active: boolean | null
}

const CURRENT_RATE_EFFECTIVE_DATE = "2026-01-01"

function normalizeTransactionDate(value: string): string {
  const date = String(value || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new WhtRateResolutionError(
      "WHT_TRANSACTION_DATE_INVALID",
      "A valid transaction date (YYYY-MM-DD) is required to resolve withholding tax."
    )
  }
  return date
}

function categoryForCode(code: string): WHTRate["category"] {
  const current = GH_WHT_RATES.find((rate) => rate.code === code)
  if (current) return current.category

  const legacy = LEGACY_WHT_RATES.find((rate) => rate.code === code)
  if (legacy) return legacy.category

  if (code.startsWith("GH_NR_")) return "non_resident"
  if (code.startsWith("GH_RENT_")) return "resident_rent"
  if (code.startsWith("GH_DIV_")) return "resident_dividend"
  if (code.startsWith("GH_INT_")) return "resident_interest"
  return "resident_contract"
}

function staticRateForDate(code: string, transactionDate: string): WHTRate | null {
  if (transactionDate >= CURRENT_RATE_EFFECTIVE_DATE) {
    return GH_WHT_RATES.find((rate) => rate.code === code) ?? null
  }
  return LEGACY_WHT_RATES.find((rate) => rate.code === code) ?? null
}

function toResolvedRate(
  row: WhtRateRow,
  source: WhtRateResolutionSource
): ResolvedWhtRate {
  return {
    code: row.code,
    name: row.name,
    rate: Number(row.rate),
    description: row.description ?? "",
    category: categoryForCode(row.code),
    source,
    effectiveFrom: String(row.effective_from).slice(0, 10),
    active: row.active !== false,
  }
}

/**
 * Resolve a Ghana WHT rate for a transaction date.
 *
 * The configured `wht_rates` table is authoritative. If it cannot be read,
 * current-period codes fall back to the current static rates and historical
 * codes fall back to the historical static rates. A current rate is never
 * substituted for a historical transaction, and a historical rate is never
 * used for a current transaction.
 */
export async function resolveWhtRateForDate(
  supabase: SupabaseClient,
  code: string | null | undefined,
  transactionDate: string
): Promise<ResolvedWhtRate> {
  const normalizedCode = typeof code === "string" ? code.trim() : ""
  if (!normalizedCode) {
    throw new WhtRateResolutionError(
      "WHT_CATEGORY_INVALID",
      "Select a valid WHT category."
    )
  }

  const date = normalizeTransactionDate(transactionDate)

  try {
    const { data, error } = await supabase
      .from("wht_rates")
      .select("code, name, rate, description, jurisdiction, effective_from, active")
      .eq("jurisdiction", "GH")
      .eq("code", normalizedCode)
      .lte("effective_from", date)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new WhtRateResolutionError(
        "WHT_RATE_UNAVAILABLE",
        "The WHT rate configuration could not be read. Try again or contact support."
      )
    }

    if (data) {
      const row = data as WhtRateRow
      const rate = Number(row.rate)
      if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
        throw new WhtRateResolutionError(
          "WHT_RATE_INVALID",
          "The configured WHT rate is invalid. Correct the rate configuration before using this category."
        )
      }
      if (row.active === false && date >= CURRENT_RATE_EFFECTIVE_DATE) {
        throw new WhtRateResolutionError(
          "WHT_CATEGORY_INVALID",
          "This WHT category is historical and cannot be used for a current transaction."
        )
      }
      return toResolvedRate(row, "database")
    }
  } catch (error) {
    if (error instanceof WhtRateResolutionError) throw error
    throw new WhtRateResolutionError(
      "WHT_RATE_UNAVAILABLE",
      "The WHT rate configuration could not be read. Try again or contact support."
    )
  }

  const fallback = staticRateForDate(normalizedCode, date)
  if (!fallback) {
    throw new WhtRateResolutionError(
      "WHT_CATEGORY_INVALID",
      "Select a valid WHT category for this transaction date."
    )
  }

  console.warn("[wht] rate table unavailable or rate missing; using static fallback", {
    code: normalizedCode,
    transactionDate: date,
  })

  return {
    ...fallback,
    source: "static_fallback",
    effectiveFrom:
      date >= CURRENT_RATE_EFFECTIVE_DATE ? CURRENT_RATE_EFFECTIVE_DATE : "2000-01-01",
    active: date >= CURRENT_RATE_EFFECTIVE_DATE,
  }
}
