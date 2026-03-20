import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> | { accountId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const accountId = resolvedParams.accountId

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const status = searchParams.get("status")

    // Verify account exists and belongs to business
    const { data: account } = await supabase
      .from("accounts")
      .select("id, name, code, type")
      .eq("id", accountId)
      .eq("business_id", business.id)
      .single()

    if (!account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    // Get bank transactions
    let bankQuery = supabase
      .from("bank_transactions")
      .select("*")
      .eq("business_id", business.id)
      .eq("account_id", accountId)
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })

    if (startDate) {
      bankQuery = bankQuery.gte("date", startDate)
    }

    if (endDate) {
      bankQuery = bankQuery.lte("date", endDate)
    }

    if (status) {
      bankQuery = bankQuery.eq("status", status)
    }

    const { data: bankTransactions, error: bankError } = await bankQuery

    if (bankError) {
      console.error("Error fetching bank transactions:", bankError)
    }

    // Get system transactions using the function
    const dateParams: any = {}
    if (startDate) dateParams.p_start_date = startDate
    if (endDate) dateParams.p_end_date = endDate

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
    }

    // Calculate balances
    const openingBalance = startDate
      ? await supabase.rpc("calculate_account_balance_as_of", {
        p_business_id: business.id,
        p_account_id: accountId,
        p_as_of_date: startDate,
      })
      : { data: 0 }

    // Exclude ignored transactions from balance — they're intentionally out of scope
    const activeBankTxns = (bankTransactions || []).filter((t: any) => t.status !== "ignored")
    const bankEndingBalance = activeBankTxns.reduce((sum: number, t: any) => {
      if (t.type === "credit") return sum + Number(t.amount)
      return sum - Number(t.amount)
    }, 0)

    const systemEndingBalance = systemTransactions?.reduce((sum: number, t: any) => {
      if (t.type === "credit") return sum + Number(t.amount)
      return sum - Number(t.amount)
    }, 0) || 0

    const difference = bankEndingBalance - systemEndingBalance

    return NextResponse.json({
      account,
      bankTransactions: bankTransactions || [],
      systemTransactions: systemTransactions || [],
      balances: {
        opening: Number(openingBalance.data || 0),
        bankEnding: bankEndingBalance,
        systemEnding: systemEndingBalance,
        difference: difference,
      },
    })
  } catch (error: any) {
    console.error("Error in reconciliation transactions:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


