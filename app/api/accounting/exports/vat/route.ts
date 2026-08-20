import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getTaxControlAccountCodes } from "@/lib/accounting/taxControlAccounts"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

/**
 * GET /api/accounting/exports/vat
 * Export VAT return summary as CSV (Service owner + Practice READ+).
 *
 * Query params:
 * - business_id: UUID (required)
 * - period: YYYY-MM format (required)
 */
export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("exports_vat")
  const respondJson = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0) }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    diag.recordTiming("auth", timedStepMs(tAuth), "session")
    if (!user) {
      return respondJson({ error: "Unauthorized" }, 401)
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
    if (authResult.timings) {
      diag.recordTiming("role", authResult.timings.role_ms)
      diag.recordTiming("authority", authResult.timings.authority_ms)
    }
    if (!authResult.ok) {
      return respondJson(
        { error: authResult.error, reason_code: authResult.reasonCode },
        authResult.status
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
    const vatAccountCode = taxControlCodes.vat

    if (!vatAccountCode) {
      return NextResponse.json(
        {
          error: "VAT control account not found. Please configure VAT_PAYABLE control mapping.",
          error_code: "VAT_CONTROL_MISSING",
        },
        { status: 404 }
      )
    }

    const { data: vatAccount, error: vatAccountError } = await dataClient
      .from("accounts")
      .select("id")
      .eq("business_id", resolvedBusinessId)
      .eq("code", vatAccountCode)
      .is("deleted_at", null)
      .maybeSingle()

    if (vatAccountError) {
      console.error("VAT export account query error:", vatAccountError)
      return NextResponse.json(
        { error: "ACCOUNTING_DATA_UNAVAILABLE", error_code: "ACCOUNTING_DATA_UNAVAILABLE" },
        { status: 500 }
      )
    }

    if (!vatAccount) {
      return NextResponse.json(
        { error: `VAT account with code ${vatAccountCode} not found`, error_code: "VAT_ACCOUNT_MISSING" },
        { status: 404 }
      )
    }

    const openingDate = new Date(periodStart)
    openingDate.setDate(openingDate.getDate() - 1)
    const openingDateStr = openingDate.toISOString().split("T")[0]

    const { data: openingBalance, error: openingError } = await dataClient.rpc(
      "calculate_account_balance_as_of",
      {
        p_business_id: resolvedBusinessId,
        p_account_id: vatAccount.id,
        p_as_of_date: openingDateStr,
      }
    )

    if (openingError) {
      console.error("VAT export opening balance error:", openingError)
      return NextResponse.json(
        { error: "ACCOUNTING_DATA_UNAVAILABLE", error_code: "ACCOUNTING_DATA_UNAVAILABLE" },
        { status: 500 }
      )
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
      .eq("account_id", vatAccount.id)
      .eq("journal_entries.business_id", resolvedBusinessId)
      .gte("journal_entries.date", periodStart)
      .lte("journal_entries.date", periodEnd)

    if (linesError) {
      console.error("VAT export period lines error:", linesError)
      return NextResponse.json(
        { error: "ACCOUNTING_DATA_UNAVAILABLE", error_code: "ACCOUNTING_DATA_UNAVAILABLE" },
        { status: 500 }
      )
    }

    const periodDebit = periodLines?.reduce((sum, line) => sum + Number(line.debit || 0), 0) || 0
    const periodCredit = periodLines?.reduce((sum, line) => sum + Number(line.credit || 0), 0) || 0
    const closingBalance = (openingBalance || 0) + periodCredit - periodDebit

    const csvRows = [
      "period,opening_balance,output_vat,input_vat,closing_balance",
      [periodParam, openingBalance || 0, periodCredit, periodDebit, closingBalance].join(","),
    ]

    const serverTiming = diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0) }])
    return new NextResponse(csvRows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="vat-return-${periodParam}.csv"`,
        ...(serverTiming ? { "Server-Timing": serverTiming } : {}),
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
