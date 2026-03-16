import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Only owner or business_users (admin/accountant) may trigger bootstrap.
 * Firm users (authority_source === "accountant" from engagement) must never bootstrap.
 */
export function canUserInitializeAccounting(authoritySource?: string): boolean {
  return authoritySource === "owner" || authoritySource === "employee"
}

/** Structured error for API responses and server logs (tenant-safe). */
export type AccountingBootstrapError = {
  error_code: string
  message: string
  step: "ensure_accounting_initialized"
  business_id: string
  supabase_error?: { message?: string; code?: string; details?: string }
}

/**
 * Ensure accounting is initialized for a business (Phase 13 Fortnox-style).
 * Database is the single source of truth: always call ensure_accounting_initialized RPC.
 * The RPC is idempotent (if period exists, returns no-op). Frontend must NOT decide
 * whether accounting is initialized — only the database function does.
 *
 * Creates accounts, chart_of_accounts + control mappings (AR/AP/CASH/BANK), and one
 * open period if none exist. Does NOT create journal entries, snapshots, or balances.
 */
export async function ensureAccountingInitialized(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ initialized: boolean; error?: string; structuredError?: AccountingBootstrapError }> {
  const step = "ensure_accounting_initialized"
  const { error } = await supabase.rpc("ensure_accounting_initialized", {
    p_business_id: businessId,
  })

  if (error) {
    const isInitDenied =
      typeof error.message === "string" &&
      error.message.includes("Not allowed to initialize accounting for this business")
    const structured: AccountingBootstrapError = {
      error_code: isInitDenied ? "INIT_DENIED" : "ACCOUNTING_BOOTSTRAP_FAILED",
      message: isInitDenied
        ? error.message
        : "Unable to start accounting. Please try again.",
      step,
      business_id: businessId,
      supabase_error: {
        message: error.message,
        code: error.code,
        details: error.details,
      },
    }
    console.error("accountingBootstrap: ensure_accounting_initialized failed", {
      step,
      business_id: businessId,
      error_code: structured.error_code,
      supabase_error: structured.supabase_error,
    })
    return {
      initialized: false,
      error: structured.message,
      structuredError: structured,
    }
  }

  return { initialized: true }
}
