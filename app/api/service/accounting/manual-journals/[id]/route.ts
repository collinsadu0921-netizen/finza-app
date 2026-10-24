import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceManualJournalAuthority } from "@/lib/service/accounting/manualJournalAuth"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { id } = await params
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
    const { data: draft, error } = await admin
      .from("service_manual_journal_drafts")
      .select(
        "id,business_id,entry_date,description,reference,lines,total_debit,total_credit,status,created_by,created_at,updated_at,posted_by,posted_at,journal_entry_id,reversal_journal_entry_id"
      )
      .eq("id", id)
      .eq("business_id", authority.businessId)
      .maybeSingle()

    if (error) {
      console.error("Service manual journal detail failed:", error)
      return NextResponse.json({ error: "Unable to load the manual journal.", code: "SERVICE_MANUAL_DETAIL_FAILED" }, { status: 500 })
    }
    if (!draft) {
      return NextResponse.json({ error: "Manual journal draft not found.", code: "DRAFT_NOT_FOUND" }, { status: 404 })
    }

    const lineAccountIds = [...new Set(((draft.lines as any[]) || []).map((line) => line?.account_id).filter(Boolean))]
    const { data: accounts } = await admin
      .from("accounts")
      .select("id,code,name,type,sub_type")
      .eq("business_id", authority.businessId)
      .in("id", lineAccountIds)

    let journalEntry: any = null
    if (draft.journal_entry_id) {
      const { data: je } = await admin
        .from("journal_entries")
        .select("id,date,description,reference,reference_type,reference_id,reverses_entry_id,source_type,currency,fx_rate,created_by,posted_by,created_at")
        .eq("id", draft.journal_entry_id)
        .eq("business_id", authority.businessId)
        .maybeSingle()
      if (je) {
        const { data: lines } = await admin
          .from("journal_entry_lines")
          .select("id,account_id,debit,credit,description")
          .eq("journal_entry_id", je.id)
          .order("id")
        journalEntry = { ...je, lines: lines || [] }
      }
    }

    return NextResponse.json({
      draft,
      accounts: accounts || [],
      journal_entry: journalEntry,
      canWrite: authority.canWrite,
    })
  } catch (error: unknown) {
    console.error("Service manual journal detail error:", error)
    return NextResponse.json({ error: "Unable to load the manual journal.", code: "SERVICE_MANUAL_DETAIL_FAILED" }, { status: 500 })
  }
}
