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
    const { bank_transaction_id, system_transaction_ids } = body

    if (!bank_transaction_id || !system_transaction_ids || !Array.isArray(system_transaction_ids) || system_transaction_ids.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify bank transaction belongs to business and account
    const { data: bankTransaction } = await supabase
      .from("bank_transactions")
      .select("id, matches")
      .eq("id", bank_transaction_id)
      .eq("business_id", business.id)
      .eq("account_id", accountId)
      .single()

    if (!bankTransaction) {
      return NextResponse.json(
        { error: "Bank transaction not found" },
        { status: 404 }
      )
    }

    // Update bank transaction with matches
    const { error: updateError } = await supabase
      .from("bank_transactions")
      .update({
        status: "matched",
        matches: system_transaction_ids,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bank_transaction_id)

    if (updateError) {
      console.error("Error matching transaction:", updateError)
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: "Transactions matched successfully" })
  } catch (error: any) {
    console.error("Error matching transactions:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


