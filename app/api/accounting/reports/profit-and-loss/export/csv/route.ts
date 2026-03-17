import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

/**
 * GET /api/accounting/reports/profit-and-loss/export/csv
 * Exports P&L as CSV. Period resolved server-side via universal resolver.
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
        { error: "Unauthorized. Only admins, owners, or accountants can export profit & loss." },
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

    const effectiveStartDate = resolvedPeriod.period_start
    const effectiveEndDate = resolvedPeriod.period_end

    // Validate date range (reject absurd ranges > 10 years)
    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    // Contract v2.0 — Statements sourced from snapshot TB
    const { data: pnlData, error: rpcError } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Error fetching profit & loss:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch profit & loss" },
        { status: 500 }
      )
    }

    // Check row count (for warning, not blocking)
    const rowCount = pnlData?.length || 0
    const hasLargeRowCount = rowCount > 50000

    // Separate income and expense accounts
    const incomeAccounts = (pnlData || []).filter((acc: any) => acc.account_type === "income")
    const expenseAccounts = (pnlData || []).filter((acc: any) => acc.account_type === "expense")

    // Calculate totals
    const totalRevenue = incomeAccounts.reduce((sum: number, acc: any) => sum + Number(acc.period_total || 0), 0)
    const totalExpenses = expenseAccounts.reduce((sum: number, acc: any) => sum + Number(acc.period_total || 0), 0)
    const netProfit = totalRevenue - totalExpenses
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

    // Generate CSV
    const csvRows: string[] = []
    
    // Metadata rows (prefixed with # if include_metadata is true)
    if (includeMetadata) {
      csvRows.push("# Report,Profit & Loss")
      csvRows.push(`# Period Start,${effectiveStartDate}`)
      csvRows.push(`# Period End,${effectiveEndDate}`)
      csvRows.push(`# Generated,${new Date().toISOString()}`)
      if (hasLargeRowCount) {
        csvRows.push(`# Warning,This export contains ${rowCount} rows, which is large. CSV export allowed.`)
      }
      csvRows.push("# FINZA,Read-only report")
      csvRows.push("")
    }
    
    // Header row
    csvRows.push("Account Code,Account Name,Account Type,Period Total")

    // Revenue section
    csvRows.push("")
    if (includeMetadata) {
      csvRows.push("# Section,REVENUE (INCOME)")
    } else {
      csvRows.push("REVENUE (INCOME)")
    }
    if (incomeAccounts.length === 0) {
      csvRows.push(includeMetadata ? "# No revenue accounts with activity in this period" : "No revenue accounts with activity in this period")
    } else {
      for (const account of incomeAccounts) {
        const row = [
          escapeCsvValue(account.account_code || ""),
          escapeCsvValue(account.account_name || ""),
          escapeCsvValue(account.account_type || ""),
          formatNumeric(account.period_total || 0),
        ]
        csvRows.push(row.join(","))
      }
      if (includeMetadata) {
        csvRows.push(`# Total Revenue,${formatNumeric(totalRevenue)}`)
      } else {
        csvRows.push(`Total Revenue,${formatNumeric(totalRevenue)}`)
      }
    }

    // Expenses section
    if (includeMetadata) {
      csvRows.push("")
      csvRows.push("# Section,EXPENSES")
    } else {
      csvRows.push("")
      csvRows.push("EXPENSES")
    }
    if (expenseAccounts.length === 0) {
      csvRows.push(includeMetadata ? "# No expense accounts with activity in this period" : "No expense accounts with activity in this period")
    } else {
      for (const account of expenseAccounts) {
        const row = [
          escapeCsvValue(account.account_code || ""),
          escapeCsvValue(account.account_name || ""),
          escapeCsvValue(account.account_type || ""),
          formatNumeric(account.period_total || 0),
        ]
        csvRows.push(row.join(","))
      }
      if (includeMetadata) {
        csvRows.push(`# Total Expenses,${formatNumeric(totalExpenses)}`)
      } else {
        csvRows.push(`Total Expenses,${formatNumeric(totalExpenses)}`)
      }
    }

    // Summary
    if (includeMetadata) {
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Total Revenue,${formatNumeric(totalRevenue)}`)
      csvRows.push(`# Total Expenses,${formatNumeric(totalExpenses)}`)
      csvRows.push(`# Net Profit / Loss,${formatNumeric(netProfit)}`)
      csvRows.push(`# Profit Margin (%),${formatNumeric(profitMargin)}`)
    } else {
      csvRows.push("")
      csvRows.push("SUMMARY")
      csvRows.push(`Total Revenue,${formatNumeric(totalRevenue)}`)
      csvRows.push(`Total Expenses,${formatNumeric(totalExpenses)}`)
      csvRows.push(`Net Profit / Loss,${formatNumeric(netProfit)}`)
      csvRows.push(`Profit Margin (%),${formatNumeric(profitMargin)}`)
    }

    // Create CSV content with UTF-8 BOM for Excel compatibility
    const BOM = "\uFEFF"
    const csvContent = BOM + csvRows.join("\n")

    // Generate filename
    const periodLabel = periodStart 
      ? `period-${periodStart}` 
      : `${effectiveStartDate}-to-${effectiveEndDate}`
    const filename = `profit-and-loss-${periodLabel}.csv`

    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting profit & loss CSV:", error)
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
