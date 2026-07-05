import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { fetchGeneralLedgerForAccount } from "@/lib/accounting/fetchGeneralLedgerForAccount"
import {
  resolveGeneralLedgerAccountSelection,
} from "@/lib/accounting/resolveGeneralLedgerAccountSelection"
import type { GeneralLedgerAccountRow } from "@/lib/accounting/resolveGeneralLedgerAccount"

/**
 * GET /api/accounting/reports/general-ledger/export/csv
 *
 * Exports General Ledger as CSV (ledger-only, get_general_ledger / same math as on-screen report).
 *
 * Single-account: business_id + account_id or account_code; period_start or start_date+end_date.
 * Multi-account: business_id + one of preset=payroll_liabilities | account_codes= | account_code_from + account_code_to.
 *
 * Columns include Account Code and Account Name on every data row.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get("account_id")
    const accountCodeParam = searchParams.get("account_code")
    const accountCodeFrom = searchParams.get("account_code_from")
    const accountCodeTo = searchParams.get("account_code_to")
    const accountCodes = searchParams.get("account_codes")
    const preset = searchParams.get("preset")
    const periodStart = searchParams.get("period_start")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const includeMetadata = searchParams.get("include_metadata") !== "0"

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      resolvedBusinessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can export general ledger." },
        { status: 403 }
      )
    }

    const tierBlock = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlock) return tierBlock

    const periodResolved = await resolveGlExportPeriod(supabase, resolvedBusinessId, periodStart, startDate, endDate)
    if ("error" in periodResolved) {
      return NextResponse.json({ error: periodResolved.error }, { status: periodResolved.status })
    }
    const { effectiveStartDate, effectiveEndDate } = periodResolved

    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    const { result: selection, error: selectionError } = await resolveGeneralLedgerAccountSelection(
      supabase,
      resolvedBusinessId,
      {
        accountId,
        accountCode: accountCodeParam,
        accountCodeFrom,
        accountCodeTo,
        accountCodes,
        preset,
      }
    )

    if (selectionError) {
      const isMissing = selectionError.includes("Missing")
      const notFound =
        selectionError.includes("not found") ||
        selectionError.includes("does not belong") ||
        selectionError.includes("Multiple accounts match")
      return NextResponse.json(
        { error: selectionError },
        { status: isMissing ? 400 : notFound ? 404 : 400 }
      )
    }

    if (selection.kind === "multi") {
      return await buildMultiAccountCsvResponse({
        supabase,
        businessId: resolvedBusinessId,
        accounts: selection.accounts,
        truncated: selection.truncated,
        emptyReason: selection.emptyReason,
        effectiveStartDate,
        effectiveEndDate,
        periodStart,
        includeMetadata,
      })
    }

    const account = selection.accounts[0]
    let block: Awaited<ReturnType<typeof fetchGeneralLedgerForAccount>>
    try {
      block = await fetchGeneralLedgerForAccount(
        supabase,
        resolvedBusinessId,
        account,
        effectiveStartDate,
        effectiveEndDate
      )
    } catch (e: unknown) {
      console.error("Error fetching general ledger:", e)
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to fetch general ledger" },
        { status: 500 }
      )
    }

    const ledgerLines = block.lines
    const rowCount = ledgerLines.length
    const hasLargeRowCount = rowCount > 50000
    const openingBalance = block.summary.opening_balance
    const totalDebit = block.summary.total_debit
    const totalCredit = block.summary.total_credit
    const finalBalance = block.totals.final_balance

    const csvRows: string[] = []

    if (includeMetadata) {
      csvRows.push("# Report,General Ledger")
      csvRows.push(`# Account,${account.code} - ${account.name}`)
      csvRows.push(`# Period Start,${effectiveStartDate}`)
      csvRows.push(`# Period End,${effectiveEndDate}`)
      csvRows.push(`# Opening Balance,${formatNumeric(openingBalance)}`)
      csvRows.push(`# Generated,${new Date().toISOString()}`)
      if (hasLargeRowCount) {
        csvRows.push(`# Warning,This export contains ${rowCount} rows, which is large. CSV export allowed.`)
      }
      csvRows.push("# FINZA,Read-only report")
      csvRows.push("")
    }

    csvRows.push(
      "Entry Date,Account Code,Account Name,Journal Entry ID,Description,Reference Type,Reference ID,Line ID,Line Description,Debit,Credit,Running Balance"
    )

    for (const line of ledgerLines) {
      csvRows.push(
        [
          line.entry_date || "",
          escapeCsvValue(line.account_code || ""),
          escapeCsvValue(line.account_name || ""),
          line.journal_entry_id || "",
          escapeCsvValue(line.journal_entry_description || line.line_description || ""),
          escapeCsvValue(line.reference_type || ""),
          line.reference_id || "",
          line.line_id || "",
          escapeCsvValue(line.line_description || ""),
          formatNumeric(line.debit || 0),
          formatNumeric(line.credit || 0),
          formatNumeric(line.running_balance || 0),
        ].join(",")
      )
    }

    if (!includeMetadata) {
      csvRows.push("")
      csvRows.push(`Opening Balance,${formatNumeric(openingBalance)}`)
      csvRows.push(`Total Debit,${formatNumeric(totalDebit)}`)
      csvRows.push(`Total Credit,${formatNumeric(totalCredit)}`)
      csvRows.push(`Net Movement,${formatNumeric(finalBalance - openingBalance)}`)
      csvRows.push(`Final Balance,${formatNumeric(finalBalance)}`)
    } else {
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Opening Balance,${formatNumeric(openingBalance)}`)
      csvRows.push(`# Total Debit,${formatNumeric(totalDebit)}`)
      csvRows.push(`# Total Credit,${formatNumeric(totalCredit)}`)
      csvRows.push(`# Net Movement,${formatNumeric(finalBalance - openingBalance)}`)
      csvRows.push(`# Final Balance,${formatNumeric(finalBalance)}`)
    }

    const BOM = "\uFEFF"
    const csvContent = BOM + csvRows.join("\n")
    const periodLabel = periodStart ? `period-${periodStart}` : `${effectiveStartDate}-to-${effectiveEndDate}`
    const filename = `general-ledger-${account.code}-${periodLabel}.csv`

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting general ledger CSV:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

async function resolveGlExportPeriod(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  periodStart: string | null,
  startDate: string | null,
  endDate: string | null
): Promise<
  | { effectiveStartDate: string; effectiveEndDate: string }
  | { error: string; status: number }
> {
  if (periodStart) {
    let { data: period, error: periodError } = await supabase
      .from("accounting_periods")
      .select("period_start, period_end")
      .eq("business_id", businessId)
      .eq("period_start", periodStart)
      .single()

    if (periodError || !period) {
      const periodDate = periodStart.length === 7 ? `${periodStart}-01` : periodStart
      const { error: ensureError } = await supabase.rpc("ensure_accounting_period", {
        p_business_id: businessId,
        p_date: periodDate,
      })
      if (ensureError) {
        console.error("ensure_accounting_period failed:", ensureError)
        return { error: "Accounting period could not be resolved", status: 500 }
      }
      const refetch = await supabase
        .from("accounting_periods")
        .select("period_start, period_end")
        .eq("business_id", businessId)
        .eq("period_start", periodDate)
        .single()
      if (refetch.error || !refetch.data) {
        return { error: "Accounting period could not be resolved", status: 500 }
      }
      period = refetch.data
    }

    return { effectiveStartDate: period.period_start, effectiveEndDate: period.period_end }
  }

  if (startDate && endDate) {
    return { effectiveStartDate: startDate, effectiveEndDate: endDate }
  }

  return {
    error: "Either period_start or both start_date and end_date must be provided",
    status: 400,
  }
}

async function buildMultiAccountCsvResponse(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  businessId: string
  accounts: GeneralLedgerAccountRow[]
  truncated: boolean
  emptyReason?: string
  effectiveStartDate: string
  effectiveEndDate: string
  periodStart: string | null
  includeMetadata: boolean
}): Promise<NextResponse> {
  const {
    supabase,
    businessId,
    accounts,
    truncated,
    emptyReason,
    effectiveStartDate,
    effectiveEndDate,
    periodStart,
    includeMetadata,
  } = params

  const accountList = accounts

  const csvRows: string[] = []
  if (includeMetadata) {
    csvRows.push("# Report,General Ledger (multi-account)")
    csvRows.push(`# Period Start,${effectiveStartDate}`)
    csvRows.push(`# Period End,${effectiveEndDate}`)
    csvRows.push(`# Account count,${accountList.length}`)
    if (truncated) {
      csvRows.push("# Warning,Export truncated to max account limit; narrow range or use account_codes.")
    }
    if (emptyReason) {
      csvRows.push(`# Note,${emptyReason}`)
    }
    csvRows.push(`# Generated,${new Date().toISOString()}`)
    csvRows.push("# FINZA,Read-only report")
    csvRows.push("")
  }

  const header =
    "Entry Date,Account Code,Account Name,Journal Entry ID,Description,Reference Type,Reference ID,Line ID,Line Description,Debit,Credit,Running Balance"

  if (accountList.length === 0) {
    csvRows.push(header)
    csvRows.push("")
    csvRows.push("# No accounts matched this selection for your chart of accounts.")
    const BOM = "\uFEFF"
    const periodLabel = periodStart ? `period-${periodStart}` : `${effectiveStartDate}-to-${effectiveEndDate}`
    const filename = `general-ledger-multi-${periodLabel}.csv`
    return new NextResponse(BOM + csvRows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  }

  let totalRows = 0
  const blocks: Awaited<ReturnType<typeof fetchGeneralLedgerForAccount>>[] = []
  for (const account of accountList) {
    try {
      const block = await fetchGeneralLedgerForAccount(
        supabase,
        businessId,
        account,
        effectiveStartDate,
        effectiveEndDate
      )
      blocks.push(block)
      totalRows += block.lines.length
    } catch (e: unknown) {
      console.error("Error fetching general ledger for CSV:", e)
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to fetch general ledger" },
        { status: 500 }
      )
    }
  }

  const hasLargeRowCount = totalRows > 50000
  if (includeMetadata && hasLargeRowCount) {
    csvRows.push(`# Warning,This export contains ${totalRows} rows across accounts. CSV export allowed.`)
    csvRows.push("")
  }

  for (let i = 0; i < accountList.length; i++) {
    const account = accountList[i]
    const block = blocks[i]
    if (includeMetadata) {
      csvRows.push(`# --- Account: ${account.code} - ${account.name} ---`)
      csvRows.push(`# Opening Balance,${formatNumeric(block.summary.opening_balance)}`)
      csvRows.push("")
    }
    csvRows.push(header)
    for (const line of block.lines) {
      csvRows.push(
        [
          line.entry_date || "",
          escapeCsvValue(line.account_code || ""),
          escapeCsvValue(line.account_name || ""),
          line.journal_entry_id || "",
          escapeCsvValue(line.journal_entry_description || line.line_description || ""),
          escapeCsvValue(line.reference_type || ""),
          line.reference_id || "",
          line.line_id || "",
          escapeCsvValue(line.line_description || ""),
          formatNumeric(line.debit || 0),
          formatNumeric(line.credit || 0),
          formatNumeric(line.running_balance || 0),
        ].join(",")
      )
    }
    if (includeMetadata) {
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Opening Balance,${formatNumeric(block.summary.opening_balance)}`)
      csvRows.push(`# Total Debit,${formatNumeric(block.summary.total_debit)}`)
      csvRows.push(`# Total Credit,${formatNumeric(block.summary.total_credit)}`)
      csvRows.push(`# Net Movement,${formatNumeric(block.summary.net_movement)}`)
      csvRows.push(`# Closing Balance,${formatNumeric(block.summary.closing_balance)}`)
      csvRows.push("")
    } else {
      csvRows.push("")
      csvRows.push(`Opening Balance,${formatNumeric(block.summary.opening_balance)}`)
      csvRows.push(`Total Debit,${formatNumeric(block.summary.total_debit)}`)
      csvRows.push(`Total Credit,${formatNumeric(block.summary.total_credit)}`)
      csvRows.push(`Net Movement,${formatNumeric(block.summary.net_movement)}`)
      csvRows.push(`Closing Balance,${formatNumeric(block.summary.closing_balance)}`)
      csvRows.push("")
    }
  }

  const BOM = "\uFEFF"
  const periodLabel = periodStart ? `period-${periodStart}` : `${effectiveStartDate}-to-${effectiveEndDate}`
  const filename = `general-ledger-multi-${periodLabel}.csv`

  return new NextResponse(BOM + csvRows.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}

function escapeCsvValue(value: string | number): string {
  const str = String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatNumeric(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "0.00"
  }
  return Number(value).toFixed(2)
}
