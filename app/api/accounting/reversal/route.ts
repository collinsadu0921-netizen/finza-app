import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { getTrustedRequestMetadata } from "@/lib/audit/requestMetadata"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { inventoryLinkedJournalReversalBlock } from "@/lib/accounting/inventoryLinkedJournalReversal"
import { mapServiceManualRpcError } from "@/lib/service/accounting/manualJournal"

const MIN_REASON_LENGTH = 10

type ReversalOriginal = {
  id: string
  business_id: string
  source_type: string | null
}

/**
 * Keep the Service manual-journal draft in sync with generic GL reversals.
 * The ledger reversal is already authoritative; this is display/link state only.
 */
async function linkServiceManualDraftToReversal(
  original: ReversalOriginal,
  reversalJournalEntryId: string
): Promise<void> {
  if (original.source_type !== "service_manual") return

  try {
    const admin = createSupabaseAdminClient()
    const { error } = await admin
      .from("service_manual_journal_drafts")
      .update({
        status: "reversed",
        reversal_journal_entry_id: reversalJournalEntryId,
      })
      .eq("journal_entry_id", original.id)
      .eq("business_id", original.business_id)
      .neq("status", "reversed")

    if (error) {
      console.error("Reversal: failed to link Service manual draft:", error)
    }
  } catch (error) {
    console.error("Reversal: failed to link Service manual draft:", error)
  }
}

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
      .select("id, business_id, date, description, period_id, source_type, reference_type, reference_id")
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

    const tierBlockRev = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlockRev) return tierBlockRev

    const inventoryBlock = inventoryLinkedJournalReversalBlock(
      originalJe.reference_type as string | null
    )
    if (inventoryBlock) {
      return NextResponse.json(
        { error: inventoryBlock.error, code: inventoryBlock.code },
        { status: 409 }
      )
    }

    // Service manual journals use the Service authority, draft linkage and
    // audit rules. Keep the ledger route as the entry point for the Service
    // admin/accountant who clicked Reverse in the General Ledger.
    if (originalJe.source_type === "service_manual") {
      const { data: existingServiceReversal } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("business_id", resolvedBusinessId)
        .eq("reference_type", "reversal")
        .eq("reference_id", original_je_id)
        .limit(1)
        .maybeSingle()

      if (existingServiceReversal) {
        await linkServiceManualDraftToReversal(
          originalJe as ReversalOriginal,
          existingServiceReversal.id
        )
        return NextResponse.json({
          reversal_journal_entry_id: existingServiceReversal.id,
          original_journal_entry_id: original_je_id,
          already_reversed: true,
        })
      }

      const requestMeta = getTrustedRequestMetadata(request)
      const admin = createSupabaseAdminClient()
      const { data: serviceReversalId, error: serviceReversalError } = await admin.rpc(
        "reverse_service_manual_journal_with_request_metadata",
        {
          p_journal_entry_id: original_je_id,
          p_reversal_date: reversal_date,
          p_reason: reason,
          p_actor_user_id: user.id,
          p_request_ip: requestMeta.ipAddress,
          p_request_user_agent: requestMeta.userAgent,
        }
      )

      if (serviceReversalError || !serviceReversalId) {
        const mapped = mapServiceManualRpcError(serviceReversalError?.message || null)
        if (mapped.code === "ALREADY_REVERSED") {
          const { data: racedServiceReversal } = await supabase
            .from("journal_entries")
            .select("id")
            .eq("business_id", resolvedBusinessId)
            .eq("reference_type", "reversal")
            .eq("reference_id", original_je_id)
            .limit(1)
            .maybeSingle()

          if (racedServiceReversal) {
            await linkServiceManualDraftToReversal(
              originalJe as ReversalOriginal,
              racedServiceReversal.id
            )
            return NextResponse.json({
              reversal_journal_entry_id: racedServiceReversal.id,
              original_journal_entry_id: original_je_id,
              already_reversed: true,
            })
          }
        }

        return NextResponse.json(
          { error: mapped.message, code: mapped.code, reason_code: "JOURNAL_NOT_REVERSIBLE" },
          { status: mapped.status }
        )
      }

      await linkServiceManualDraftToReversal(
        originalJe as ReversalOriginal,
        serviceReversalId
      )
      return NextResponse.json({
        reversal_journal_entry_id: serviceReversalId,
        original_journal_entry_id: original_je_id,
      })
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

    const requestMeta = getTrustedRequestMetadata(request)
    const admin = createSupabaseAdminClient()
    const { data: journalEntryId, error: postError } = await admin.rpc("post_journal_entry_with_request_metadata", {
      p_business_id: resolvedBusinessId,
      p_date: reversal_date,
      p_description: description,
      p_reference_type: "reversal",
      p_reference_id: original_je_id,
      p_reverses_entry_id: original_je_id,
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
      p_request_ip: requestMeta.ipAddress,
      p_request_user_agent: requestMeta.userAgent,
    })

    if (postError) {
      const message = postError.message || "Failed to post reversal journal entry"

      // A concurrent/retried reversal can lose the race after the pre-check.
      // Reconcile to the existing reversal instead of returning an opaque 500.
      if (
        message.includes("SERVICE_MANUAL_ALREADY_REVERSED") ||
        message.includes("REVERSAL_ALREADY_EXISTS") ||
        message.toLowerCase().includes("duplicate key")
      ) {
        const { data: racedReversal } = await supabase
          .from("journal_entries")
          .select("id")
          .eq("business_id", resolvedBusinessId)
          .eq("reference_type", "reversal")
          .eq("reference_id", original_je_id)
          .limit(1)
          .maybeSingle()

        if (racedReversal) {
          await linkServiceManualDraftToReversal(
            originalJe as ReversalOriginal,
            racedReversal.id
          )
          return NextResponse.json({
            reversal_journal_entry_id: racedReversal.id,
            original_journal_entry_id: original_je_id,
            already_reversed: true,
          })
        }
      }

      console.error("Reversal: post_journal_entry error", postError)
      return NextResponse.json(
        { error: message },
        { status: 500 }
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        { error: "Reversal posting did not return a journal entry id" },
        { status: 500 }
      )
    }

    await linkServiceManualDraftToReversal(
      originalJe as ReversalOriginal,
      journalEntryId
    )

    // The reversal audit row is written atomically by the journal_entries
    // reversal trigger in migration 600. Do not write a second audit row here.

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
