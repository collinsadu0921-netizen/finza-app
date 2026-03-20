import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(
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

    // Verify account exists and belongs to business
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("business_id", business.id)
      .single()

    if (!account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    const body = await request.json()
    const { rows } = body

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "No transactions provided" },
        { status: 400 }
      )
    }

    // Process CSV rows - simple format: date, description, amount, reference (optional)
    const mappedTransactions = rows.map((row: any) => {
      const dateStr = row.date
      const description = row.description || ""
      const amount = Number(row.amount) || 0
      const ref = row.reference || null

      // Parse date
      let date: Date
      if (dateStr) {
        date = new Date(dateStr)
        if (isNaN(date.getTime())) {
          throw new Error(`Invalid date format: ${dateStr}`)
        }
      } else {
        throw new Error("Date is required for each transaction")
      }

      // Validate amount
      if (isNaN(amount) || amount === 0) {
        throw new Error(`Invalid amount: ${row.amount}`)
      }

      // Determine type based on amount sign
      // Positive = credit (money coming in), Negative = debit (money going out)
      const type = amount >= 0 ? "credit" : "debit"

      return {
        business_id: business.id,
        account_id: accountId,
        date: date.toISOString().split("T")[0],
        description: description.trim(),
        amount: Math.abs(amount),
        type,
        external_ref: ref?.trim() || null,
        status: "unreconciled",
      }
    })

    // Insert transactions in bulk
    const { data: insertedTransactions, error: insertError } = await supabase
      .from("bank_transactions")
      .insert(mappedTransactions)
      .select()

    if (insertError) {
      console.error("Error importing transactions:", insertError)
      return NextResponse.json(
        { error: insertError.message || "Failed to import transactions" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${insertedTransactions?.length || 0} transactions`,
      count: insertedTransactions?.length || 0,
      transactions: insertedTransactions || [],
    })
  } catch (error: any) {
    console.error("Error importing transactions:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


