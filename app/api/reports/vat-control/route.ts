import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import {
  canUserInitializeAccounting,
  ensureAccountingInitialized,
} from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"

/**
 * GET /api/reports/vat-control
 * VAT Control Report - Sources ONLY from journal_entry_lines
 * 
 * INVARIANT 2: Operational surfaces must NOT read ledger tables
 * This report uses ledger and belongs in accounting workspace
 * 
 * Query params:
 * - start_date: YYYY-MM-DD format (required)
 * - end_date: YYYY-MM-DD format (required)
 * 
 * Returns:
 * - opening_balance: Balance before period start
 * - vat_collected: Sum of credits (liability increases)
 * - vat_reversed: Sum of debits (liability decreases)
 * - closing_balance: opening + credits - debits
 * - period_id: Accounting period ID (if available)
 * - invariant_valid: Whether opening + credits - debits = closing
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
    const ctx = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      source: "api",
    })
    if ("error" in ctx) {
      return NextResponse.json(
        { error: "Client not selected. Use Control Tower or select a client.", error_code: "CLIENT_REQUIRED" },
        { status: 400 }
      )
    }
    const businessId = ctx.businessId

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        {
          error:
            "Unauthorized. You need reports access (e.g. owner, admin, or reports.view) to view the VAT control report.",
        },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, businessId)
      if (!ready) {
        return NextResponse.json(
          {
            error: "ACCOUNTING_NOT_READY",
            business_id: businessId,
            authority_source: auth.authority_source,
            message:
              "Accounting is not initialized for this business. Ask an owner or admin to complete setup.",
          },
          { status: 403 }
        )
      }
    } else {
      const bootstrap = await ensureAccountingInitialized(supabase, businessId)
      if (bootstrap.error) {
        const structured = bootstrap.structuredError
        const status = structured?.error_code === "INIT_DENIED" ? 403 : 500
        return NextResponse.json(
          {
            error: bootstrap.error,
            ...(structured && {
              error_code: structured.error_code,
              business_id: structured.business_id,
            }),
          },
          { status }
        )
      }
    }

    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "start_date and end_date parameters are required (format: YYYY-MM-DD)" },
        { status: 400 }
      )
    }

    // Validate date format
    const startDateObj = new Date(startDate)
    const endDateObj = new Date(endDate)
    
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      )
    }

    if (startDateObj > endDateObj) {
      return NextResponse.json(
        { error: "start_date must be before or equal to end_date" },
        { status: 400 }
      )
    }

    // Get VAT account (account_code = '2100')
    const { data: vatAccountFirst, error: accountError } = await supabase
      .from("accounts")
      .select("id, code, name")
      .eq("business_id", businessId)
      .eq("code", "2100")
      .is("deleted_at", null)
      .maybeSingle()

    if (accountError) {
      console.error("Error fetching VAT account:", accountError)
      return NextResponse.json(
        { error: "Failed to fetch VAT account" },
        { status: 500 }
      )
    }

    let vatAccount = vatAccountFirst
    if (!vatAccount) {
      if (canUserInitializeAccounting(auth.authority_source)) {
        await supabase.rpc("create_system_accounts", { p_business_id: businessId })
      }
      const { data: retryAccount } = await supabase
        .from("accounts")
        .select("id, code, name")
        .eq("business_id", businessId)
        .eq("code", "2100")
        .is("deleted_at", null)
        .maybeSingle()
      if (!retryAccount) {
        return NextResponse.json(
          {
            error:
              "VAT account (code 2100) not found. An owner or admin may need to initialize accounting first.",
          },
          { status: 404 }
        )
      }
      vatAccount = retryAccount
    }

    // Calculate opening balance: SUM(credit - debit) for entries before period start
    // For liability accounts: balance = credit - debit
    const { data: openingLines, error: openingError } = await supabase
      .from("journal_entry_lines")
      .select(
        `
        debit,
        credit,
        journal_entries!inner (
          date,
          period_id
        )
      `
      )
      .eq("account_id", vatAccount.id)
      .eq("journal_entries.business_id", businessId)
      .lt("journal_entries.date", startDate)

    if (openingError) {
      console.error("Error fetching opening balance lines:", openingError)
      return NextResponse.json(
        { error: "Failed to fetch opening balance" },
        { status: 500 }
      )
    }

    let openingBalance = 0
    if (openingLines) {
      openingBalance = openingLines.reduce(
        (sum: number, line: any) => sum + Number(line.credit || 0) - Number(line.debit || 0),
        0
      )
    }

    // Calculate period movement: credits (vat_collected) and debits (vat_reversed)
    const { data: periodLines, error: periodError } = await supabase
      .from("journal_entry_lines")
      .select(
        `
        debit,
        credit,
        journal_entries!inner (
          date,
          period_id
        )
      `
      )
      .eq("account_id", vatAccount.id)
      .eq("journal_entries.business_id", businessId)
      .gte("journal_entries.date", startDate)
      .lte("journal_entries.date", endDate)

    if (periodError) {
      console.error("Error fetching period lines:", periodError)
      return NextResponse.json(
        { error: "Failed to fetch period movement" },
        { status: 500 }
      )
    }

    // Calculate vat_collected (credits) and vat_reversed (debits)
    let vatCollected = 0
    let vatReversed = 0
    let periodId: string | null = null

    if (periodLines && periodLines.length > 0) {
      vatCollected = periodLines.reduce(
        (sum: number, line: any) => sum + Number(line.credit || 0),
        0
      )
      vatReversed = periodLines.reduce(
        (sum: number, line: any) => sum + Number(line.debit || 0),
        0
      )
      
      // Get period_id from first entry (all should have same period_id if properly posted)
      // Supabase returns journal_entries as an object when joining from journal_entry_lines
      const firstLine = periodLines[0]
      if (firstLine?.journal_entries) {
        const entry = firstLine.journal_entries
        // When joining from many-to-one, Supabase returns the joined record as an object
        if (Array.isArray(entry) && entry.length > 0) {
          periodId = entry[0].period_id || null
        } else if (entry && typeof entry === 'object' && 'period_id' in entry) {
          periodId = (entry as any).period_id || null
        }
      }
    }

    // Calculate closing balance: opening + credits - debits
    const closingBalance = openingBalance + vatCollected - vatReversed

    // Validate invariant: opening + credits - debits = closing
    const calculatedClosing = openingBalance + vatCollected - vatReversed
    const invariantValid = Math.abs(closingBalance - calculatedClosing) < 0.01 // Allow for rounding

    return NextResponse.json({
      opening_balance: Math.round(openingBalance * 100) / 100,
      vat_collected: Math.round(vatCollected * 100) / 100,
      vat_reversed: Math.round(vatReversed * 100) / 100,
      closing_balance: Math.round(closingBalance * 100) / 100,
      period_id: periodId,
      period: {
        start_date: startDate,
        end_date: endDate,
      },
      account: {
        id: vatAccount.id,
        code: vatAccount.code,
        name: vatAccount.name,
      },
      invariant_valid: invariantValid,
      invariant_check: {
        formula: "opening + credits - debits = closing",
        calculated: calculatedClosing,
        actual: closingBalance,
        difference: Math.abs(closingBalance - calculatedClosing),
      },
    })
  } catch (error: any) {
    console.error("Error in VAT Control Report:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
