import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getTaxControlAccountCodes } from "@/lib/accounting/taxControlAccounts"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"

/**
 * GET /api/accounting/exports/levies
 * Export NHIL/GETFund/COVID levy summary as CSV (Service owner + Practice READ+).
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
    const businessId = (searchParams.get("business_id") ?? searchParams.get("businessId"))?.trim() ?? null
    const periodParam = searchParams.get("period")

    if (!businessId) {
      return NextResponse.json(
        { error: "business_id parameter is required", error_code: "MISSING_BUSINESS_ID" },
        { status: 400 }
      )
    }

    const authResult = await resolveAccountingRequestAuthority({
      supabase,
      userId: user.id,
      businessId,
      requiredLevel: "read",
    })
    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error, reason_code: authResult.reasonCode },
        { status: authResult.status }
      )
    }

    const resolvedBusinessId = authResult.businessId
    const dataClient = getAccountingDataClient(authResult, supabase)

    if (!periodParam) {
      return NextResponse.json(
        { error: "Period parameter is required (format: YYYY-MM)", error_code: "MISSING_PERIOD" },
        { status: 400 }
      )
    }

    const [year, month] = periodParam.split("-").map(Number)
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid period format. Use YYYY-MM", error_code: "INVALID_PERIOD" },
        { status: 400 }
      )
    }

    const periodStart = new Date(year, month - 1, 1).toISOString().split("T")[0]
    const periodEnd = new Date(year, month, 0).toISOString().split("T")[0]

    await dataClient
      .from("accounting_periods")
      .select("status")
      .eq("business_id", resolvedBusinessId)
      .eq("period_start", periodStart)
      .maybeSingle()

    const taxControlCodes = await getTaxControlAccountCodes(dataClient, resolvedBusinessId)

    const excludeCovid = periodStart >= "2026-01-01"
    const levyMappings: Array<{ code: string; name: string; accountCode: string | null }> = [
      { code: "NHIL", name: "NHIL", accountCode: taxControlCodes.nhil },
      { code: "GETFUND", name: "GETFUND", accountCode: taxControlCodes.getfund },
    ]

    if (!excludeCovid && taxControlCodes.covid) {
      levyMappings.push({ code: "COVID", name: "COVID", accountCode: taxControlCodes.covid })
    }

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

        const { data: account, error: accountError } = await dataClient
          .from("accounts")
          .select("id")
          .eq("business_id", resolvedBusinessId)
          .eq("code", levy.accountCode)
          .is("deleted_at", null)
          .maybeSingle()

        if (accountError) {
          throw new Error(accountError.message)
        }

        if (!account) {
          return {
            levy_code: levy.name,
            period: periodParam,
            debit_total: 0,
            credit_total: 0,
            closing_balance: 0,
          }
        }

        const openingDate = new Date(periodStart)
        openingDate.setDate(openingDate.getDate() - 1)
        const openingDateStr = openingDate.toISOString().split("T")[0]

        const { data: openingBalance, error: openingError } = await dataClient.rpc(
          "calculate_account_balance_as_of",
          {
            p_business_id: resolvedBusinessId,
            p_account_id: account.id,
            p_as_of_date: openingDateStr,
          }
        )

        if (openingError) {
          throw new Error(openingError.message)
        }

        const { data: periodLines, error: linesError } = await dataClient
          .from("journal_entry_lines")
          .select(
            `
            debit,
            credit,
            journal_entries!inner (
              date,
              business_id
            )
          `
          )
          .eq("account_id", account.id)
          .eq("journal_entries.business_id", resolvedBusinessId)
          .gte("journal_entries.date", periodStart)
          .lte("journal_entries.date", periodEnd)

        if (linesError) {
          throw new Error(linesError.message)
        }

        const periodDebit = periodLines?.reduce((sum, line) => sum + Number(line.debit || 0), 0) || 0
        const periodCredit = periodLines?.reduce((sum, line) => sum + Number(line.credit || 0), 0) || 0
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

    const csvRows = [
      "levy_code,period,debit_total,credit_total,closing_balance",
      ...levies.map((levy) =>
        [levy.levy_code, levy.period, levy.debit_total, levy.credit_total, levy.closing_balance].join(
          ","
        )
      ),
    ]

    return new NextResponse(csvRows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="levies-return-${periodParam}.csv"`,
      },
    })
  } catch (error: any) {
    console.error("Error in levies export:", error)
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        error_code: "ACCOUNTING_DATA_UNAVAILABLE",
      },
      { status: 500 }
    )
  }
}
