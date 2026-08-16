/**
 * GET  /api/service/accounting/loans?business_id=
 *   Returns all loans for the business, each enriched with per-loan outstanding
 *   from loan_principal_ledger (subledger).
 *
 * POST /api/service/accounting/loans
 *   Atomically creates loan record + drawdown journal + subledger entry.
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
import {
  enforceServiceWorkspaceAccess,
  enforceServiceWorkspaceWriteAccess,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

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

    const enriched = await Promise.all(
      (loans as any[]).map(async (loan) => {
        const { data: outstanding, error: outError } = await supabase.rpc(
          "finza_loan_outstanding",
          { p_loan_id: loan.id }
        )

        if (outError) {
          console.error("finza_loan_outstanding error:", outError)
          return { ...loan, outstanding: loan.principal_amount }
        }

        return {
          ...loan,
          outstanding: Number(outstanding ?? loan.principal_amount),
        }
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

    const denied = await enforceServiceWorkspaceWriteAccess({
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

    const { data: accounts, error: accError } = await supabase
      .from("accounts")
      .select("id, type, sub_type")
      .eq("business_id", businessId)
      .is("deleted_at", null)

    if (accError) return NextResponse.json({ error: accError.message }, { status: 500 })

    const validationError = validateServiceIntent(intent, (accounts ?? []) as AccountForValidation[])
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

    const { data: result, error: rpcError } = await supabase.rpc(
      "create_loan_with_drawdown",
      {
        p_business_id:       businessId,
        p_user_id:           user.id,
        p_entry_date:        intent.entry_date,
        p_intent:            intent,
        p_lender_name:       body.lender_name?.trim() || null,
        p_interest_rate_pct: body.interest_rate_pct != null ? Number(body.interest_rate_pct) : null,
        p_notes:             body.notes?.trim() || null,
      }
    )

    if (rpcError) {
      const msg = rpcError.message || "Failed to create loan"
      if (msg.includes("locked") || msg.includes("period")) {
        return NextResponse.json({ error: "Cannot post to a locked period. Choose another date." }, { status: 400 })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const loanId = result?.loan_id
    const journalEntryId = result?.journal_entry_id

    if (!loanId || !journalEntryId) {
      return NextResponse.json({ error: "Loan creation did not return expected ids" }, { status: 500 })
    }

    const { data: loan, error: loanFetchError } = await supabase
      .from("loans")
      .select("*, loan_account:loan_account_id(id, name, code)")
      .eq("id", loanId)
      .single()

    if (loanFetchError) {
      return NextResponse.json({
        success: true,
        journal_entry_id: journalEntryId,
        loan_id: loanId,
        loan: null,
        warning: "Loan created but could not reload loan record",
      })
    }

    return NextResponse.json({
      success: true,
      journal_entry_id: journalEntryId,
      loan,
    })
  } catch (err: unknown) {
    console.error("Error in POST /loans:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
