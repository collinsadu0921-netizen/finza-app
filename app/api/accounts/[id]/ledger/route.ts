import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    // Verify account exists
    const { data: account } = await supabase
      .from("accounts")
      .select("id, name, code, type")
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    // Get journal entry lines for this account
    let query = supabase
      .from("journal_entry_lines")
      .select(
        `
        *,
        journal_entries (
          id,
          date,
          description,
          reference_type,
          reference_id
        )
      `
      )
      .eq("account_id", id)
      .order("created_at", { ascending: true })

    if (startDate) {
      query = query.gte("journal_entries.date", startDate)
    }

    if (endDate) {
      query = query.lte("journal_entries.date", endDate)
    }

    const { data: lines, error } = await query

    if (error) {
      console.error("Error fetching ledger:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Calculate running balance
    let runningBalance = 0
    const transactions = (lines || []).map((line: any) => {
      const debit = Number(line.debit || 0)
      const credit = Number(line.credit || 0)

      // Calculate balance based on account type
      if (account.type === "asset" || account.type === "expense") {
        runningBalance = runningBalance + debit - credit
      } else {
        // liability, equity, income
        runningBalance = runningBalance + credit - debit
      }

      return {
        ...line,
        running_balance: runningBalance,
      }
    })

    return NextResponse.json({
      account,
      transactions,
      final_balance: runningBalance,
    })
  } catch (error: any) {
    console.error("Error fetching account ledger:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


