import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { buildCreditNoteDocumentHtml } from "@/lib/creditNotes/buildCreditNoteDocumentHtml"

/**
 * GET /api/credit-notes/[id]/pdf-preview
 *
 * **Authenticated only** — same business access rules as `GET /api/credit-notes/[id]`
 * (business owner or `business_users` member for the credit note’s `business_id`).
 *
 * This is **not** a public-token route; public viewing continues to use
 * `GET /api/credit-notes/public/[token]` (and any UI that consumes it).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const creditNoteId = resolvedParams.id

    if (!creditNoteId) {
      return NextResponse.json({ error: "Credit Note ID is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: cnRow, error: rowError } = await supabase
      .from("credit_notes")
      .select("id, business_id")
      .eq("id", creditNoteId)
      .is("deleted_at", null)
      .maybeSingle()

    if (rowError || !cnRow?.business_id) {
      return NextResponse.json({ error: "Credit note not found" }, { status: 404 })
    }

    const businessId = cnRow.business_id as string

    const { data: business } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", businessId)
      .maybeSingle()

    const isOwner = business?.owner_id === user.id
    if (!isOwner) {
      const { data: member } = await supabase
        .from("business_users")
        .select("id")
        .eq("business_id", businessId)
        .eq("user_id", user.id)
        .maybeSingle()
      if (!member) {
        return NextResponse.json(
          { error: "You do not have access to this credit note" },
          { status: 403 }
        )
      }
    }

    const built = await buildCreditNoteDocumentHtml(supabase, creditNoteId, {
      restrictBusinessId: businessId,
    })

    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: built.status })
    }

    return new NextResponse(built.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error: unknown) {
    console.error("Error generating credit note preview:", error)
    return NextResponse.json({ error: "Failed to generate preview" }, { status: 500 })
  }
}
