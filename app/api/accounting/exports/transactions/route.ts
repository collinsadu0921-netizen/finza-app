import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getTaxControlAccountCodes } from "@/lib/taxControlAccounts"

/**
 * GET /api/accounting/exports/transactions
 * Export transaction-level tax detail as CSV
 * 
 * Query params:
 * - business_id: UUID (required)
 * - period: YYYY-MM format (required)
 * 
 * Returns CSV with columns:
 * - transaction_date
 * - source_type (invoice, bill, expense, pos, credit_note)
 * - reference_id
 * - tax_code (VAT / NHIL / GETFUND / COVID)
 * - debit_amount
 * - credit_amount
 * - account_code
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

    if (!businessId) {
      return NextResponse.json(
        { error: "business_id parameter is required" },
        { status: 400 }
      )
    }

    // Check accountant firm access
    const { data: accessLevel, error: accessError } = await supabase.rpc(
      "can_accountant_access_business",
      {
        p_user_id: user.id,
        p_business_id: businessId,
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

    // Resolve tax control account codes from control map
    const taxControlCodes = await getTaxControlAccountCodes(supabase, businessId)
    
    // Build tax account codes list (exclude COVID for periods >= 2026-01-01)
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
        { error: "No tax control accounts found. Please configure control mappings." },
        { status: 404 }
      )
    }

    // Get tax control accounts
    const { data: taxAccounts } = await supabase
      .from("accounts")
      .select("id, code")
      .eq("business_id", businessId)
      .in("code", taxAccountCodes)
      .is("deleted_at", null)

    if (!taxAccounts || taxAccounts.length === 0) {
      return NextResponse.json(
        { error: "Tax control accounts not found" },
        { status: 404 }
      )
    }

    const taxAccountIds = taxAccounts.map((acc) => acc.id)
    const accountCodeMap: Record<string, string> = {}
    taxAccounts.forEach((acc) => {
      accountCodeMap[acc.id] = acc.code
    })

    // Get journal entry lines for tax accounts
    // We'll filter by date through the journal_entries relationship
    const { data: taxLines, error: linesError } = await supabase
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
      .eq("journal_entries.business_id", businessId)
      .gte("journal_entries.date", periodStart)
      .lte("journal_entries.date", periodEnd)
      .order("journal_entries.date", { ascending: true })

    if (linesError) {
      console.error("Error fetching tax transaction lines:", linesError)
      return NextResponse.json(
        { error: "Failed to fetch tax transactions" },
        { status: 500 }
      )
    }

    // Build CSV rows
    const csvRows = [
      // Header
      "transaction_date,source_type,reference_id,tax_code,debit_amount,credit_amount,account_code",
      // Data rows
      ...(taxLines || []).map((line: any) => {
        const journalEntry = line.journal_entries
        const account = line.accounts
        const accountCode = accountCodeMap[account.id] || account.code
        const taxCode = taxCodeMap[accountCode] || "UNKNOWN"

        // Map reference_type to source_type
        // reference_type can be: invoice, bill, expense, pos, credit_note, etc.
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

    const csv = csvRows.join("\n")

    // Return CSV with proper headers
    return new NextResponse(csv, {
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

