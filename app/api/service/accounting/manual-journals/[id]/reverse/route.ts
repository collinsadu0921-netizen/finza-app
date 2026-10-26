import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceManualJournalAuthority } from "@/lib/service/accounting/manualJournalAuth"
import { getTrustedRequestMetadata } from "@/lib/audit/requestMetadata"
import { mapServiceManualRpcError } from "@/lib/service/accounting/manualJournal"

export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body.", code: "INVALID_JSON" }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data: original, error: originalError } = await admin
      .from("journal_entries")
      .select("id,business_id,source_type,date")
      .eq("id", id)
      .maybeSingle()

    if (originalError) {
      console.error("Service manual journal reversal lookup failed:", originalError)
      return NextResponse.json({ error: "Unable to load the journal.", code: "SERVICE_MANUAL_REVERSAL_FAILED" }, { status: 500 })
    }
    if (!original || original.source_type !== "service_manual") {
      return NextResponse.json({ error: "Posted manual journal not found.", code: "JOURNAL_NOT_FOUND" }, { status: 404 })
    }

    const authority = await resolveServiceManualJournalAuthority({
      supabase,
      userId: user?.id,
      businessId: original.business_id,
      required: "write",
    })
    if (!authority.ok) return authority.response

    const reversalDate = typeof body.reversal_date === "string" ? body.reversal_date.trim() : ""
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    const parsedReversalDate = new Date(`${reversalDate}T00:00:00Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(reversalDate) ||
      Number.isNaN(parsedReversalDate.getTime()) ||
      parsedReversalDate.toISOString().slice(0, 10) !== reversalDate
    ) {
      return NextResponse.json({ error: "A valid reversal date is required.", code: "REVERSAL_DATE_INVALID" }, { status: 400 })
    }
    if (reason.length < 10 || reason.length > 500) {
      return NextResponse.json({ error: "Reversal reason must be between 10 and 500 characters.", code: "REASON_INVALID" }, { status: 400 })
    }

    const requestMeta = getTrustedRequestMetadata(request)
    const { data: reversalId, error } = await admin.rpc(
      "reverse_service_manual_journal_with_request_metadata",
      {
        p_journal_entry_id: id,
        p_reversal_date: reversalDate,
        p_reason: reason,
        p_actor_user_id: user.id,
        p_request_ip: requestMeta.ipAddress,
        p_request_user_agent: requestMeta.userAgent,
      }
    )

    if (error) {
      console.error("Service manual journal reversal RPC failed:", error)
      const mapped = mapServiceManualRpcError(error.message)
      return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status })
    }
    if (!reversalId) {
      return NextResponse.json({ error: "The reversal was not posted.", code: "SERVICE_MANUAL_REVERSAL_FAILED" }, { status: 500 })
    }

    return NextResponse.json({ success: true, reversal_journal_entry_id: reversalId })
  } catch (error: unknown) {
    console.error("Service manual journal reversal error:", error)
    return NextResponse.json({ error: "Unable to reverse the manual journal.", code: "SERVICE_MANUAL_REVERSAL_FAILED" }, { status: 500 })
  }
}
