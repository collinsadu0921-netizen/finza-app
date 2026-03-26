import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getTaxControlAccountCodes } from "@/lib/accounting/taxControlAccounts"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/exports/vat
 * Export VAT return summary as CSV
 * 
 * Query params:
 * - business_id: UUID (required)
 * - period: YYYY-MM format (required)
 * 
 * Returns CSV with columns:
 * - period
 * - opening_balance
 * - output_vat
 * - input_vat
 * - closing_balance
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
    const periodParam = searchParams.get("period") // Format: YYYY-MM

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    if (!businessId) {
      return NextResponse.json(
        { error: "business_id parameter is required" },
        { status: 400 }
      )
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
        { error: "business_id parameter is required" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    // Check accountant firm access
    const { data: accessLevel, error: accessError } = await supabase.rpc(
      "can_accountant_access_business",
      {
        p_user_id: user.id,
        p_business_id: resolvedBusinessId,
      }
    )

    if (accessError) {
      console.error("Error checking accountant access:", accessError)
      return NextResponse.json(
        { error: "Failed to verify access" },
        { status: 500 }
      )
    }

    if (!accessLevel) {
      return NextResponse.json(
        { error: "Unauthorized. No access to this business." },
        { status: 403 }
      )
    }

    if (!periodParam) {
      return NextResponse.json(
        { error: "Period parameter is required (format: YYYY-MM)" },
        { status: 400 }
      )
    }

    // Parse period (YYYY-MM) to period_start and period_end
    const [year, month] = periodParam.split("-").map(Number)
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid period format. Use YYYY-MM" },
        { status: 400 }
      )
    }

    const periodStart = new Date(year, month - 1, 1).toISOString().split("T")[0]
    const periodEnd = new Date(year, month, 0).toISOString().split("T")[0] // Last day of month

    // Check accounting period exists and get status
    const { data: accountingPeriod } = await supabase
      .from("accounting_periods")
      .select("status")
      .eq("business_id", resolvedBusinessId)
      .eq("period_start", periodStart)
      .maybeSingle()

    // Resolve VAT control account code from control map
    const taxControlCodes = await getTaxControlAccountCodes(supabase, resolvedBusinessId)
    const vatAccountCode = taxControlCodes.vat

    if (!vatAccountCode) {
      return NextResponse.json(
        { error: "VAT control account not found. Please configure VAT_PAYABLE control mapping." },
        { status: 404 }
      )
    }

    // Get VAT account ID
    const { data: vatAccount } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", resolvedBusinessId)
      .eq("code", vatAccountCode)
      .is("deleted_at", null)
      .maybeSingle()

    if (!vatAccount) {
      return NextResponse.json(
        { error: `VAT account with code ${vatAccountCode} not found` },
        { status: 404 }
      )
    }

    // Calculate opening balance (balance as of period_start - 1 day)
    const openingDate = new Date(periodStart)
    openingDate.setDate(openingDate.getDate() - 1)
    const openingDateStr = openingDate.toISOString().split("T")[0]

    const { data: openingBalance } = await supabase.rpc(
      "calculate_account_balance_as_of",
      {
        p_business_id: resolvedBusinessId,
        p_account_id: vatAccount.id,
        p_as_of_date: openingDateStr,
      }
    )

    // Calculate period debits and credits
    const { data: periodLines } = await supabase
      .from("journal_entry_lines")
      .select(
        `
        debit,
        credit,
        journal_entries!inner (
          date
        )
      `
      )
      .eq("account_id", vatAccount.id)
      .gte("journal_entries.date", periodStart)
      .lte("journal_entries.date", periodEnd)

    const periodDebit = periodLines?.reduce((sum, line) => sum + Number(line.debit || 0), 0) || 0
    const periodCredit = periodLines?.reduce((sum, line) => sum + Number(line.credit || 0), 0) || 0

    // Calculate closing balance
    // For liability accounts: closing = opening + credits - debits
    const closingBalance = (openingBalance || 0) + periodCredit - periodDebit

    // Build CSV
    // Output VAT = credits (liability increases)
    // Input VAT = debits (liability decreases)
    const csvRows = [
      // Header
      "period,opening_balance,output_vat,input_vat,closing_balance",
      // Data row
      [
        periodParam,
        openingBalance || 0,
        periodCredit, // Output VAT = credits
        periodDebit, // Input VAT = debits
        closingBalance,
      ].join(","),
    ]

    const csv = csvRows.join("\n")

    // Return CSV with proper headers
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="vat-return-${periodParam}.csv"`,
      },
    })
  } catch (error: any) {
    console.error("Error in VAT export:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

