import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

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

    const tierBlockMt = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      business.id
    )
    if (tierBlockMt) return tierBlockMt

    const body = await request.json()
    const {
      bank_transaction_id,
      system_transaction_ids,
      // Optional: fee absorption for payment processor net settlements
      fee_amount,
      fee_account_id,
      transaction_date,
    } = body

    if (!bank_transaction_id || !system_transaction_ids || !Array.isArray(system_transaction_ids) || system_transaction_ids.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Verify bank transaction belongs to this business and account
    const { data: bankTransaction } = await supabase
      .from("bank_transactions")
      .select("id, date")
      .eq("id", bank_transaction_id)
      .eq("business_id", business.id)
      .eq("account_id", accountId)
      .single()

    if (!bankTransaction) {
      return NextResponse.json({ error: "Bank transaction not found" }, { status: 404 })
    }

    // ── Optional: post fee journal entry for payment processor difference ────
    let feeJournalEntryId: string | null = null
    const hasFee = fee_amount && Number(fee_amount) > 0 && fee_account_id

    if (hasFee) {
      const txnDate = transaction_date || bankTransaction.date || new Date().toISOString().slice(0, 10)

      // Find an open accounting period that covers the transaction date
      const { data: period } = await supabase
        .from("accounting_periods")
        .select("id, status")
        .eq("business_id", business.id)
        .lte("period_start", txnDate)
        .gte("period_end", txnDate)
        .neq("status", "locked")
        .order("period_start", { ascending: false })
        .limit(1)
        .single()

      if (!period) {
        return NextResponse.json(
          { error: "No open accounting period found for this transaction date. Open or create a period first." },
          { status: 400 }
        )
      }

      // Post fee JE: Dr fee_account (expense) / Cr bank account
      const { data: je, error: jeError } = await supabase
        .from("journal_entries")
        .insert({
          business_id: business.id,
          date: txnDate,
          description: "Payment processing fee — bank reconciliation",
          reference_type: "bank_reconciliation",
          source_type: "adjustment",
          period_id: period.id,
          created_by: user.id,
          posted_by: user.id,
          posting_source: "system",
        })
        .select("id")
        .single()

      if (jeError || !je) {
        return NextResponse.json({ error: jeError?.message || "Failed to post fee journal entry" }, { status: 500 })
      }

      // Dr expense account (the fee cost) / Cr bank account (net settlement reduces the system balance)
      const { error: linesError } = await supabase
        .from("journal_entry_lines")
        .insert([
          {
            journal_entry_id: je.id,
            account_id: fee_account_id,
            debit: Number(fee_amount),
            credit: 0,
            description: "Payment processing fee",
          },
          {
            journal_entry_id: je.id,
            account_id: accountId,
            debit: 0,
            credit: Number(fee_amount),
            description: "Net settlement fee adjustment",
          },
        ])

      if (linesError) {
        await supabase.from("journal_entries").delete().eq("id", je.id)
        return NextResponse.json({ error: linesError.message }, { status: 500 })
      }

      feeJournalEntryId = je.id
    }

    // ── Mark bank transaction as matched ─────────────────────────────────────
    const { error: updateError } = await supabase
      .from("bank_transactions")
      .update({
        status: "matched",
        matches: system_transaction_ids,
        fee_journal_entry_id: feeJournalEntryId,
      })
      .eq("id", bank_transaction_id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      message: "Transactions matched successfully",
      fee_journal_entry_id: feeJournalEntryId,
    })
  } catch (error: any) {
    console.error("Error matching transactions:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
