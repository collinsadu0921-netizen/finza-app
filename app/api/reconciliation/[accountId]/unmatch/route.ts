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
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { bank_transaction_id } = body

    if (!bank_transaction_id) {
      return NextResponse.json({ error: "Missing bank_transaction_id" }, { status: 400 })
    }

    // Verify bank transaction belongs to this business and account
    const { data: bankTransaction } = await supabase
      .from("bank_transactions")
      .select("id, fee_journal_entry_id, date")
      .eq("id", bank_transaction_id)
      .eq("business_id", business.id)
      .eq("account_id", accountId)
      .single()

    if (!bankTransaction) {
      return NextResponse.json({ error: "Bank transaction not found" }, { status: 404 })
    }

    // If a fee journal entry was posted when this transaction was matched, reverse it
    if (bankTransaction.fee_journal_entry_id) {
      const feeJeId = bankTransaction.fee_journal_entry_id

      // Fetch the original fee JE lines
      const { data: feeLines } = await supabase
        .from("journal_entry_lines")
        .select("account_id, debit, credit, description")
        .eq("journal_entry_id", feeJeId)

      if (feeLines && feeLines.length > 0) {
        const txnDate = bankTransaction.date || new Date().toISOString().slice(0, 10)

        // Find an open accounting period
        const { data: period } = await supabase
          .from("accounting_periods")
          .select("id")
          .eq("business_id", business.id)
          .lte("period_start", txnDate)
          .gte("period_end", txnDate)
          .neq("status", "locked")
          .order("period_start", { ascending: false })
          .limit(1)
          .single()

        if (period) {
          // Post a reversing entry (swap debit/credit)
          const { data: reverseJe } = await supabase
            .from("journal_entries")
            .insert({
              business_id: business.id,
              date: txnDate,
              description: "Reversal of payment processing fee — bank reconciliation unmatch",
              reference_type: "bank_reconciliation_reversal",
              source_type: "adjustment",
              period_id: period.id,
              created_by: user.id,
              posted_by: user.id,
              posting_source: "system",
            })
            .select("id")
            .single()

          if (reverseJe) {
            await supabase
              .from("journal_entry_lines")
              .insert(
                feeLines.map((line: any) => ({
                  journal_entry_id: reverseJe.id,
                  account_id: line.account_id,
                  debit: Number(line.credit),   // swapped
                  credit: Number(line.debit),   // swapped
                  description: `Reversal: ${line.description || "fee"}`,
                }))
              )
          }
        }
        // If no open period, skip the reversal silently — the user should be aware
        // the fee entry remains; we still allow the unmatch to proceed
      }
    }

    // Unmatch the transaction
    const { error: updateError } = await supabase
      .from("bank_transactions")
      .update({
        status: "unreconciled",
        matches: null,
        fee_journal_entry_id: null,
      })
      .eq("id", bank_transaction_id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ message: "Transaction unmatched successfully" })
  } catch (error: any) {
    console.error("Error unmatching transaction:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
