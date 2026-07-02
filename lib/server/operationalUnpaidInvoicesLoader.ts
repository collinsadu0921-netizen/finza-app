/**
 * Operational unpaid invoice totals for the service dashboard.
 * Uses get_operational_unpaid_invoices_total RPC (not ledger AR).
 */

import type { createSupabaseServerClient } from "@/lib/supabaseServer"

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type OperationalUnpaidInvoicesSummary = {
  unpaidInvoicesTotal: number
  unpaidInvoicesCount: number
  overdueInvoicesTotal: number
  overdueInvoicesCount: number
}

export const EMPTY_OPERATIONAL_UNPAID_INVOICES: OperationalUnpaidInvoicesSummary = {
  unpaidInvoicesTotal: 0,
  unpaidInvoicesCount: 0,
  overdueInvoicesTotal: 0,
  overdueInvoicesCount: 0,
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  return roundMoney(Number(v) || 0)
}

function int(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

export function parseOperationalUnpaidInvoicesRpcResult(
  data: unknown
): OperationalUnpaidInvoicesSummary {
  const row = (data ?? {}) as Record<string, unknown>
  return {
    unpaidInvoicesTotal: num(row.unpaid_total),
    unpaidInvoicesCount: int(row.unpaid_count),
    overdueInvoicesTotal: num(row.overdue_total),
    overdueInvoicesCount: int(row.overdue_count),
  }
}

export async function loadOperationalUnpaidInvoicesSummary(
  supabase: SupabaseClient,
  businessId: string,
  options?: { softFail?: boolean }
): Promise<OperationalUnpaidInvoicesSummary> {
  const { data, error } = await supabase.rpc("get_operational_unpaid_invoices_total", {
    p_business_id: businessId,
  })

  if (error) {
    if (options?.softFail) {
      console.warn("[dashboard] operational unpaid invoices read failed:", error.message)
      return EMPTY_OPERATIONAL_UNPAID_INVOICES
    }
    throw error
  }

  return parseOperationalUnpaidInvoicesRpcResult(data)
}

export function mergeOperationalUnpaidIntoMetrics<T extends Record<string, unknown>>(
  metrics: T,
  summary: OperationalUnpaidInvoicesSummary
): T & OperationalUnpaidInvoicesSummary {
  return { ...metrics, ...summary }
}
