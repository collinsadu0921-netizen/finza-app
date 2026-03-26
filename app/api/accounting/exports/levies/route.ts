import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getTaxControlAccountCodes } from "@/lib/accounting/taxControlAccounts"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/exports/levies
 * Export NHIL/GETFund/COVID levy summary as CSV
 * 
 * Query params:
 * - business_id: UUID (required)
 * - period: YYYY-MM format (required)
 * 
 * Returns CSV with columns:
 * - levy_code (NHIL / GETFUND / COVID)
 * - period
 * - debit_total
 * - credit_total
 * - closing_balance
 * 
 * Note: COVID is automatically excluded for periods >= 2026-01-01
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

    // Resolve levy control account codes from control map
    const taxControlCodes = await getTaxControlAccountCodes(supabase, resolvedBusinessId)
    
    // Build levy mappings (exclude COVID for periods >= 2026-01-01)
    const excludeCovid = periodStart >= "2026-01-01"
    const levyMappings: Array<{ code: string; name: string; accountCode: string | null }> = [
      { code: "NHIL", name: "NHIL", accountCode: taxControlCodes.nhil },
      { code: "GETFUND", name: "GETFUND", accountCode: taxControlCodes.getfund },
    ]

    if (!excludeCovid && taxControlCodes.covid) {
      levyMappings.push({ code: "COVID", name: "COVID", accountCode: taxControlCodes.covid })
    }

    // Calculate balances for each levy
    const levies = await Promise.all(
      levyMappings.map(async (levy) => {
        if (!levy.accountCode) {
          return {
            levy_code: levy.name,
            period: periodParam,
            debit_total: 0,
            credit_total: 0,
            closing_balance: 0,
          }
        }

        // Get account ID
        const { data: account } = await supabase
          .from("accounts")
          .select("id")
          .eq("business_id", resolvedBusinessId)
          .eq("code", levy.accountCode)
          .is("deleted_at", null)
          .maybeSingle()

        if (!account) {
          return {
            levy_code: levy.name,
            period: periodParam,
            debit_total: 0,
            credit_total: 0,
            closing_balance: 0,
          }
        }

        // Calculate opening balance
        const openingDate = new Date(periodStart)
        openingDate.setDate(openingDate.getDate() - 1)
        const openingDateStr = openingDate.toISOString().split("T")[0]

        const { data: openingBalance } = await supabase.rpc(
          "calculate_account_balance_as_of",
          {
            p_business_id: resolvedBusinessId,
            p_account_id: account.id,
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
          .eq("account_id", account.id)
          .gte("journal_entries.date", periodStart)
          .lte("journal_entries.date", periodEnd)

        const periodDebit = periodLines?.reduce((sum, line) => sum + Number(line.debit || 0), 0) || 0
        const periodCredit = periodLines?.reduce((sum, line) => sum + Number(line.credit || 0), 0) || 0

        // Calculate closing balance (liability: opening + credits - debits)
        const closingBalance = (openingBalance || 0) + periodCredit - periodDebit

        return {
          levy_code: levy.name,
          period: periodParam,
          debit_total: periodDebit,
          credit_total: periodCredit,
          closing_balance: closingBalance,
        }
      })
    )

    // Build CSV
    const csvRows = [
      // Header
      "levy_code,period,debit_total,credit_total,closing_balance",
      // Data rows
      ...levies.map((levy) =>
        [
          levy.levy_code,
          levy.period,
          levy.debit_total,
          levy.credit_total,
          levy.closing_balance,
        ].join(",")
      ),
    ]

    const csv = csvRows.join("\n")

    // Return CSV with proper headers
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="levies-return-${periodParam}.csv"`,
      },
    })
  } catch (error: any) {
    console.error("Error in levies export:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

