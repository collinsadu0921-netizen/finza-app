import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params
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
    const { start_date, end_date, date_tolerance_days = 3 } = body

    // Get unreconciled bank transactions
    let bankQuery = supabase
      .from("bank_transactions")
      .select("*")
      .eq("business_id", business.id)
      .eq("account_id", accountId)
      .eq("status", "unreconciled")
      .is("deleted_at", null)

    if (start_date) {
      bankQuery = bankQuery.gte("date", start_date)
    }

    if (end_date) {
      bankQuery = bankQuery.lte("date", end_date)
    }

    const { data: bankTransactions, error: bankError } = await bankQuery

    if (bankError) {
      console.error("Error fetching bank transactions:", bankError)
      return NextResponse.json(
        { error: bankError.message },
        { status: 500 }
      )
    }

    // Get system transactions
    const dateParams: any = {}
    if (start_date) dateParams.p_start_date = start_date
    if (end_date) dateParams.p_end_date = end_date

    const { data: systemTransactions, error: systemError } = await supabase.rpc(
      "get_system_transactions_for_account",
      {
        p_business_id: business.id,
        p_account_id: accountId,
        ...dateParams,
      }
    )

    if (systemError) {
      console.error("Error fetching system transactions:", systemError)
      return NextResponse.json(
        { error: systemError.message },
        { status: 500 }
      )
    }

    // Auto-match logic
    const matches: Array<{ bank_id: string; system_ids: string[] }> = []
    const matchedSystemIds = new Set<string>()

    for (const bankTx of bankTransactions || []) {
      const bankDate = new Date(bankTx.date)
      const bankAmount = Number(bankTx.amount)
      const bankType = bankTx.type

      // Find matching system transactions
      const candidates = (systemTransactions || []).filter((sysTx: any) => {
        if (matchedSystemIds.has(sysTx.id)) return false // Already matched

        const sysAmount = Number(sysTx.amount)
        const sysType = sysTx.type
        const sysDate = new Date(sysTx.date)

        // Amount must match exactly
        if (Math.abs(bankAmount - sysAmount) > 0.01) return false

        // Type must match
        if (bankType !== sysType) return false

        // Date must be within tolerance
        const daysDiff = Math.abs((bankDate.getTime() - sysDate.getTime()) / (1000 * 60 * 60 * 24))
        if (daysDiff > date_tolerance_days) return false

        return true
      })

      if (candidates.length > 0) {
        const systemIds = candidates.map((c: any) => c.id)
        matches.push({
          bank_id: bankTx.id,
          system_ids: systemIds,
        })

        // Mark as matched
        candidates.forEach((c: any) => matchedSystemIds.add(c.id))
      }
    }

    // Apply matches
    const matchResults = []
    for (const match of matches) {
      const { error: matchError } = await supabase
        .from("bank_transactions")
        .update({
          status: "matched",
          matches: match.system_ids,
          updated_at: new Date().toISOString(),
        })
        .eq("id", match.bank_id)

      if (!matchError) {
        matchResults.push(match)
      }
    }

    return NextResponse.json({
      message: `Auto-matched ${matchResults.length} transactions`,
      matches: matchResults,
    })
  } catch (error: any) {
    console.error("Error auto-matching:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


