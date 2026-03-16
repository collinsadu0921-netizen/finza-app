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
    const { bank_transaction_id, ignore } = body

    if (!bank_transaction_id || typeof ignore !== "boolean") {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify bank transaction belongs to business and account
    const { data: bankTransaction } = await supabase
      .from("bank_transactions")
      .select("id")
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

    // Update status
    const { error: updateError } = await supabase
      .from("bank_transactions")
      .update({
        status: ignore ? "ignored" : "unreconciled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bank_transaction_id)

    if (updateError) {
      console.error("Error updating transaction:", updateError)
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: ignore ? "Transaction ignored" : "Transaction unignored" })
  } catch (error: any) {
    console.error("Error ignoring transaction:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


