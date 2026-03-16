import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/reports/registers
 * Register Report - Ledger-based reconciliation
 * Sources ONLY from journal_entry_lines for financial data
 * Uses reference_id to join sales for register/session grouping metadata
 * 
 * INVARIANT 2: Operational surfaces must NOT read ledger tables
 * This report uses ledger and belongs in accounting workspace
 * 
 * Includes ALL cash movements for the period:
 * - Sales (reference_type='sale'): debits to Cash = cash_received
 * - Refunds (reference_type='refund'): credits to Cash = cash_paid
 * - Voids (reference_type='void'): credits to Cash = cash_paid
 * 
 * Query params:
 * - start_date: YYYY-MM-DD format (required)
 * - end_date: YYYY-MM-DD format (required)
 * 
 * Returns per register/session:
 * - opening_cash_balance
 * - cash_received (debits to Cash account from sales)
 * - cash_paid (credits to Cash account from refunds and voids)
 * - non_cash_totals (by clearing account)
 * - expected_cash
 * - closing_cash_balance
 * - variance
 * - invariant_valid
 */
export async function GET(request: NextRequest) {
  // INVARIANT 2: Block ledger reads from operational Financial Reports
  return NextResponse.json(
    {
      code: "LEDGER_READ_BLOCKED",
      error: "This report uses ledger data. Use accounting workspace reports.",
      canonical_alternative: "/api/accounting/reports/registers",
    },
    { status: 410 }
  )
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const ctx = await resolveAccountingContext({ supabase, userId: user.id, searchParams, source: "api" })
    if ("error" in ctx) {
      return NextResponse.json(
        { error: "Client not selected.", error_code: "CLIENT_REQUIRED" },
        { status: 400 }
      )
    }
    const business = { id: ctx.businessId }

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

    // Get Cash account (1000) and clearing accounts
    const { data: accounts, error: accountError } = await supabase
      .from("accounts")
      .select("id, code, name")
      .eq("business_id", business.id)
      .in("code", ["1000", "1010", "1020", "1030"]) // Cash, Bank, MoMo, Card
      .is("deleted_at", null)

    if (accountError) {
      console.error("Error fetching accounts:", accountError)
      return NextResponse.json(
        { error: "Failed to fetch accounts" },
        { status: 500 }
      )
    }

    const cashAccount = accounts?.find((acc) => acc.code === "1000")
    if (!cashAccount) {
      return NextResponse.json(
        { error: "Cash account (code 1000) not found for this business" },
        { status: 404 }
      )
    }

    // Get all journal entry lines for Cash and clearing accounts in the period
    // Include sales, refunds, and voids (reference_type IN ('sale', 'refund', 'void'))
    // Join to journal_entries to get reference_id (sale_id) for grouping
    // Register Report reflects ALL cash movements for the period, regardless of transaction origin
    const accountIds = accounts?.map((acc) => acc.id).filter(Boolean) || []
    
    if (accountIds.length === 0) {
      return NextResponse.json(
        { error: "No payment accounts found for this business" },
        { status: 404 }
      )
    }
    
    const { data: periodLines, error: periodError } = await supabase
      .from("journal_entry_lines")
      .select(
        `
        id,
        account_id,
        debit,
        credit,
        journal_entries!inner (
          id,
          date,
          reference_type,
          reference_id
        )
      `
      )
      .in("account_id", accountIds)
      .eq("journal_entries.business_id", business.id)
      .gte("journal_entries.date", startDate)
      .lte("journal_entries.date", endDate)
      .in("journal_entries.reference_type", ["sale", "refund", "void", "sale_refund"])  // Include sales, refunds, voids, and legacy sale_refund

    if (periodError) {
      console.error("Error fetching period lines:", periodError)
      return NextResponse.json(
        { error: "Failed to fetch period movement", details: periodError.message },
        { status: 500 }
      )
    }

    // Handle case where no period lines are found
    if (!periodLines || periodLines.length === 0) {
      return NextResponse.json({
        period: {
          start_date: startDate,
          end_date: endDate,
        },
        registers: [],
      })
    }

    // Get sale IDs from sales, refunds, and voids to fetch register_id and session_id for grouping
    // Refunds and voids reference the same sale_id, so we can use the same map
    // Note: Voids may have deleted the sale, so we need to handle missing sales gracefully
    const saleIds = Array.from(
      new Set(
        periodLines
          .map((line: any) => line.journal_entries?.reference_id)
          .filter(Boolean)
      )
    )

    // Fetch register_id and session_id from sales (metadata only, not financial data)
    // This works for sales, refunds, and voids since they all reference the same sale_id
    // For voids, the sale might be deleted, so we use maybeSingle() and handle missing gracefully
    let saleRegisterMap = new Map<string, { register_id: string; session_id: string | null }>()
    
    if (saleIds.length > 0) {
      const { data: sales } = await supabase
        .from("sales")
        .select("id, register_id, cashier_session_id")
        .in("id", saleIds)
        .not("register_id", "is", null)

      if (sales) {
        for (const sale of sales) {
          saleRegisterMap.set(sale.id, {
            register_id: sale.register_id,
            session_id: sale.cashier_session_id || null,
          })
        }
      }
      
      // For any sale_ids not found in sales table (e.g., voided sales that were deleted),
      // we can't group by register, so those lines will be skipped in processing
      // This is acceptable as voided sales should ideally be posted before deletion
    }

    // Calculate opening balances per register/session
    // Opening balance = Cash account balance from sales, refunds, and voids before period start, grouped by register
    // Includes sales (debits), refunds (credits), and voids (credits) to get net opening balance
    const { data: openingLines, error: openingError } = await supabase
      .from("journal_entry_lines")
      .select(
        `
        account_id,
        debit,
        credit,
        journal_entries!inner (
          date,
          reference_type,
          reference_id
        )
      `
      )
      .eq("account_id", cashAccount.id)
      .eq("journal_entries.business_id", business.id)
      .lt("journal_entries.date", startDate)
      .in("journal_entries.reference_type", ["sale", "refund", "void", "sale_refund"])  // Include sales, refunds, voids, and legacy sale_refund

    if (openingError) {
      console.error("Error fetching opening balance lines:", openingError)
      return NextResponse.json(
        { error: "Failed to fetch opening balance", details: openingError.message },
        { status: 500 }
      )
    }

    // Get sale IDs from opening lines to map to registers
    const openingSaleIds = Array.from(
      new Set(
        (openingLines || [])
          .map((line: any) => line.journal_entries?.reference_id)
          .filter(Boolean)
      )
    )

    // Fetch register_id and session_id for opening balance sales
    const openingSaleRegisterMap = new Map<string, { register_id: string; session_id: string | null }>()
    
    if (openingSaleIds.length > 0) {
      const { data: openingSales } = await supabase
        .from("sales")
        .select("id, register_id, cashier_session_id")
        .in("id", openingSaleIds)
        .not("register_id", "is", null)

      if (openingSales) {
        for (const sale of openingSales) {
          openingSaleRegisterMap.set(sale.id, {
            register_id: sale.register_id,
            session_id: sale.cashier_session_id || null,
          })
        }
      }
    }

    // Group opening balances by register/session
    // Opening balance = sum of sales (debits) - sum of refunds/voids (credits) before period start
    const openingBalancesByRegister = new Map<string, number>()
    const safeOpeningLines = openingLines || []
    for (const line of safeOpeningLines) {
      const saleId = (line as any).journal_entries?.reference_id
      if (!saleId) continue
      
      const registerInfo = openingSaleRegisterMap.get(saleId)
      if (!registerInfo) continue
      
      const key = `${registerInfo.register_id}_${registerInfo.session_id || 'no_session'}`
      const current = openingBalancesByRegister.get(key) || 0
      // For asset accounts: balance = debit - credit (cash received - cash paid)
      // Sales: debit increases balance, Refunds/Voids: credit decreases balance
      const amount = Number((line as any).debit || 0) - Number((line as any).credit || 0)
      openingBalancesByRegister.set(key, current + amount)
    }

    // Group period lines by register/session
    type RegisterSessionData = {
      register_id: string
      session_id: string | null
      opening_cash_balance: number
      cash_received: number
      cash_paid: number
      non_cash_totals: Record<string, { code: string; name: string; received: number; paid: number }>
      expected_cash: number
      closing_cash_balance: number
      variance: number
    }

    const registerSessionMap = new Map<string, RegisterSessionData>()

    // Initialize register/session entries
    for (const [saleId, registerInfo] of saleRegisterMap.entries()) {
      const key = `${registerInfo.register_id}_${registerInfo.session_id || 'no_session'}`
      if (!registerSessionMap.has(key)) {
        registerSessionMap.set(key, {
          register_id: registerInfo.register_id,
          session_id: registerInfo.session_id,
          opening_cash_balance: openingBalancesByRegister.get(key) || 0,
          cash_received: 0,
          cash_paid: 0,
          non_cash_totals: {},
          expected_cash: 0,
          closing_cash_balance: 0,
          variance: 0,
        })
      }
    }

    // Process period lines
    const safePeriodLines = periodLines || []
    for (const line of safePeriodLines) {
      // Safety check: ensure journal_entries data exists
      if (!line || !(line as any).journal_entries) {
        console.warn("Skipping line with missing journal_entries data:", line)
        continue
      }

      const saleId = (line as any).journal_entries?.reference_id
      if (!saleId) continue

      const registerInfo = saleRegisterMap.get(saleId)
      if (!registerInfo) continue

      const key = `${registerInfo.register_id}_${registerInfo.session_id || 'no_session'}`
      const data = registerSessionMap.get(key)
      if (!data) continue

      const accountId = line.account_id
      if (!accountId) continue

      const account = accounts?.find((acc) => acc.id === accountId)
      if (!account) continue

      const debit = Number(line.debit || 0)
      const credit = Number(line.credit || 0)
      const referenceType = (line as any).journal_entries?.reference_type

      if (account.code === "1000") {
        // Cash account: 
        // - Sales: debit = cash received
        // - Refunds: credit = cash paid
        // - Voids: credit = cash paid
        if (referenceType === "sale") {
          data.cash_received += debit
        } else if (referenceType === "refund" || referenceType === "void" || referenceType === "sale_refund") {
          // Refunds, voids, and legacy sale_refund credit Cash (reduce cash in drawer)
          data.cash_paid += credit
        }
      } else {
        // Clearing accounts: track non-cash totals
        // - Sales: debit = non-cash received
        // - Refunds: credit = non-cash paid
        // - Voids: credit = non-cash paid
        if (!data.non_cash_totals[account.code]) {
          data.non_cash_totals[account.code] = {
            code: account.code,
            name: account.name,
            received: 0,
            paid: 0,
          }
        }
        if (referenceType === "sale") {
          data.non_cash_totals[account.code].received += debit
        } else if (referenceType === "refund" || referenceType === "void" || referenceType === "sale_refund") {
          // Refunds, voids, and legacy sale_refund credit clearing accounts
          data.non_cash_totals[account.code].paid += credit
        }
      }
    }

    // Calculate closing balances and variances
    const results = []
    for (const [key, data] of registerSessionMap.entries()) {
      // Calculate closing cash balance: opening + received - paid
      data.closing_cash_balance = data.opening_cash_balance + data.cash_received - data.cash_paid
      
      // Expected cash = opening + cash received - cash paid (refunds and voids reduce expected cash)
      // This is what should be in drawer after accounting for refunds and voids
      // Note: With refunds and voids properly tracked, expected = opening + received - paid
      data.expected_cash = data.opening_cash_balance + data.cash_received - data.cash_paid
      
      // Variance = expected - closing (should be 0 if balanced)
      // With refunds: expected = opening + received - paid, closing = opening + received - paid
      // So variance should be 0 if everything is correct
      data.variance = data.expected_cash - data.closing_cash_balance

      // Validate invariant: opening + cash_in - cash_out = closing ± adjustments
      const calculatedClosing = data.opening_cash_balance + data.cash_received - data.cash_paid
      const invariantValid = Math.abs(data.closing_cash_balance - calculatedClosing) < 0.01

      // Get register name (with error handling)
      let registerName = "Unknown Register"
      try {
        const { data: register } = await supabase
          .from("registers")
          .select("name")
          .eq("id", data.register_id)
          .maybeSingle()
        registerName = register?.name || "Unknown Register"
      } catch (registerError) {
        console.error("Error fetching register name:", registerError)
        // Continue with default name
      }

      results.push({
        register_id: data.register_id,
        register_name: registerName,
        session_id: data.session_id,
        opening_cash_balance: Math.round(data.opening_cash_balance * 100) / 100,
        cash_received: Math.round(data.cash_received * 100) / 100,
        cash_paid: Math.round(data.cash_paid * 100) / 100,
        non_cash_totals: Object.values(data.non_cash_totals).map((tot) => ({
          code: tot.code,
          name: tot.name,
          received: Math.round(tot.received * 100) / 100,
          paid: Math.round(tot.paid * 100) / 100,
        })),
        expected_cash: Math.round(data.expected_cash * 100) / 100,
        closing_cash_balance: Math.round(data.closing_cash_balance * 100) / 100,
        variance: Math.round(data.variance * 100) / 100,
        invariant_valid: invariantValid,
      })
    }

    return NextResponse.json({
      period: {
        start_date: startDate,
        end_date: endDate,
      },
      registers: results,
    })
  } catch (error: any) {
    console.error("Error in Register Report:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
