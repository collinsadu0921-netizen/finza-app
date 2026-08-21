import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { inventoryLinkedJournalReversalBlock } from "@/lib/accounting/inventoryLinkedJournalReversal"
import {
  deniedMutationResponse,
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

const MIN_REASON_LENGTH = 10

/**
 * POST /api/accounting/reversal
 *
 * Practice: APPROVE required. Service owner/admin/write roles unchanged (approve maps to write).
 */
export async function POST(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("accounting_reversal")
  const respond = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0) }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    diag.recordTiming("auth", timedStepMs(tAuth), "session")

    if (!user) {
      return respond(
        { error: "Unauthorized", reason_code: "UNAUTHENTICATED" },
        401
      )
    }

    const body = await request.json().catch(() => ({}))
    const original_je_id = body.original_je_id as string | undefined
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    const reversal_date_param = body.reversal_date as string | undefined
    let businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""

    if (!original_je_id) {
      return NextResponse.json(
        { error: "original_je_id is required", reason_code: "JOURNAL_NOT_FOUND" },
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

    if (!businessId) {
      const { data: peek } = await supabase
        .from("journal_entries")
        .select("business_id")
        .eq("id", original_je_id)
        .maybeSingle()
      businessId = (peek?.business_id as string | undefined) ?? ""
    }

    if (!businessId) {
      return NextResponse.json(
        { error: "business_id is required", reason_code: "MISSING_BUSINESS_ID" },
        { status: 400 }
      )
    }

    const authResult = await resolveAccountingRequestAuthority({
      supabase,
      userId: user.id,
      businessId,
      requiredLevel: "approve",
      authorityContext: "practice-client-books",
    })
    if (authResult.timings) {
      diag.recordTiming("role", authResult.timings.role_ms)
      diag.recordTiming("authority", authResult.timings.authority_ms)
    }
    if (!authResult.ok) {
      const denied = deniedMutationResponse(authResult, "approve", "reverse this journal")
      return respond(denied.body, denied.status)
    }

    const dataClient = getAccountingDataClient(authResult, supabase)
    const resolvedBusinessId = authResult.businessId

    const tLookup = performance.now()
    const { data: originalJe, error: fetchError } = await dataClient
      .from("journal_entries")
      .select("id, business_id, date, description, period_id, reference_type, reference_id")
      .eq("id", original_je_id)
      .eq("business_id", resolvedBusinessId)
      .maybeSingle()

    if (fetchError) {
      console.error("Reversal: fetch original JE error", fetchError)
      return NextResponse.json(
        { error: "Failed to load journal entry", reason_code: "ACCOUNTING_DATA_UNAVAILABLE" },
        { status: 500 }
      )
    }

    if (!originalJe) {
      return NextResponse.json(
        { error: "Journal entry not found", reason_code: "JOURNAL_NOT_FOUND" },
        { status: 404 }
      )
    }
    diag.recordTiming("journal", timedStepMs(tLookup), "scoped")

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
        { error: inventoryBlock.error, code: inventoryBlock.code, reason_code: "JOURNAL_NOT_REVERSIBLE" },
        { status: 409 }
      )
    }

    // After journal + business scope is proven, these reads are independent.
    const tFollow = performance.now()
    const [existingRes, periodRes, linesRes] = await Promise.all([
      dataClient
        .from("journal_entries")
        .select("id")
        .eq("business_id", resolvedBusinessId)
        .eq("reference_type", "reversal")
        .eq("reference_id", original_je_id)
        .limit(1)
        .maybeSingle(),
      dataClient
        .from("accounting_periods")
        .select("id, status, period_start, period_end")
        .eq("business_id", resolvedBusinessId)
        .lte("period_start", reversal_date)
        .gte("period_end", reversal_date)
        .maybeSingle(),
      dataClient
        .from("journal_entry_lines")
        .select("id, account_id, debit, credit, description")
        .eq("journal_entry_id", original_je_id)
        .order("id"),
    ])
    diag.recordTiming("lookup", timedStepMs(tFollow), "reversal+period+lines")

    const existingReversal = existingRes.data
    if (existingReversal) {
      return NextResponse.json({
        reversal_journal_entry_id: existingReversal.id,
        original_journal_entry_id: original_je_id,
        already_reversed: true,
      })
    }

    const period = periodRes.data
    if (!period || period.status !== "open") {
      return NextResponse.json(
        {
          error: "Reversal date must fall within an open accounting period.",
          code: "PERIOD_NOT_OPEN",
          reason_code: "PERIOD_LOCKED",
        },
        { status: 400 }
      )
    }

    const lines = linesRes.data
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

    const tRpc = performance.now()
    const { data: journalEntryId, error: postError } = await dataClient.rpc("post_journal_entry", {
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

    diag.recordTiming("rpc", timedStepMs(tRpc), "post_journal_entry")
    if (postError) {
      console.error("Reversal: post_journal_entry error", postError)
      return respond(
        { error: postError.message || "Failed to post reversal journal entry" },
        500
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        { error: "Reversal posting did not return a journal entry id" },
        { status: 500 }
      )
    }

    const tAudit = performance.now()
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

    const refType = originalJe.reference_type as string | null
    const refId = originalJe.reference_id as string | null
    if (refType === "payment" && refId) {
      const { error: updatePaymentError } = await dataClient
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

    diag.recordTiming("audit", timedStepMs(tAudit))
    return respond({
      reversal_journal_entry_id: journalEntryId,
      original_journal_entry_id: original_je_id,
    }, 200)
  } catch (err: unknown) {
    console.error("Reversal API error:", err)
    return respond(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
}
