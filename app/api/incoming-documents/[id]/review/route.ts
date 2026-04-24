/**
 * POST /api/incoming-documents/[id]/review
 * Body: { business_id, action: "save_draft" | "accept", fields: Record<string, unknown> }
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import {
  acceptIncomingDocumentReview,
  saveIncomingDocumentReviewDraft,
} from "@/lib/documents/incomingDocumentsService"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: documentId } = await context.params
    if (!documentId) {
      return NextResponse.json({ error: "Missing document id" }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
    const action = typeof body.action === "string" ? body.action.trim() : ""
    const fields = body.fields && typeof body.fields === "object" && body.fields !== null
      ? (body.fields as Record<string, unknown>)
      : {}

    if (!businessId) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const role = await getUserRole(supabase, user.id, businessId)
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    if (action !== "save_draft" && action !== "accept") {
      return NextResponse.json({ error: "action must be save_draft or accept" }, { status: 400 })
    }

    const res =
      action === "accept"
        ? await acceptIncomingDocumentReview(supabase, {
            documentId,
            businessId,
            userId: user.id,
            fields,
          })
        : await saveIncomingDocumentReviewDraft(supabase, {
            documentId,
            businessId,
            userId: user.id,
            fields,
          })

    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[incoming-documents/review] POST", error)
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 })
  }
}
