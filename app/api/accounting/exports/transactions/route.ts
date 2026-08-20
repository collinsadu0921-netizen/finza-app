import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getTaxControlAccountCodes } from "@/lib/accounting/taxControlAccounts"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"

/**
 * GET /api/accounting/exports/transactions
 * Export transaction-level tax detail as CSV (Service owner + Practice READ+).
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

    const taxControlCodes = await getTaxControlAccountCodes(dataClient, resolvedBusinessId)

    const excludeCovid = periodStart >= "2026-01-01"
    const taxAccountCodes: string[] = []
    const taxCodeMap: Record<string, string> = {}

    if (taxControlCodes.vat) {
      taxAccountCodes.push(taxControlCodes.vat)
      taxCodeMap[taxControlCodes.vat] = "VAT"
    }
    if (taxControlCodes.nhil) {
      taxAccountCodes.push(taxControlCodes.nhil)
      taxCodeMap[taxControlCodes.nhil] = "NHIL"
    }
    if (taxControlCodes.getfund) {
      taxAccountCodes.push(taxControlCodes.getfund)
      taxCodeMap[taxControlCodes.getfund] = "GETFUND"
    }
    if (!excludeCovid && taxControlCodes.covid) {
      taxAccountCodes.push(taxControlCodes.covid)
      taxCodeMap[taxControlCodes.covid] = "COVID"
    }

    if (taxAccountCodes.length === 0) {
      return NextResponse.json(
        {
          error: "No tax control accounts found. Please configure control mappings.",
          error_code: "TAX_CONTROL_MISSING",
        },
        { status: 404 }
      )
    }

    const { data: taxAccounts, error: taxAccountsError } = await dataClient
      .from("accounts")
      .select("id, code")
      .eq("business_id", resolvedBusinessId)
      .in("code", taxAccountCodes)
      .is("deleted_at", null)

    if (taxAccountsError) {
      console.error("Tax transactions accounts error:", taxAccountsError)
      return NextResponse.json(
        { error: "ACCOUNTING_DATA_UNAVAILABLE", error_code: "ACCOUNTING_DATA_UNAVAILABLE" },
        { status: 500 }
      )
    }

    if (!taxAccounts || taxAccounts.length === 0) {
      return NextResponse.json(
        { error: "Tax control accounts not found", error_code: "TAX_ACCOUNT_MISSING" },
        { status: 404 }
      )
    }

    const taxAccountIds = taxAccounts.map((acc) => acc.id)
    const accountCodeMap: Record<string, string> = {}
    taxAccounts.forEach((acc) => {
      accountCodeMap[acc.id] = acc.code
    })

    const { data: taxLines, error: linesError } = await dataClient
      .from("journal_entry_lines")
      .select(
        `
        debit,
        credit,
        description,
        journal_entries!inner (
          id,
          date,
          reference_type,
          reference_id,
          business_id
        ),
        accounts!inner (
          id,
          code
        )
      `
      )
      .in("account_id", taxAccountIds)
      .eq("journal_entries.business_id", resolvedBusinessId)
      .gte("journal_entries.date", periodStart)
      .lte("journal_entries.date", periodEnd)
      .order("journal_entries.date", { ascending: true })

    if (linesError) {
      console.error("Error fetching tax transaction lines:", linesError)
      return NextResponse.json(
        { error: "ACCOUNTING_DATA_UNAVAILABLE", error_code: "ACCOUNTING_DATA_UNAVAILABLE" },
        { status: 500 }
      )
    }

    const csvRows = [
      "transaction_date,source_type,reference_id,tax_code,debit_amount,credit_amount,account_code",
      ...(taxLines || []).map((line: any) => {
        const journalEntry = line.journal_entries
        const account = line.accounts
        const accountCode = accountCodeMap[account.id] || account.code
        const taxCode = taxCodeMap[accountCode] || "UNKNOWN"
        const sourceType = journalEntry.reference_type || "unknown"

        return [
          journalEntry.date,
          sourceType,
          journalEntry.reference_id || "",
          taxCode,
          line.debit || 0,
          line.credit || 0,
          accountCode,
        ].join(",")
      }),
    ]

    return new NextResponse(csvRows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="tax-transactions-${periodParam}.csv"`,
      },
    })
  } catch (error: any) {
    console.error("Error in tax transactions export:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
