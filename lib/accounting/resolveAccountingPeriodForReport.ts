import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Canonical resolution reasons for report period (telemetry / debug).
 * Raw dates must NEVER drive financial aggregation; server resolves to accounting_periods.id.
 */
export type ResolutionReason =
  | "period_id"
  | "period_start"
  | "as_of_date"
  | "date_range"
  | "latest_activity"
  | "current_month_fallback"

export type ResolvedPeriod = {
  period_id: string
  period_start: string
  period_end: string
  resolution_reason: ResolutionReason
}

export type ResolveAccountingPeriodInput = {
  businessId: string
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
}

/**
 * Universal resolver: all financial reports MUST resolve to accounting_periods.id server-side.
 * Priority: period_id → period_start → as_of_date → start_date/end_date → latest with activity → current month fallback.
 * Uses existing DB RPCs: ensure_accounting_period, resolve_default_accounting_period.
 * Multi-tenant safe: all lookups scoped by businessId.
 */
export async function resolveAccountingPeriodForReport(
  supabase: SupabaseClient,
  input: ResolveAccountingPeriodInput
): Promise<{ period: ResolvedPeriod | null; error?: string }> {
  const { businessId, period_id, period_start, as_of_date, start_date, end_date } = input

  if (!businessId?.trim()) {
    return { period: null, error: "Missing required parameter: business_id" }
  }

  // 1. period_id
  if (period_id?.trim()) {
    const { data: row, error } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", businessId)
      .eq("id", period_id.trim())
      .maybeSingle()
    if (!error && row) {
      return {
        period: {
          period_id: row.id,
          period_start: row.period_start,
          period_end: row.period_end,
          resolution_reason: "period_id",
        },
      }
    }
    if (error) {
      console.error("resolveAccountingPeriodForReport period_id lookup failed:", error)
      return { period: null, error: "Accounting period could not be resolved" }
    }
  }

  // 2. period_start
  if (period_start?.trim()) {
    const periodDate =
      period_start.length === 7 ? `${period_start}-01` : period_start
    let { data: row, error } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", businessId)
      .eq("period_start", periodDate)
      .maybeSingle()
    if (!row && !error) {
      const { error: ensureErr } = await supabase.rpc("ensure_accounting_period", {
        p_business_id: businessId,
        p_date: periodDate,
      })
      if (ensureErr) {
        console.error("ensure_accounting_period failed:", ensureErr)
        return { period: null, error: "Accounting period could not be resolved" }
      }
      const refetch = await supabase
        .from("accounting_periods")
        .select("id, period_start, period_end")
        .eq("business_id", businessId)
        .eq("period_start", periodDate)
        .maybeSingle()
      row = refetch.data ?? null
      error = refetch.error ?? null
    }
    if (!error && row) {
      return {
        period: {
          period_id: row.id,
          period_start: row.period_start,
          period_end: row.period_end,
          resolution_reason: "period_start",
        },
      }
    }
    if (error) {
      console.error("resolveAccountingPeriodForReport period_start failed:", error)
      return { period: null, error: "Accounting period could not be resolved" }
    }
  }

  // 3. as_of_date
  if (as_of_date?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(as_of_date.trim())) {
    const date = as_of_date.trim()
    let { data: row, error } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", businessId)
      .lte("period_start", date)
      .gte("period_end", date)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!row && !error) {
      const { error: ensureErr } = await supabase.rpc("ensure_accounting_period", {
        p_business_id: businessId,
        p_date: date,
      })
      if (ensureErr) {
        console.error("ensure_accounting_period failed:", ensureErr)
        return { period: null, error: "Accounting period could not be resolved for the selected date." }
      }
      const refetch = await supabase
        .from("accounting_periods")
        .select("id, period_start, period_end")
        .eq("business_id", businessId)
        .lte("period_start", date)
        .gte("period_end", date)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle()
      row = refetch.data ?? null
      error = refetch.error ?? null
    }
    if (!error && row) {
      return {
        period: {
          period_id: row.id,
          period_start: row.period_start,
          period_end: row.period_end,
          resolution_reason: "as_of_date",
        },
      }
    }
    if (error) {
      console.error("resolveAccountingPeriodForReport as_of_date failed:", error)
      return { period: null, error: "Accounting period could not be resolved for the selected date." }
    }
  }

  // 4. start_date / end_date (map to single period containing start_date, or overlapping)
  const rangeStart = start_date?.trim()
  const rangeEnd = end_date?.trim()
  if (rangeStart && /^\d{4}-\d{2}-\d{2}$/.test(rangeStart)) {
    const useDate = rangeEnd && /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) ? rangeStart : rangeStart
    let { data: row, error } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", businessId)
      .lte("period_start", useDate)
      .gte("period_end", useDate)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!row && !error) {
      const { error: ensureErr } = await supabase.rpc("ensure_accounting_period", {
        p_business_id: businessId,
        p_date: useDate,
      })
      if (ensureErr) {
        console.error("ensure_accounting_period failed:", ensureErr)
        return { period: null, error: "Accounting period could not be resolved for the date range." }
      }
      const refetch = await supabase
        .from("accounting_periods")
        .select("id, period_start, period_end")
        .eq("business_id", businessId)
        .lte("period_start", useDate)
        .gte("period_end", useDate)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle()
      row = refetch.data ?? null
      error = refetch.error ?? null
    }
    if (!error && row) {
      return {
        period: {
          period_id: row.id,
          period_start: row.period_start,
          period_end: row.period_end,
          resolution_reason: "date_range",
        },
      }
    }
    if (error) {
      console.error("resolveAccountingPeriodForReport date_range failed:", error)
      return { period: null, error: "Accounting period could not be resolved for the date range." }
    }
  }

  // 5. Latest period with journal activity (DB RPC)
  const { data: defaultRows, error: resolveError } = await supabase.rpc(
    "resolve_default_accounting_period",
    { p_business_id: businessId }
  )
  if (!resolveError && defaultRows && defaultRows.length > 0) {
    const r = defaultRows[0]
    const reason = mapDbResolutionReasonToEnum(r.resolution_reason)
    return {
      period: {
        period_id: r.period_id,
        period_start: r.period_start,
        period_end: r.period_end,
        resolution_reason: reason,
      },
    }
  }
  if (resolveError) {
    console.error("resolve_default_accounting_period failed:", resolveError)
    return { period: null, error: "Could not resolve default accounting period." }
  }

  // 6. Fallback: ensure current month period exists and return it
  // Contract v1.1: normalize "today" to business timezone before period resolution
  const { data: bizRow } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle()
  const tz = (bizRow?.timezone ?? "UTC").trim() || "UTC"
  const today = getDateInTimezone(new Date(), tz)
  const { error: ensureErr } = await supabase.rpc("ensure_accounting_period", {
    p_business_id: businessId,
    p_date: today,
  })
  if (ensureErr) {
    console.error("ensure_accounting_period (fallback) failed:", ensureErr)
    return { period: null, error: "Accounting period could not be resolved." }
  }
  const { data: fallbackRow, error: fallbackError } = await supabase
    .from("accounting_periods")
    .select("id, period_start, period_end")
    .eq("business_id", businessId)
    .lte("period_start", today)
    .gte("period_end", today)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (fallbackError || !fallbackRow) {
    return { period: null, error: "Accounting period could not be resolved." }
  }
  return {
    period: {
      period_id: fallbackRow.id,
      period_start: fallbackRow.period_start,
      period_end: fallbackRow.period_end,
      resolution_reason: "current_month_fallback",
    },
  }
}

/**
 * Contract v1.1: Return YYYY-MM-DD for the given date interpreted in the given IANA timezone.
 */
function getDateInTimezone(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    const parts = formatter.formatToParts(date)
    const year = parts.find((p) => p.type === "year")?.value ?? "0000"
    const month = parts.find((p) => p.type === "month")?.value ?? "01"
    const day = parts.find((p) => p.type === "day")?.value ?? "01"
    return `${year}-${month}-${day}`
  } catch {
    return date.toISOString().split("T")[0]
  }
}

function mapDbResolutionReasonToEnum(dbReason: string | undefined): ResolutionReason {
  if (!dbReason) return "latest_activity"
  const s = String(dbReason).toLowerCase()
  if (s.includes("current_month") || s === "current_month_fallback") return "current_month_fallback"
  if (s.includes("open_with_activity") || s.includes("soft_closed") || s.includes("locked_with_activity")) return "latest_activity"
  return "latest_activity"
}
