/**
 * Shrinks the client Finza Assist snapshot before embedding in the system prompt.
 * Full tenant data is available via read-only tools on the server.
 */

export type FinzaAssistClientContext = Record<string, unknown> | null | undefined

const OMITTED_HEAVY_KEYS = [
  "invoices",
  "bills",
  "transactions",
  "journal_entries",
  "customers",
  "suppliers",
  "accounts",
  "chart_of_accounts",
  "service_jobs",
  "tax_profile",
  "business_profile",
  "ocr",
  "receipt_ocr",
  "suggestions",
  "unpaid_invoices_total",
  "unpaid_bills_total",
] as const

function compactMonthlySummary(
  raw: unknown
): Record<string, unknown> | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined
  }

  const summary = raw as Record<string, unknown>
  const compact: Record<string, unknown> = {}

  for (const periodKey of ["current_month", "last_month"] as const) {
    const period = summary[periodKey]
    if (period == null || typeof period !== "object" || Array.isArray(period)) {
      continue
    }
    const p = period as Record<string, unknown>
    compact[periodKey] = {
      period_start: p.period_start ?? null,
      period_end: p.period_end ?? null,
      total_income: p.total_income ?? null,
      total_expenses: p.total_expenses ?? null,
      net_profit: p.net_profit ?? null,
    }
  }

  return Object.keys(compact).length > 0 ? compact : undefined
}

function readStringField(ctx: Record<string, unknown>, key: string): string | undefined {
  const value = ctx[key]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * Build a minimal page context for the AI system prompt.
 * Always uses the server-verified business id (never trusts a mismatched client id).
 */
export function buildMinimalFinzaAssistContext(
  context: FinzaAssistClientContext,
  verifiedBusinessId: string
): Record<string, unknown> {
  const minimal: Record<string, unknown> = {
    business_id: verifiedBusinessId,
    page_scope: "minimal",
    note: "Use tools for live figures; full tenant snapshot omitted for performance.",
  }

  if (context == null || typeof context !== "object" || Array.isArray(context)) {
    return minimal
  }

  const ctx = context as Record<string, unknown>

  const currentPath = readStringField(ctx, "current_path")
  if (currentPath) {
    minimal.current_path = currentPath
  }

  const pageInvoiceId = readStringField(ctx, "page_invoice_id")
  if (pageInvoiceId) {
    minimal.page_invoice_id = pageInvoiceId
  }

  const monthlySummary = compactMonthlySummary(ctx.monthly_summary)
  if (monthlySummary) {
    minimal.monthly_summary = monthlySummary
  }

  return minimal
}

/** Keys that must not appear in minimal context output. */
export function omittedHeavyContextKeys(): readonly string[] {
  return OMITTED_HEAVY_KEYS
}
