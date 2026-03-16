import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { asOfDate } = body

    if (!asOfDate) {
      return NextResponse.json(
        { error: "asOfDate is required" },
        { status: 400 }
      )
    }

    // Get retained earnings account
    const retainedEarningsId = await supabase.rpc("get_account_by_code", {
      p_business_id: business.id,
      p_code: "3100",
    })

    if (!retainedEarningsId.data) {
      return NextResponse.json(
        { error: "Retained Earnings account not found" },
        { status: 404 }
      )
    }

    // Calculate net income (income - expenses) up to asOfDate
    const { data: incomeAccounts } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", business.id)
      .eq("type", "income")
      .is("deleted_at", null)

    const { data: expenseAccounts } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", business.id)
      .eq("type", "expense")
      .is("deleted_at", null)

    const incomeAccountIds = incomeAccounts?.map((a) => a.id) || []
    const expenseAccountIds = expenseAccounts?.map((a) => a.id) || []

    let totalIncome = 0
    let totalExpenses = 0

    if (incomeAccountIds.length > 0) {
      const { data: incomeLines } = await supabase
        .from("journal_entry_lines")
        .select(
          `
          credit,
          debit,
          journal_entries!inner (
            date
          )
        `
        )
        .in("account_id", incomeAccountIds)
        .lte("journal_entries.date", asOfDate)

      totalIncome = incomeLines?.reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0) || 0
    }

    if (expenseAccountIds.length > 0) {
      const { data: expenseLines } = await supabase
        .from("journal_entry_lines")
        .select(
          `
          credit,
          debit,
          journal_entries!inner (
            date
          )
        `
        )
        .in("account_id", expenseAccountIds)
        .lte("journal_entries.date", asOfDate)

      totalExpenses = expenseLines?.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0) || 0
    }

    const netIncome = totalIncome - totalExpenses

    if (Math.abs(netIncome) < 0.01) {
      return NextResponse.json({
        message: "No net income to close",
        netIncome: 0,
      })
    }

    // Post journal entry to close income/expenses to retained earnings
    const description = `Year-end close as of ${asOfDate} - Net ${netIncome >= 0 ? "Income" : "Loss"}: ${Math.abs(netIncome).toFixed(2)}`

    const lines: any[] = []

    // Close income accounts (debit income, credit retained earnings)
    if (netIncome > 0) {
      incomeAccountIds.forEach((accountId) => {
        // Get account balance
        // This is simplified - in production, you'd calculate each account's balance
      })

      lines.push({
        account_id: retainedEarningsId.data,
        credit: netIncome,
        description: "Close net income to retained earnings",
      })
    } else {
      // Close loss (debit retained earnings, credit expenses)
      lines.push({
        account_id: retainedEarningsId.data,
        debit: Math.abs(netIncome),
        description: "Close net loss to retained earnings",
      })
    }

    // For simplicity, we'll create a single entry
    // In production, you'd close each income/expense account individually
    const { data: journalEntry } = await supabase.rpc("post_journal_entry", {
      p_business_id: business.id,
      p_date: asOfDate,
      p_description: description,
      p_reference_type: "manual",
      p_reference_id: null,
      p_lines: JSON.stringify(lines),
    })

    return NextResponse.json({
      message: "Year-end close completed",
      netIncome: Math.round(netIncome * 100) / 100,
      journalEntry,
    })
  } catch (error: any) {
    console.error("Error in year-end close:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


