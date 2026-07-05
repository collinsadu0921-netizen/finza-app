import type { SupabaseClient } from "@supabase/supabase-js"
import type { GeneralLedgerAccountRow } from "@/lib/accounting/resolveGeneralLedgerAccount"
import { resolveGeneralLedgerAccount } from "@/lib/accounting/resolveGeneralLedgerAccount"

/** Payroll liability preset (chart codes). Missing codes are omitted — no placeholder accounts. */
export const PAYROLL_LIABILITY_PRESET_CODES = ["2230", "2231", "2232", "2240", "2241"] as const

export const PAYROLL_LIABILITY_PRESET_OPTIONS: { code: string; label: string }[] = [
  { code: "2230", label: "PAYE (2230)" },
  { code: "2231", label: "SSNIT / Tier 1 (2231)" },
  { code: "2232", label: "Tier 2 (2232)" },
  { code: "2240", label: "Net salaries payable (2240)" },
  { code: "2241", label: "Employee deductions / recoveries (2241)" },
]

export const MAX_GL_MULTI_ACCOUNTS = 40

export type GeneralLedgerRequestKind = "single" | "multi"

export type GeneralLedgerAccountSelectionResult = {
  kind: GeneralLedgerRequestKind
  accounts: GeneralLedgerAccountRow[]
  /** True when more than MAX_GL_MULTI_ACCOUNTS matched before truncation */
  truncated: boolean
  /** When kind is multi and accounts.length === 0 */
  emptyReason?: "no_accounts_in_range" | "no_preset_accounts" | "no_matching_codes"
}

/** Exported for tests — `accounts` should be sorted by code (numeric-aware). */
export function filterAccountsByCodeRange(
  accountsSorted: GeneralLedgerAccountRow[],
  from: string,
  to: string
): GeneralLedgerAccountRow[] {
  let a = from.trim()
  let b = to.trim()
  if (a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) > 0) {
    ;[a, b] = [b, a]
  }
  return accountsSorted.filter(
    (acc) =>
      acc.code.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }) >= 0 &&
      acc.code.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) <= 0
  )
}

function sortAccountsByCode(accounts: GeneralLedgerAccountRow[]): GeneralLedgerAccountRow[] {
  return [...accounts].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
  )
}

function accountByCodeMap(accounts: GeneralLedgerAccountRow[]): Map<string, GeneralLedgerAccountRow> {
  const m = new Map<string, GeneralLedgerAccountRow>()
  for (const a of accounts) {
    m.set(a.code.trim(), a)
  }
  return m
}

/**
 * Resolve which account(s) a General Ledger request refers to.
 * Multi modes (precedence): account_codes → account_code_from/to → preset=payroll_liabilities
 * Single mode: account_id or account_code
 */
export async function resolveGeneralLedgerAccountSelection(
  supabase: SupabaseClient,
  businessId: string,
  params: {
    accountId: string | null
    accountCode: string | null
    accountCodeFrom: string | null
    accountCodeTo: string | null
    accountCodes: string | null
    preset: string | null
  }
): Promise<{ result: GeneralLedgerAccountSelectionResult; error?: string }> {
  const rawPreset = params.preset?.trim() || null
  if (rawPreset && rawPreset.toLowerCase() !== "payroll_liabilities") {
    return {
      result: { kind: "multi", accounts: [], truncated: false },
      error: `Unknown preset: ${rawPreset}. Supported: payroll_liabilities`,
    }
  }
  const presetPayroll = rawPreset?.toLowerCase() === "payroll_liabilities"

  const accountCodesRaw = params.accountCodes?.trim() || null
  const from = params.accountCodeFrom?.trim() || null
  const to = params.accountCodeTo?.trim() || null

  if (from && !to) {
    return { result: { kind: "multi", accounts: [], truncated: false }, error: "account_code_to is required when account_code_from is set" }
  }
  if (to && !from) {
    return { result: { kind: "multi", accounts: [], truncated: false }, error: "account_code_from is required when account_code_to is set" }
  }

  const hasCodesList = !!accountCodesRaw
  const hasRange = !!(from && to)
  const wantsMulti = hasCodesList || hasRange || presetPayroll

  if (wantsMulti) {
    const { data: allRows, error } = await supabase
      .from("accounts")
      .select("id, code, name, type")
      .eq("business_id", businessId)
      .is("deleted_at", null)

    if (error) {
      return {
        result: { kind: "multi", accounts: [], truncated: false },
        error: error.message,
      }
    }

    const allAccounts = sortAccountsByCode((allRows || []) as GeneralLedgerAccountRow[])
    let picked: GeneralLedgerAccountRow[] = []

    if (hasCodesList) {
      const wanted = new Set(
        accountCodesRaw!
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
      const byCode = accountByCodeMap(allAccounts)
      for (const code of wanted) {
        const row = byCode.get(code)
        if (row) picked.push(row)
      }
      picked = sortAccountsByCode(picked)
      if (picked.length === 0) {
        return {
          result: {
            kind: "multi",
            accounts: [],
            truncated: false,
            emptyReason: "no_matching_codes",
          },
        }
      }
    } else if (hasRange) {
      let a = from!
      let b = to!
      if (a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) > 0) {
        ;[a, b] = [b, a]
      }
      picked = filterAccountsByCodeRange(allAccounts, a, b)
      if (picked.length === 0) {
        return {
          result: {
            kind: "multi",
            accounts: [],
            truncated: false,
            emptyReason: "no_accounts_in_range",
          },
        }
      }
    } else if (presetPayroll) {
      const byCode = accountByCodeMap(allAccounts)
      for (const code of PAYROLL_LIABILITY_PRESET_CODES) {
        const row = byCode.get(code)
        if (row) picked.push(row)
      }
      if (picked.length === 0) {
        return {
          result: {
            kind: "multi",
            accounts: [],
            truncated: false,
            emptyReason: "no_preset_accounts",
          },
        }
      }
    }

    let truncated = false
    if (picked.length > MAX_GL_MULTI_ACCOUNTS) {
      picked = picked.slice(0, MAX_GL_MULTI_ACCOUNTS)
      truncated = true
    }

    return { result: { kind: "multi", accounts: picked, truncated } }
  }

  const single = await resolveGeneralLedgerAccount(
    supabase,
    businessId,
    params.accountId,
    params.accountCode
  )
  if (single.error || !single.account) {
    return {
      result: { kind: "single", accounts: [], truncated: false },
      error: single.error || "Account not found or does not belong to business",
    }
  }

  return {
    result: {
      kind: "single",
      accounts: [single.account],
      truncated: false,
    },
  }
}
