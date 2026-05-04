import type { SupabaseClient } from "@supabase/supabase-js"

/** Post-034-style column names (renamed levies + validity_date). */
export const PUBLIC_ESTIMATE_COLUMNS_MODERN = [
  "id",
  "business_id",
  "customer_id",
  "estimate_number",
  "issue_date",
  "validity_date",
  "notes",
  "subtotal",
  "subtotal_before_tax",
  "nhil",
  "getfund",
  "covid",
  "vat",
  "total_tax_amount",
  "tax",
  "total_amount",
  "status",
  "tax_lines",
  "currency_code",
  "currency_symbol",
  "public_token",
  "client_name_signed",
  "client_id_type",
  "client_id_number",
  "client_signature",
  "signed_at",
  "rejected_reason",
  "rejected_at",
  "fx_rate",
  "home_currency_code",
  "home_currency_total",
].join(", ")

/** Pre-rename / partial-migration DBs: expiry_date + nhil_amount-style levies. */
export const PUBLIC_ESTIMATE_COLUMNS_LEGACY = [
  "id",
  "business_id",
  "customer_id",
  "estimate_number",
  "issue_date",
  "expiry_date",
  "notes",
  "subtotal",
  "subtotal_before_tax",
  "nhil_amount",
  "getfund_amount",
  "covid_amount",
  "vat_amount",
  "total_tax_amount",
  "tax",
  "total_amount",
  "status",
  "tax_lines",
  "currency_code",
  "currency_symbol",
  "public_token",
  "client_name_signed",
  "client_id_type",
  "client_id_number",
  "client_signature",
  "signed_at",
  "rejected_reason",
  "rejected_at",
  "fx_rate",
  "home_currency_code",
  "home_currency_total",
].join(", ")

type PgErr = { message?: string; code?: string; details?: string; hint?: string } | null

/**
 * Loads one estimate row for public quote/PDF. Tries modern PostgREST column names first,
 * then legacy names — mutually exclusive migrations mean a single static select cannot
 * work on both databases.
 */
export async function fetchPublicEstimateRowByToken(
  supabase: SupabaseClient,
  token: string
): Promise<{
  data: Record<string, unknown> | null
  error: PgErr
  columnVariant: "modern" | "legacy" | null
}> {
  const variants: { columnVariant: "modern" | "legacy"; select: string }[] = [
    { columnVariant: "modern", select: PUBLIC_ESTIMATE_COLUMNS_MODERN },
    { columnVariant: "legacy", select: PUBLIC_ESTIMATE_COLUMNS_LEGACY },
  ]

  let lastError: PgErr = null

  for (const v of variants) {
    const { data, error } = (await supabase
      .from("estimates")
      .select(v.select)
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()) as {
      data: Record<string, unknown> | null
      error: PgErr
    }

    if (!error) {
      if (data) {
        return { data, error: null, columnVariant: v.columnVariant }
      }
      return { data: null, error: null, columnVariant: null }
    }

    lastError = error
    const msg = String(error?.message || "")
    const code = String(error?.code || "")
    const missingColumn =
      code === "42703" ||
      msg.includes("does not exist") ||
      msg.includes("Could not find") ||
      code === "PGRST204"

    if (!missingColumn) {
      return { data: null, error, columnVariant: null }
    }
  }

  return { data: null, error: lastError, columnVariant: null }
}
