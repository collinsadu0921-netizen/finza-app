import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

/**
 * GET /api/accounting/reports/balance-sheet/export/csv
 * 
 * Exports Balance Sheet as CSV.
 * Contract v2.0 — Statements sourced from snapshot TB
 * 
 * Query Parameters:
 * - business_id (required)
 * - period_id | period_start | as_of_date (optional; as_of_date defaults to today)
 * - period_start (optional) - if provided with as_of_date, net income uses resolved period
 * - include_metadata (optional, default 1) - if 0, export only header + data rows (no metadata)
 * 
 * CSV Format:
 * - Account Code, Account Name, Account Type, Balance
 * - Assets section, then Liabilities, then Equity
 * - Totals at end
 * - UTF-8 encoding
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
    const rangeStart = searchParams.get("start_date")
    const rangeEnd = searchParams.get("end_date")
    const hasCustomRange =
      !!(rangeStart?.trim() && rangeEnd?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(rangeStart.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd.trim()))
    const asOfDateRaw = searchParams.get("as_of_date")
    const asOfDate =
      hasCustomRange
        ? null
        : asOfDateRaw?.trim() ||
          (periodStart?.trim() ? null : new Date().toISOString().split("T")[0])
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
        { error: "Unauthorized. Only admins, owners, or accountants can export balance sheet." },
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
      {
        businessId,
        period_id: periodId,
        period_start: periodStart,
        as_of_date: asOfDate,
        start_date: hasCustomRange ? rangeStart!.trim() : null,
        end_date: hasCustomRange ? rangeEnd!.trim() : null,
      }
    )
    if (resolveError || !resolvedPeriod) {
      return NextResponse.json(
        { error: resolveError ?? "Accounting period could not be resolved. Provide period_id, period_start, or as_of_date." },
        { status: 500 }
      )
    }

    // Contract v2.0 — Statements sourced from snapshot TB
    const { data: balanceSheetData, error: rpcError } = await supabase.rpc("get_balance_sheet_from_trial_balance", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Error fetching balance sheet:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch balance sheet" },
        { status: 500 }
      )
    }

    // Check row count (for warning, not blocking)
    const rowCount = balanceSheetData?.length || 0
    const hasLargeRowCount = rowCount > 50000

    // Separate by type
    type BalanceRow = { account_type?: string; balance?: number | null; period_total?: number | null }
    const assets = (balanceSheetData || []).filter((acc: BalanceRow) => acc.account_type === "asset")
    const liabilities = (balanceSheetData || []).filter((acc: BalanceRow) => acc.account_type === "liability")
    const equity = (balanceSheetData || []).filter((acc: BalanceRow) => acc.account_type === "equity")

    // Calculate totals
    const totalAssets = assets.reduce((sum: number, acc: BalanceRow) => sum + Number(acc.balance || 0), 0)
    const totalLiabilities = liabilities.reduce((sum: number, acc: BalanceRow) => sum + Number(acc.balance || 0), 0)
    const totalEquity = equity.reduce((sum: number, acc: BalanceRow) => sum + Number(acc.balance || 0), 0)

    // Calculate current period net income when period_start (or period) provided (Contract v2.0 — snapshot P&L)
    let currentPeriodNetIncome = 0
    if (periodStart || periodId) {
      const { data: pnlData } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
        p_period_id: resolvedPeriod.period_id,
      })
      if (pnlData && pnlData.length > 0) {
        const incomeTotal = (pnlData || [])
          .filter((acc: BalanceRow) => acc.account_type === "income")
          .reduce((sum: number, acc: BalanceRow) => sum + Number(acc.period_total || 0), 0)
        const expenseTotal = (pnlData || [])
          .filter((acc: BalanceRow) => acc.account_type === "expense")
          .reduce((sum: number, acc: BalanceRow) => sum + Number(acc.period_total || 0), 0)
        currentPeriodNetIncome = incomeTotal - expenseTotal
      }
    }

    const adjustedEquity = totalEquity + currentPeriodNetIncome
    const totalLiabilitiesAndEquity = totalLiabilities + adjustedEquity
    const balancingDifference = totalAssets - totalLiabilitiesAndEquity
    const isBalanced = Math.abs(balancingDifference) < 0.01

    // Generate CSV
    const csvRows: string[] = []

    // Metadata rows (prefixed with # if include_metadata is true)
    if (includeMetadata) {
      csvRows.push("# Report,Balance Sheet")
      csvRows.push(`# As Of Date,${asOfDate}`)
      if (periodStart) {
        csvRows.push(`# Net Income Period,${periodStart}`)
      }
      csvRows.push(`# Generated,${new Date().toISOString()}`)
      if (hasLargeRowCount) {
        csvRows.push(`# Warning,This export contains ${rowCount} rows, which is large. CSV export allowed.`)
      }
      csvRows.push("# FINZA,Read-only report")
      csvRows.push("")
    }
    
    // Header row
    csvRows.push("Account Code,Account Name,Account Type,Balance")

    // Assets section
    if (includeMetadata) {
      csvRows.push("# Section,ASSETS")
    } else {
      csvRows.push("")
      csvRows.push("ASSETS")
    }
    if (assets.length === 0) {
      csvRows.push(includeMetadata ? "# No asset accounts with balances" : "No asset accounts with balances")
    } else {
      for (const account of assets) {
        const row = [
          escapeCsvValue(account.account_code || ""),
          escapeCsvValue(account.account_name || ""),
          escapeCsvValue(account.account_type || ""),
          formatNumeric(account.balance || 0),
        ]
        csvRows.push(row.join(","))
      }
      if (includeMetadata) {
        csvRows.push(`# Total Assets,${formatNumeric(totalAssets)}`)
      } else {
        csvRows.push(`Total Assets,${formatNumeric(totalAssets)}`)
      }
    }

    // Liabilities section
    if (includeMetadata) {
      csvRows.push("")
      csvRows.push("# Section,LIABILITIES")
    } else {
      csvRows.push("")
      csvRows.push("LIABILITIES")
    }
    if (liabilities.length === 0) {
      csvRows.push(includeMetadata ? "# No liability accounts with balances" : "No liability accounts with balances")
    } else {
      for (const account of liabilities) {
        const row = [
          escapeCsvValue(account.account_code || ""),
          escapeCsvValue(account.account_name || ""),
          escapeCsvValue(account.account_type || ""),
          formatNumeric(account.balance || 0),
        ]
        csvRows.push(row.join(","))
      }
      if (includeMetadata) {
        csvRows.push(`# Total Liabilities,${formatNumeric(totalLiabilities)}`)
      } else {
        csvRows.push(`Total Liabilities,${formatNumeric(totalLiabilities)}`)
      }
    }

    // Equity section
    if (includeMetadata) {
      csvRows.push("")
      csvRows.push("# Section,EQUITY")
    } else {
      csvRows.push("")
      csvRows.push("EQUITY")
    }
    if (equity.length === 0) {
      csvRows.push(includeMetadata ? "# No equity accounts with balances" : "No equity accounts with balances")
    } else {
      for (const account of equity) {
        const row = [
          escapeCsvValue(account.account_code || ""),
          escapeCsvValue(account.account_name || ""),
          escapeCsvValue(account.account_type || ""),
          formatNumeric(account.balance || 0),
        ]
        csvRows.push(row.join(","))
      }
      if (includeMetadata) {
        csvRows.push(`# Total Equity,${formatNumeric(totalEquity)}`)
      } else {
        csvRows.push(`Total Equity,${formatNumeric(totalEquity)}`)
      }
    }

    // Summary
    if (includeMetadata) {
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Total Assets,${formatNumeric(totalAssets)}`)
      csvRows.push(`# Total Liabilities,${formatNumeric(totalLiabilities)}`)
      if (periodStart && currentPeriodNetIncome !== 0) {
        csvRows.push(`# Current Period Net Income,${formatNumeric(currentPeriodNetIncome)}`)
        csvRows.push(`# Adjusted Total Equity,${formatNumeric(adjustedEquity)}`)
      } else {
        csvRows.push(`# Total Equity,${formatNumeric(totalEquity)}`)
      }
      csvRows.push(`# Total Liabilities + Equity,${formatNumeric(totalLiabilitiesAndEquity)}`)
      csvRows.push(`# Balancing Difference,${formatNumeric(balancingDifference)}`)
      csvRows.push(`# Is Balanced,${isBalanced ? "Yes" : "No"}`)
    } else {
      csvRows.push("")
      csvRows.push("SUMMARY")
      csvRows.push(`Total Assets,${formatNumeric(totalAssets)}`)
      csvRows.push(`Total Liabilities,${formatNumeric(totalLiabilities)}`)
      if (periodStart && currentPeriodNetIncome !== 0) {
        csvRows.push(`Current Period Net Income,${formatNumeric(currentPeriodNetIncome)}`)
        csvRows.push(`Adjusted Total Equity,${formatNumeric(adjustedEquity)}`)
      } else {
        csvRows.push(`Total Equity,${formatNumeric(totalEquity)}`)
      }
      csvRows.push(`Total Liabilities + Equity,${formatNumeric(totalLiabilitiesAndEquity)}`)
      csvRows.push(`Balancing Difference,${formatNumeric(balancingDifference)}`)
      csvRows.push(`Is Balanced,${isBalanced ? "Yes" : "No"}`)
    }

    // Create CSV content with UTF-8 BOM for Excel compatibility
    const BOM = "\uFEFF"
    const csvContent = BOM + csvRows.join("\n")

    // Generate filename
    const filename = `balance-sheet-as-of-${asOfDate}.csv`

    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting balance sheet CSV:", error)
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
