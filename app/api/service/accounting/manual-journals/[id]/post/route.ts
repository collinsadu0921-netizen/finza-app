import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceManualJournalAuthority } from "@/lib/service/accounting/manualJournalAuth"
import { mapServiceManualRpcError } from "@/lib/service/accounting/manualJournal"

export const dynamic = "force-dynamic"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { id } = await params

    const admin = createSupabaseAdminClient()
    const { data: draft, error: draftError } = await admin
      .from("service_manual_journal_drafts")
      .select("id,business_id,status,journal_entry_id")
      .eq("id", id)
      .maybeSingle()

    if (draftError) {
      console.error("Service manual journal post lookup failed:", draftError)
      return NextResponse.json({ error: "Unable to load the manual journal.", code: "SERVICE_MANUAL_POST_FAILED" }, { status: 500 })
    }
    if (!draft) {
      return NextResponse.json({ error: "Manual journal draft not found.", code: "DRAFT_NOT_FOUND" }, { status: 404 })
    }

    const authority = await resolveServiceManualJournalAuthority({
      supabase,
      userId: user?.id,
      businessId: draft.business_id,
      required: "write",
    })
    if (!authority.ok) return authority.response

    const { data: journalEntryId, error } = await supabase.rpc(
      "post_service_manual_journal_draft",
      { p_draft_id: id }
    )

    if (error) {
      console.error("Service manual journal post RPC failed:", error)
      const mapped = mapServiceManualRpcError(error.message)
      return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status })
    }
    if (!journalEntryId) {
      return NextResponse.json({ error: "The manual journal was not posted.", code: "SERVICE_MANUAL_POST_FAILED" }, { status: 500 })
    }

    return NextResponse.json({ success: true, journal_entry_id: journalEntryId })
  } catch (error: unknown) {
    console.error("Service manual journal post error:", error)
    return NextResponse.json({ error: "Unable to post the manual journal.", code: "SERVICE_MANUAL_POST_FAILED" }, { status: 500 })
  }
}
