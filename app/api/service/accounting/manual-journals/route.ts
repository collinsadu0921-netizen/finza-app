import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceManualJournalAuthority } from "@/lib/service/accounting/manualJournalAuth"
import { resolveAuditActors } from "@/lib/audit/resolveAuditActors"
import {
  mapServiceManualRpcError,
  validateServiceManualAccounts,
  validateServiceManualJournalInput,
  type ServiceManualJournalAccount,
} from "@/lib/service/accounting/manualJournal"

export const dynamic = "force-dynamic"

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")?.trim() || null

    const authority = await resolveServiceManualJournalAuthority({
      supabase,
      userId: user?.id,
      businessId,
      required: "read",
    })
    if (!authority.ok) return authority.response

    const admin = createSupabaseAdminClient()
    const [draftsResult, accountsResult, periodsResult] = await Promise.all([
      admin
        .from("service_manual_journal_drafts")
        .select(
          "id,business_id,entry_date,description,reference,lines,total_debit,total_credit,status,created_by,created_at,updated_at,posted_by,posted_at,journal_entry_id,reversal_journal_entry_id"
        )
        .eq("business_id", authority.businessId)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("accounts")
        .select("id,business_id,code,name,type,sub_type,is_system,is_postable,deleted_at")
        .eq("business_id", authority.businessId)
        .is("deleted_at", null)
        .order("code", { ascending: true }),
      admin
        .from("accounting_periods")
        .select("id,period_start,period_end,status")
        .eq("business_id", authority.businessId)
        .eq("status", "open")
        .order("period_start", { ascending: false }),
    ])

    if (draftsResult.error || accountsResult.error || periodsResult.error) {
      console.error("Service manual journal list failed:", {
        drafts: draftsResult.error?.message,
        accounts: accountsResult.error?.message,
        periods: periodsResult.error?.message,
      })
      return jsonError(500, "SERVICE_MANUAL_LIST_FAILED", "Unable to load manual journals.")
    }

    const drafts = draftsResult.data || []
    const actorIds = drafts.flatMap((draft) => [draft.created_by, draft.posted_by])
    const actors = await resolveAuditActors(admin, authority.businessId, actorIds)
    const draftsWithActors = drafts.map((draft) => {
      const createdBy = draft.created_by ? actors.get(draft.created_by) : null
      const postedBy = draft.posted_by ? actors.get(draft.posted_by) : null
      return {
        ...draft,
        created_by_display: createdBy?.label ?? null,
        posted_by_display: postedBy?.label ?? null,
      }
    })

    return NextResponse.json({
      drafts: draftsWithActors,
      accounts: accountsResult.data || [],
      periods: periodsResult.data || [],
      role: authority.role,
      canWrite: authority.canWrite,
      defaultCurrency: authority.defaultCurrency,
    })
  } catch (error: unknown) {
    console.error("Service manual journal list error:", error)
    return jsonError(500, "SERVICE_MANUAL_LIST_FAILED", "Unable to load manual journals.")
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return jsonError(400, "INVALID_JSON", "Invalid JSON body.")
    }

    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
    const authority = await resolveServiceManualJournalAuthority({
      supabase,
      userId: user?.id,
      businessId,
      required: "write",
    })
    if (!authority.ok) return authority.response

    const validation = validateServiceManualJournalInput({
      entry_date: body.entry_date,
      description: body.description,
      reference: body.reference,
      lines: body.lines,
    })
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.message, code: validation.code, field: validation.field },
        { status: 400 }
      )
    }

    const rawIdempotencyKey = request.headers.get("idempotency-key") ?? body.idempotency_key
    const idempotencyKey = typeof rawIdempotencyKey === "string" ? rawIdempotencyKey.trim() : ""
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return jsonError(400, "IDEMPOTENCY_REQUIRED", "An idempotency key is required.")
    }

    const admin = createSupabaseAdminClient()
    const accountIds = [...new Set(validation.lines.map((line) => line.account_id))]

    const { data: accountRows, error: accountError } = await admin
      .from("accounts")
      .select("id,business_id,code,name,type,sub_type,is_system,is_postable,deleted_at")
      .eq("business_id", authority.businessId)
      .in("id", accountIds)

    if (accountError) {
      console.error("Service manual journal account lookup failed:", accountError)
      return jsonError(500, "ACCOUNT_LOOKUP_FAILED", "Unable to validate accounts.")
    }

    const accountValidation = validateServiceManualAccounts({
      businessId: authority.businessId,
      lines: validation.lines,
      accounts: (accountRows || []) as ServiceManualJournalAccount[],
    })
    if (!accountValidation.ok) {
      return jsonError(400, accountValidation.code, accountValidation.message)
    }

    const { data: period, error: periodError } = await admin
      .from("accounting_periods")
      .select("id,status,period_start,period_end")
      .eq("business_id", authority.businessId)
      .lte("period_start", validation.entryDate)
      .gte("period_end", validation.entryDate)
      .maybeSingle()

    if (periodError) {
      console.error("Service manual journal period lookup failed:", periodError)
      return jsonError(500, "PERIOD_LOOKUP_FAILED", "Unable to validate the accounting period.")
    }
    if (!period) {
      return jsonError(400, "PERIOD_NOT_FOUND", "No accounting period covers that entry date.")
    }
    if (period.status !== "open") {
      return jsonError(400, "PERIOD_NOT_OPEN", "The accounting period is not open for posting.")
    }

    const { data: draftId, error: rpcError } = await supabase.rpc(
      "create_service_manual_journal_draft",
      {
        p_business_id: authority.businessId,
        p_entry_date: validation.entryDate,
        p_description: validation.description,
        p_reference: validation.reference,
        p_lines: validation.lines,
        p_idempotency_key: idempotencyKey,
      }
    )

    if (rpcError) {
      console.error("Service manual journal create RPC failed:", rpcError)
      const mapped = mapServiceManualRpcError(rpcError.message)
      return jsonError(mapped.status, mapped.code, mapped.message)
    }
    if (!draftId) {
      return jsonError(500, "SERVICE_MANUAL_CREATE_FAILED", "The manual journal draft was not created.")
    }

    return NextResponse.json({ success: true, draft_id: draftId }, { status: 201 })
  } catch (error: unknown) {
    console.error("Service manual journal create error:", error)
    return jsonError(500, "SERVICE_MANUAL_CREATE_FAILED", "Unable to create the manual journal draft.")
  }
}
