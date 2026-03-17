import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

/**
 * GET /api/accounting/reports/trial-balance/export/csv
 * Exports Trial Balance as CSV. Period resolved server-side via universal resolver.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date/end_date (optional), include_metadata (optional).
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
    const businessId = searchParams.get("business_id")
    const periodId = searchParams.get("period_id")
    const periodStart = searchParams.get("period_start")
    const asOfDate = searchParams.get("as_of_date")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const includeMetadata = searchParams.get("include_metadata") !== "0"

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      businessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can export trial balance." },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, businessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: businessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      await supabase.rpc("create_system_accounts", { p_business_id: businessId })
    }

    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      { businessId, period_id: periodId, period_start: periodStart, as_of_date: asOfDate, start_date: startDate, end_date: endDate }
    )
    if (resolveError || !resolvedPeriod) {
      return NextResponse.json(
        { error: resolveError ?? "Accounting period could not be resolved" },
        { status: 500 }
      )
    }

    const { data: trialBalance, error: rpcError } = await supabase.rpc("get_trial_balance_from_snapshot", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Error fetching trial balance:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch trial balance" },
        { status: 500 }
      )
    }

    // Check row count (for warning, not blocking)
    const rowCount = trialBalance?.length || 0
    const hasLargeRowCount = rowCount > 50000

    // Generate CSV
    const csvRows: string[] = []
    
    // Metadata rows (prefixed with # if include_metadata is true)
    if (includeMetadata) {
      csvRows.push("# Report,Trial Balance")
      csvRows.push(`# Period Start,${resolvedPeriod.period_start}`)
      csvRows.push(`# Period End,${resolvedPeriod.period_end}`)
      csvRows.push(`# Generated,${new Date().toISOString()}`)
      csvRows.push("# PHASE 10,Canonical Trial Balance snapshot")
      if (hasLargeRowCount) {
        csvRows.push(`# Warning,This export contains ${rowCount} rows, which is large. CSV export allowed.`)
      }
      csvRows.push("# FINZA,Read-only report")
      csvRows.push("")
    }
    
    // PHASE 10: Header row (includes opening_balance and closing_balance from canonical snapshot)
    csvRows.push("Account Code,Account Name,Account Type,Opening Balance,Debit Total,Credit Total,Closing Balance")

    // Data rows
    if (trialBalance && trialBalance.length > 0) {
      for (const account of trialBalance) {
        const row = [
          escapeCsvValue(account.account_code || ""),
          escapeCsvValue(account.account_name || ""),
          escapeCsvValue(account.account_type || ""),
          formatNumeric(account.opening_balance || 0), // PHASE 10: From canonical snapshot
          formatNumeric(account.debit_total || 0),
          formatNumeric(account.credit_total || 0),
          formatNumeric(account.closing_balance || 0), // PHASE 10: From canonical snapshot
        ]
        csvRows.push(row.join(","))
      }
    }

    // Calculate totals
    const totalDebits = trialBalance?.reduce((sum: number, acc: any) => sum + Number(acc.debit_total || 0), 0) || 0
    const totalCredits = trialBalance?.reduce((sum: number, acc: any) => sum + Number(acc.credit_total || 0), 0) || 0
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01

    // Totals rows (include in data section if include_metadata is false, otherwise add to metadata)
    if (!includeMetadata) {
      // When metadata is excluded, totals are part of the data section
      csvRows.push("")
      csvRows.push(`Total Debits,${formatNumeric(totalDebits)}`)
      csvRows.push(`Total Credits,${formatNumeric(totalCredits)}`)
      csvRows.push(`Difference,${formatNumeric(Math.abs(totalDebits - totalCredits))}`)
      csvRows.push(`Is Balanced,${isBalanced ? "Yes" : "No"}`)
    } else {
      // When metadata is included, totals are added after data but can be in summary section
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Total Debits,${formatNumeric(totalDebits)}`)
      csvRows.push(`# Total Credits,${formatNumeric(totalCredits)}`)
      csvRows.push(`# Difference,${formatNumeric(Math.abs(totalDebits - totalCredits))}`)
      csvRows.push(`# Is Balanced,${isBalanced ? "Yes" : "No"}`)
    }

    // Create CSV content with UTF-8 BOM for Excel compatibility
    const BOM = "\uFEFF"
    const csvContent = BOM + csvRows.join("\n")

    // Generate filename
    const periodLabel = `period-${resolvedPeriod.period_start}`
    const filename = `trial-balance-${periodLabel}.csv`

    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
 * Escape CSV value (handle commas, quotes, newlines)
 */
function escapeCsvValue(value: string | number): string {
  const str = String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Format numeric value for CSV (no currency symbols, 2 decimal places)
 */
function formatNumeric(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "0.00"
  }
  return Number(value).toFixed(2)
}
