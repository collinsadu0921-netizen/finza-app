import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { logAudit } from "@/lib/auditLog"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

const MIN_REASON_LENGTH = 10

/**
 * POST /api/accounting/reversal
 *
 * Creates a reversal journal entry for a posted JE.
 * - New JE with reference_type='reversal', reference_id=original_je_id
 * - Lines: same accounts, debit/credit swapped
 * - Double-reversal guard: if already reversed, returns existing reversal JE id
 * - Period: reversal_date must fall in an open period
 * - No mutation of original journal entry
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const body = await request.json().catch(() => ({}))
    const original_je_id = body.original_je_id as string | undefined
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    const reversal_date_param = body.reversal_date as string | undefined

    if (!original_je_id) {
      return NextResponse.json(
        { error: "original_je_id is required" },
        { status: 400 }
      )
    }

    if (!reason || reason.length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        { error: `Reason is required and must be at least ${MIN_REASON_LENGTH} characters` },
        { status: 400 }
      )
    }

    const reversal_date = reversal_date_param
      ? reversal_date_param.slice(0, 10)
      : new Date().toISOString().slice(0, 10)
    const reversalDateObj = new Date(reversal_date)
    if (isNaN(reversalDateObj.getTime())) {
      return NextResponse.json(
        { error: "Invalid reversal_date format. Use YYYY-MM-DD." },
        { status: 400 }
      )
    }

    const { data: originalJe, error: fetchError } = await supabase
      .from("journal_entries")
      .select("id, business_id, date, description, period_id, reference_type, reference_id")
      .eq("id", original_je_id)
      .maybeSingle()

    if (fetchError) {
      console.error("Reversal: fetch original JE error", fetchError)
      return NextResponse.json(
        { error: "Failed to load journal entry" },
        { status: 500 }
      )
    }

    if (!originalJe) {
      return NextResponse.json(
        { error: "Journal entry not found" },
        { status: 404 }
      )
    }

    const businessId = originalJe.business_id as string
    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: businessId }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId
    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "You do not have permission to reverse journal entries for this business." },
        { status: 403 }
      )
    }

    const { data: existingReversal } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("business_id", resolvedBusinessId)
      .eq("reference_type", "reversal")
      .eq("reference_id", original_je_id)
      .limit(1)
      .maybeSingle()

    if (existingReversal) {
      return NextResponse.json({
        reversal_journal_entry_id: existingReversal.id,
        original_journal_entry_id: original_je_id,
        already_reversed: true,
      })
    }

    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, status, period_start, period_end")
      .eq("business_id", resolvedBusinessId)
      .lte("period_start", reversal_date)
      .gte("period_end", reversal_date)
      .maybeSingle()

    if (!period || period.status !== "open") {
      return NextResponse.json(
        {
          error: "Reversal date must fall within an open accounting period.",
          code: "PERIOD_NOT_OPEN",
        },
        { status: 400 }
      )
    }

    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("id, account_id, debit, credit, description")
      .eq("journal_entry_id", original_je_id)
      .order("id")

    if (!lines || lines.length < 2) {
      return NextResponse.json(
        { error: "Original journal entry has no lines or insufficient lines to reverse." },
        { status: 400 }
      )
    }

    const reversalLines = lines.map(
      (line: { account_id: string; debit: number; credit: number; description: string | null }) => ({
        account_id: line.account_id,
        debit: Number(line.credit) || 0,
        credit: Number(line.debit) || 0,
        description: line.description ?? "Reversal",
      })
    )

    const description = `Reversal of JE ${original_je_id.slice(0, 8)}: ${reason.slice(0, 200)}`
    const p_lines = reversalLines.map((l) => ({
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    }))

    const { data: journalEntryId, error: postError } = await supabase.rpc("post_journal_entry", {
      p_business_id: resolvedBusinessId,
      p_date: reversal_date,
      p_description: description,
      p_reference_type: "reversal",
      p_reference_id: original_je_id,
      p_lines,
      p_is_adjustment: true,
      p_adjustment_reason: reason,
      p_adjustment_ref: null,
      p_created_by: user.id,
      p_entry_type: null,
      p_backfill_reason: null,
      p_backfill_actor: null,
      p_posted_by_accountant_id: user.id,
      p_posting_source: "accountant",
      p_is_revenue_correction: false,
    })

    if (postError) {
      console.error("Reversal: post_journal_entry error", postError)
      return NextResponse.json(
        { error: postError.message || "Failed to post reversal journal entry" },
        { status: 500 }
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        { error: "Reversal posting did not return a journal entry id" },
        { status: 500 }
      )
    }

    await logAudit({
      businessId: resolvedBusinessId,
      userId: user.id,
      actionType: "reversal",
      entityType: "journal_entry",
      entityId: original_je_id,
      description: reason,
      newValues: {
        reversal_je_id: journalEntryId,
        business_id: resolvedBusinessId,
        period_id: period.id,
      },
      request,
    })

    // BUG 1 FIX: When reversing a payment JE, sync invoice status by soft-deleting
    // the payment. Ledger already reflects reversal (reversal JE); payments table
    // must be updated so recalculate_invoice_status (triggered on payment delete)
    // reverts invoice status/amount_paid.
    const refType = originalJe.reference_type as string | null
    const refId = originalJe.reference_id as string | null
    if (refType === "payment" && refId) {
      const { error: updatePaymentError } = await supabase
        .from("payments")
        .update({
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", refId)
        .eq("business_id", resolvedBusinessId)
        .is("deleted_at", null)

      if (updatePaymentError) {
        console.error("Reversal: soft-delete payment after reversal JE failed", updatePaymentError)
        return NextResponse.json(
          {
            error:
              "Reversal journal entry was posted but invoice status could not be updated. Please contact support.",
            reversal_journal_entry_id: journalEntryId,
            original_journal_entry_id: original_je_id,
          },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      reversal_journal_entry_id: journalEntryId,
      original_journal_entry_id: original_je_id,
    })
  } catch (err: unknown) {
    console.error("Reversal API error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
