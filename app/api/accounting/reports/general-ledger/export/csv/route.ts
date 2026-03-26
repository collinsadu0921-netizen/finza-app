import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/reports/general-ledger/export/csv
 * 
 * Exports General Ledger as CSV
 * Ledger-only: Uses same get_general_ledger() function as on-screen report
 * 
 * Query Parameters:
 * - business_id (required)
 * - account_id (required)
 * - period_start (optional) - if provided, use period_start/period_end from accounting_periods
 * - start_date (optional) - if period_start not provided, use date range
 * - end_date (optional) - if period_start not provided, use date range
 * - include_metadata (optional, default 1) - if 0, export only header + data rows (no metadata)
 * 
 * Access: Admin/Owner/Accountant (read or write)
 * 
 * CSV Format:
 * - Entry Date, Journal Entry ID, Description, Reference Type, Reference ID, Line ID, Line Description, Debit, Credit, Running Balance
 * - No currency symbols
 * - UTF-8 encoding
 * 
 * Note: Uses unpaginated get_general_ledger() function to export complete dataset.
 * For large datasets (>50k rows), a warning is included in metadata but export is allowed.
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
    const accountId = searchParams.get("account_id")
    const periodStart = searchParams.get("period_start")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const includeMetadata = searchParams.get("include_metadata") !== "0" // Default true (1)

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

    if (!accountId) {
      return NextResponse.json(
        { error: "Missing required parameter: account_id" },
        { status: 400 }
      )
    }

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

    // Verify account exists and belongs to business
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, code, name, type")
      .eq("id", accountId)
      .eq("business_id", resolvedBusinessId)
      .is("deleted_at", null)
      .single()

    if (accountError || !account) {
      return NextResponse.json(
        { error: "Account not found or does not belong to business" },
        { status: 404 }
      )
    }

    // Determine date range: either from period or direct date range
    let effectiveStartDate: string
    let effectiveEndDate: string

    if (periodStart) {
      let { data: period, error: periodError } = await supabase
        .from("accounting_periods")
        .select("period_start, period_end")
        .eq("business_id", resolvedBusinessId)
        .eq("period_start", periodStart)
        .single()

      if (periodError || !period) {
        const periodDate = periodStart.length === 7 ? `${periodStart}-01` : periodStart
        const { error: ensureError } = await supabase.rpc("ensure_accounting_period", {
          p_business_id: resolvedBusinessId,
          p_date: periodDate,
        })
        if (ensureError) {
          console.error("ensure_accounting_period failed:", ensureError)
          return NextResponse.json({ error: "Accounting period could not be resolved" }, { status: 500 })
        }
        const refetch = await supabase
          .from("accounting_periods")
          .select("period_start, period_end")
          .eq("business_id", resolvedBusinessId)
          .eq("period_start", periodDate)
          .single()
        if (refetch.error || !refetch.data) {
          return NextResponse.json({ error: "Accounting period could not be resolved" }, { status: 500 })
        }
        period = refetch.data
      }

      effectiveStartDate = period.period_start
      effectiveEndDate = period.period_end
    } else if (startDate && endDate) {
      effectiveStartDate = startDate
      effectiveEndDate = endDate
    } else {
      return NextResponse.json(
        { error: "Either period_start or both start_date and end_date must be provided" },
        { status: 400 }
      )
    }

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

    // Use same function as on-screen report (non-paginated for export)
    const { data: ledgerLines, error: rpcError } = await supabase.rpc("get_general_ledger", {
      p_business_id: resolvedBusinessId,
      p_account_id: accountId,
      p_start_date: effectiveStartDate,
      p_end_date: effectiveEndDate,
    })

    if (rpcError) {
      console.error("Error fetching general ledger:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch general ledger" },
        { status: 500 }
      )
    }

    // Check row count (for warning, not blocking)
    // Note: get_general_ledger() is unpaginated, so it returns all rows for the date range
    const rowCount = ledgerLines?.length || 0
    const hasLargeRowCount = rowCount > 50000

    // Generate CSV
    const csvRows: string[] = []
    
    // Metadata rows (prefixed with # if include_metadata is true)
    if (includeMetadata) {
      csvRows.push("# Report,General Ledger")
      csvRows.push(`# Account,${account.code} - ${account.name}`)
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
    csvRows.push("Entry Date,Journal Entry ID,Description,Reference Type,Reference ID,Line ID,Line Description,Debit,Credit,Running Balance")

    // Data rows
    if (ledgerLines && ledgerLines.length > 0) {
      for (const line of ledgerLines) {
        const row = [
          line.entry_date || "",
          line.journal_entry_id || "",
          escapeCsvValue(line.journal_entry_description || line.line_description || ""),
          escapeCsvValue(line.reference_type || ""),
          line.reference_id || "",
          line.line_id || "",
          escapeCsvValue(line.line_description || ""),
          formatNumeric(line.debit || 0),
          formatNumeric(line.credit || 0),
          formatNumeric(line.running_balance || 0),
        ]
        csvRows.push(row.join(","))
      }
    }

    // Calculate totals
    const totalDebit = ledgerLines?.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0) || 0
    const totalCredit = ledgerLines?.reduce((sum: number, line: any) => sum + Number(line.credit || 0), 0) || 0
    const finalBalance = ledgerLines && ledgerLines.length > 0 
      ? Number(ledgerLines[ledgerLines.length - 1].running_balance || 0)
      : 0

    // Totals rows (include in data section if include_metadata is false, otherwise add to metadata)
    if (!includeMetadata) {
      // When metadata is excluded, totals are part of the data section
      csvRows.push("")
      csvRows.push(`Total Debit,${formatNumeric(totalDebit)}`)
      csvRows.push(`Total Credit,${formatNumeric(totalCredit)}`)
      csvRows.push(`Final Balance,${formatNumeric(finalBalance)}`)
    } else {
      // When metadata is included, totals are added after data
      csvRows.push("")
      csvRows.push("# Summary")
      csvRows.push(`# Total Debit,${formatNumeric(totalDebit)}`)
      csvRows.push(`# Total Credit,${formatNumeric(totalCredit)}`)
      csvRows.push(`# Final Balance,${formatNumeric(finalBalance)}`)
    }

    // Create CSV content with UTF-8 BOM for Excel compatibility
    const BOM = "\uFEFF"
    const csvContent = BOM + csvRows.join("\n")

    // Generate filename
    const periodLabel = periodStart 
      ? `period-${periodStart}` 
      : `${effectiveStartDate}-to-${effectiveEndDate}`
    const filename = `general-ledger-${account.code}-${periodLabel}.csv`

    // Return CSV file
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
