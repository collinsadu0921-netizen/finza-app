import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"
import {
  parseBalanceSheetReportQuery,
  toBalanceSheetExportView,
} from "@/lib/accounting/reports/balanceSheetExportHelpers"

/**
 * GET /api/accounting/reports/balance-sheet/export/csv
 * 
 * Exports Balance Sheet as CSV.
 * Canonical source: getBalanceSheetReport (ledger as-of + cumulative net income)
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
    const periodStart = searchParams.get("period_start")
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
        { error: "Unauthorized. Only admins, owners, or accountants can export balance sheet." },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, resolvedBusinessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      await supabase.rpc("create_system_accounts", { p_business_id: resolvedBusinessId })
    }

    const { data: reportData, error: reportError } = await getBalanceSheetReport(
      supabase,
      parseBalanceSheetReportQuery(resolvedBusinessId, searchParams)
    )
    if (reportError || !reportData) {
      return NextResponse.json(
        { error: reportError || "Failed to fetch balance sheet" },
        { status: 500 }
      )
    }

    const view = toBalanceSheetExportView(reportData)
    const {
      asOfDate,
      assetLines: assets,
      liabilityLines: liabilities,
      equityLines: equity,
      totals,
      cumulativeNetIncome: currentPeriodNetIncome,
      rowCount,
    } = view

    const hasLargeRowCount = rowCount > 50000
    const totalAssets = totals.assets
    const totalLiabilities = totals.liabilities
    const adjustedEquity = view.adjustedEquity
    const totalLiabilitiesAndEquity = totals.liabilities_plus_equity
    const balancingDifference = totals.imbalance
    const isBalanced = totals.is_balanced

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
          formatNumeric(account.amount),
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
          formatNumeric(account.amount),
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
      csvRows.push(`# Section,${view.equitySectionLabel.toUpperCase()}`)
    } else {
      csvRows.push("")
      csvRows.push(view.equitySectionLabel.toUpperCase())
    }
    if (equity.length === 0) {
      csvRows.push(includeMetadata ? "# No equity accounts with balances" : "No equity accounts with balances")
    } else {
      for (const account of equity) {
        const row = [
          escapeCsvValue(account.account_code || ""),
          escapeCsvValue(account.account_name || ""),
          escapeCsvValue(account.account_type || ""),
          formatNumeric(account.amount),
        ]
        csvRows.push(row.join(","))
      }
      if (includeMetadata) {
        csvRows.push(`# Total ${view.equitySectionLabel},${formatNumeric(adjustedEquity)}`)
      } else {
        csvRows.push(`Total ${view.equitySectionLabel},${formatNumeric(adjustedEquity)}`)
      }
    }

    // Summary
    if (includeMetadata) {
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Total Assets,${formatNumeric(totalAssets)}`)
      csvRows.push(`# Total Liabilities,${formatNumeric(totalLiabilities)}`)
      if (currentPeriodNetIncome !== 0) {
        csvRows.push(`# Cumulative Net Income,${formatNumeric(currentPeriodNetIncome)}`)
      }
      csvRows.push(`# Total ${view.equitySectionLabel},${formatNumeric(adjustedEquity)}`)
      csvRows.push(`# Total Liabilities + Equity,${formatNumeric(totalLiabilitiesAndEquity)}`)
      csvRows.push(`# Balancing Difference,${formatNumeric(balancingDifference)}`)
      csvRows.push(`# Is Balanced,${isBalanced ? "Yes" : "No"}`)
    } else {
      csvRows.push("")
      csvRows.push("SUMMARY")
      csvRows.push(`Total Assets,${formatNumeric(totalAssets)}`)
      csvRows.push(`Total Liabilities,${formatNumeric(totalLiabilities)}`)
      if (currentPeriodNetIncome !== 0) {
        csvRows.push(`Cumulative Net Income,${formatNumeric(currentPeriodNetIncome)}`)
      }
      csvRows.push(`Total ${view.equitySectionLabel},${formatNumeric(adjustedEquity)}`)
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
