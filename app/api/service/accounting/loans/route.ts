/**
 * GET  /api/service/accounting/loans?business_id=
 *   Returns all loans for the business, each enriched with an outstanding
 *   balance derived from ledger movements on the loan account.
 *
 * POST /api/service/accounting/loans
 *   Creates a loan record AND posts the drawdown journal entry.
 *   Body: { business_id, lender_name?, interest_rate_pct?, notes?,
 *           intent: LoanDrawdownIntent }
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import {
  type LoanDrawdownIntent,
  validateServiceIntent,
  type AccountForValidation,
} from "@/lib/service/accounting/intentTypes"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 })

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "business",
    })
    if (denied) return denied

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    // Fetch loans
    const { data: loans, error: loansError } = await supabase
      .from("loans")
      .select("*, loan_account:loan_account_id(id, name, code)")
      .eq("business_id", businessId)
      .order("start_date", { ascending: false })

    if (loansError) {
      console.error("Error fetching loans:", loansError)
      return NextResponse.json({ error: loansError.message }, { status: 500 })
    }

    if (!loans || loans.length === 0) {
      return NextResponse.json({ loans: [] })
    }

    // Compute outstanding balance for each loan from ledger movements on the loan account
    const enriched = await Promise.all(
      (loans as any[]).map(async (loan) => {
        if (!loan.loan_account_id) {
          return { ...loan, outstanding: loan.principal_amount }
        }

        // Get all JE IDs for this business since start_date
        const { data: jeIds } = await supabase
          .from("journal_entries")
          .select("id")
          .eq("business_id", businessId)
          .gte("date", loan.start_date)

        if (!jeIds || jeIds.length === 0) {
          return { ...loan, outstanding: loan.principal_amount }
        }

        const { data: lines } = await supabase
          .from("journal_entry_lines")
          .select("debit, credit")
          .eq("account_id", loan.loan_account_id)
          .in("journal_entry_id", jeIds.map((j: any) => j.id))

        // Loan account is a liability: credits increase, debits decrease
        const credits = (lines ?? []).reduce((s: number, l: any) => s + Number(l.credit || 0), 0)
        const debits  = (lines ?? []).reduce((s: number, l: any) => s + Number(l.debit  || 0), 0)
        const outstanding = Math.max(0, credits - debits)

        return { ...loan, outstanding }
      })
    )

    return NextResponse.json({ loans: enriched })
  } catch (err: unknown) {
    console.error("Error in GET /loans:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const businessId: string | undefined = body.business_id
    if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 })

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "business",
    })
    if (denied) return denied

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "write")
    if (!auth.authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const intent = body.intent as LoanDrawdownIntent
    if (!intent || intent.intent_type !== "LOAN_DRAWDOWN") {
      return NextResponse.json({ error: "intent must be a LOAN_DRAWDOWN" }, { status: 400 })
    }

    // Validate intent against COA
    const { data: accounts, error: accError } = await supabase
      .from("accounts")
      .select("id, type, sub_type")
      .eq("business_id", businessId)
      .is("deleted_at", null)

    if (accError) return NextResponse.json({ error: accError.message }, { status: 500 })

    const validationError = validateServiceIntent(intent, (accounts ?? []) as AccountForValidation[])
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

    // Post the drawdown journal entry
    const { data: journalEntryId, error: rpcError } = await supabase.rpc(
      "post_service_intent_to_ledger",
      {
        p_business_id: businessId,
        p_user_id:     user.id,
        p_entry_date:  intent.entry_date,
        p_intent:      intent,
      }
    )

    if (rpcError) {
      const msg = rpcError.message || "Failed to post to ledger"
      if (msg.includes("locked") || msg.includes("period")) {
        return NextResponse.json({ error: "Cannot post to a locked period. Choose another date." }, { status: 400 })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    if (!journalEntryId) {
      return NextResponse.json({ error: "Posting did not return a journal entry" }, { status: 500 })
    }

    // Save the loan record
    const { data: loan, error: loanError } = await supabase
      .from("loans")
      .insert({
        business_id:               businessId,
        lender_name:               body.lender_name?.trim() || null,
        principal_amount:          intent.amount,
        interest_rate_pct:         body.interest_rate_pct != null ? Number(body.interest_rate_pct) : null,
        start_date:                intent.entry_date,
        loan_account_id:           intent.loan_account_id,
        drawdown_journal_entry_id: journalEntryId,
        notes:                     body.notes?.trim() || null,
      })
      .select()
      .single()

    if (loanError) {
      console.error("Loan record insert failed (JE already posted):", loanError)
      // JE is posted — return success with a warning rather than failing
      return NextResponse.json({
        success: true,
        journal_entry_id: journalEntryId,
        loan: null,
        warning: "Journal entry posted but loan record could not be saved: " + loanError.message,
      })
    }

    return NextResponse.json({ success: true, journal_entry_id: journalEntryId, loan })
  } catch (err: unknown) {
    console.error("Error in POST /loans:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
