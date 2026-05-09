import type { SupabaseClient } from "@supabase/supabase-js"
import { addDaysIso, ledgerLineNetEffect } from "@/lib/accounting/ledgerAccountNetEffect"
import type { GeneralLedgerAccountRow } from "@/lib/accounting/resolveGeneralLedgerAccount"

export type GeneralLedgerApiLine = {
  entry_date: string
  account_code: string
  account_name: string
  journal_entry_id: string
  journal_entry_description: string
  reference_type: string | null
  reference_id: string | null
  line_id: string
  line_description: string | null
  debit: number
  credit: number
  running_balance: number
}

export type GeneralLedgerSummary = {
  opening_balance: number
  total_debit: number
  total_credit: number
  net_movement: number
  closing_balance: number
}

export type GeneralLedgerTotals = {
  total_debit: number
  total_credit: number
  final_balance: number
}

type RpcLine = {
  entry_date: string
  journal_entry_id: string
  journal_entry_description: string
  reference_type: string | null
  reference_id: string | null
  line_id: string
  line_description: string | null
  debit: number | string | null
  credit: number | string | null
  running_balance: number | string | null
}

/**
 * Fetches unpaginated general ledger for one account using get_general_ledger (journal_entries.date).
 * Same summary math as GET /api/accounting/reports/general-ledger single-account path.
 */
export async function fetchGeneralLedgerForAccount(
  supabase: SupabaseClient,
  businessId: string,
  account: GeneralLedgerAccountRow,
  effectiveStartDate: string,
  effectiveEndDate: string
): Promise<{
  lines: GeneralLedgerApiLine[]
  summary: GeneralLedgerSummary
  totals: GeneralLedgerTotals
}> {
  const { data: ledgerLines, error: rpcError } = await supabase.rpc("get_general_ledger", {
    p_business_id: businessId,
    p_account_id: account.id,
    p_start_date: effectiveStartDate,
    p_end_date: effectiveEndDate,
  })

  if (rpcError) {
    throw new Error(rpcError.message || "Failed to fetch general ledger")
  }

  const rows = (ledgerLines || []) as RpcLine[]

  const totalDebit = rows.reduce((sum, line) => sum + Number(line.debit || 0), 0)
  const totalCredit = rows.reduce((sum, line) => sum + Number(line.credit || 0), 0)
  const finalBalance =
    rows.length > 0 ? Number(rows[rows.length - 1].running_balance || 0) : null

  let openingBalanceForSummary: number
  if (rows.length > 0) {
    const first = rows[0]
    openingBalanceForSummary =
      Number(first.running_balance || 0) -
      ledgerLineNetEffect(Number(first.debit || 0), Number(first.credit || 0), account.type)
  } else {
    const dayBefore = addDaysIso(effectiveStartDate, -1)
    const { data: priorLines } = await supabase.rpc("get_general_ledger", {
      p_business_id: businessId,
      p_account_id: account.id,
      p_start_date: "1970-01-01",
      p_end_date: dayBefore,
    })
    const prior = (priorLines || []) as RpcLine[]
    openingBalanceForSummary =
      prior.length > 0 ? Number(prior[prior.length - 1].running_balance || 0) : 0
  }

  const closingBalanceForSummary =
    finalBalance !== null ? finalBalance : openingBalanceForSummary

  const summary: GeneralLedgerSummary = {
    opening_balance: Math.round(openingBalanceForSummary * 100) / 100,
    total_debit: Math.round(totalDebit * 100) / 100,
    total_credit: Math.round(totalCredit * 100) / 100,
    net_movement: Math.round((closingBalanceForSummary - openingBalanceForSummary) * 100) / 100,
    closing_balance: Math.round(closingBalanceForSummary * 100) / 100,
  }

  const totals: GeneralLedgerTotals = {
    total_debit: Math.round(totalDebit * 100) / 100,
    total_credit: Math.round(totalCredit * 100) / 100,
    final_balance: Math.round(closingBalanceForSummary * 100) / 100,
  }

  const lines: GeneralLedgerApiLine[] = rows.map((line) => ({
    entry_date: line.entry_date,
    account_code: account.code,
    account_name: account.name,
    journal_entry_id: line.journal_entry_id,
    journal_entry_description: line.journal_entry_description,
    reference_type: line.reference_type,
    reference_id: line.reference_id,
    line_id: line.line_id,
    line_description: line.line_description,
    debit: Number(line.debit || 0),
    credit: Number(line.credit || 0),
    running_balance: Number(line.running_balance || 0),
  }))

  return { lines, summary, totals }
}
