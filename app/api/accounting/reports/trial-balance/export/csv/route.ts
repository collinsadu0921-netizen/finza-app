import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { ensureAccountingInitialized, canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { getTrialBalanceReport } from "@/lib/accounting/reports/getTrialBalanceReport"

/**
 * GET /api/accounting/reports/trial-balance/export/csv
 * Exports Trial Balance as CSV. Period resolved server-side via universal resolver.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date/end_date (optional), include_metadata (optional).
 *
 * Uses the same shared loader as the JSON endpoint, so period, accounts,
 * totals, and balance status always match. Fails loudly (HTTP 500) when
 * the trial balance is unbalanced — never silently exports a broken ledger.
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
    const periodId = searchParams.get("period_id")
    const periodStart = searchParams.get("period_start")
    const asOfDate = searchParams.get("as_of_date")
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
        { error: "Unauthorized. Only admins, owners, or accountants can export trial balance." },
        { status: 403 }
      )
    }

    const tierBlockTbCsv = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlockTbCsv) return tierBlockTbCsv

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, resolvedBusinessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, resolvedBusinessId)
      if (bootstrapErr) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 500 }
        )
      }
      await supabase.rpc("create_system_accounts", { p_business_id: resolvedBusinessId })
    }

    const result = await getTrialBalanceReport(supabase, {
      businessId: resolvedBusinessId,
      period_id: periodId,
      period_start: periodStart,
      as_of_date: asOfDate,
      start_date: startDate,
      end_date: endDate,
    })

    if (result.error || !result.data) {
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch trial balance" },
        { status: result.status ?? 500 }
      )
    }

    const { data } = result

    // INVARIANT 3: Fail loudly if unbalanced - never hide ledger errors in exports.
    if (!data.isBalanced) {
      return NextResponse.json(
        {
          error: "Trial Balance is unbalanced",
          imbalance: data.imbalance,
          totalDebits: data.totals.totalDebits,
          totalCredits: data.totals.totalCredits,
          message:
            "Ledger integrity error: Debits and credits do not match. CSV export blocked until the imbalance is resolved.",
        },
        { status: 500 }
      )
    }

    const rowCount = data.accounts.length
    const hasLargeRowCount = rowCount > 50000

    const csvRows: string[] = []

    if (includeMetadata) {
      csvRows.push("# Report,Trial Balance")
      csvRows.push(`# Period Start,${data.period.period_start}`)
      csvRows.push(`# Period End,${data.period.period_end}`)
      csvRows.push(`# Generated,${new Date().toISOString()}`)
      csvRows.push("# PHASE 10,Canonical Trial Balance snapshot")
      if (hasLargeRowCount) {
        csvRows.push(`# Warning,This export contains ${rowCount} rows, which is large. CSV export allowed.`)
      }
      csvRows.push("# FINZA,Read-only report")
      csvRows.push("")
    }

    csvRows.push(
      "Account Code,Account Name,Account Type,Opening Balance,Debit Total,Credit Total,Closing Balance"
    )

    for (const account of data.accounts) {
      const row = [
        // account_code, account_name, account_type are tenant-controlled text
        // and must be guarded against CSV formula injection (=, +, -, @).
        escapeCsvValue(sanitizeCsvText(account.account_code)),
        escapeCsvValue(sanitizeCsvText(account.account_name)),
        escapeCsvValue(sanitizeCsvText(account.account_type)),
        formatNumeric(account.opening_balance),
        formatNumeric(account.debit_total),
        formatNumeric(account.credit_total),
        formatNumeric(account.closing_balance),
      ]
      csvRows.push(row.join(","))
    }

    const totalDebits = data.totals.totalDebits
    const totalCredits = data.totals.totalCredits
    const isBalanced = data.isBalanced

    if (!includeMetadata) {
      csvRows.push("")
      csvRows.push(`Total Debits,${formatNumeric(totalDebits)}`)
      csvRows.push(`Total Credits,${formatNumeric(totalCredits)}`)
      csvRows.push(`Difference,${formatNumeric(Math.abs(totalDebits - totalCredits))}`)
      csvRows.push(`Is Balanced,${isBalanced ? "Yes" : "No"}`)
    } else {
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Total Debits,${formatNumeric(totalDebits)}`)
      csvRows.push(`# Total Credits,${formatNumeric(totalCredits)}`)
      csvRows.push(`# Difference,${formatNumeric(Math.abs(totalDebits - totalCredits))}`)
      csvRows.push(`# Is Balanced,${isBalanced ? "Yes" : "No"}`)
    }

    const BOM = "\uFEFF"
    const csvContent = BOM + csvRows.join("\n")

    const periodLabel = `period-${data.period.period_start}`
    const filename = `trial-balance-${periodLabel}.csv`

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    console.error("Error exporting trial balance CSV:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * CSV formula-injection guard. Spreadsheet apps treat values starting with
 * "=", "+", "-", or "@" as formulas. Prefix tenant-controlled text fields
 * with a single quote so the cell is rendered as plain text.
 */
function sanitizeCsvText(value: string | null | undefined): string {
  const str = value == null ? "" : String(value)
  if (str.length === 0) return str
  const first = str.charAt(0)
  if (first === "=" || first === "+" || first === "-" || first === "@") {
    return `'${str}`
  }
  return str
}

/**
 * Escape CSV value (handle commas, quotes, newlines).
 */
function escapeCsvValue(value: string | number): string {
  const str = String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Format numeric value for CSV (no currency symbols, 2 decimal places).
 */
function formatNumeric(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "0.00"
  }
  return Number(value).toFixed(2)
}
