/**
 * POST /api/incoming-documents/[id]/extract
 * Re-runs OpenAI extraction into a new extraction row.
 * Accepted review fields are kept. Confirmation is required before replacing
 * the extraction basis when the user has already reviewed the document.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { getIncomingDocumentForBusiness } from "@/lib/documents/incomingDocumentsService"
import { reextractRequiresConfirmation } from "@/lib/documents/incomingOpenAiExtraction"
import { runPersistedOpenAiExtraction } from "@/lib/documents/runPersistedOpenAiExtraction"

export const runtime = "nodejs"
export const maxDuration = 60

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: documentId } = await context.params
  if (!documentId) return NextResponse.json({ error: "Missing document id" }, { status: 400 })

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  const role = await getUserRole(supabase, user.id, businessId)
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const row = await supabase
    .from("incoming_documents")
    .select("id, review_status, reviewed_fields, business_id")
    .eq("id", documentId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (!row.data) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const owned = await getIncomingDocumentForBusiness(supabase, documentId, businessId)
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const reviewedFields = (row.data.reviewed_fields as Record<string, unknown> | null) ?? null
  if (reextractRequiresConfirmation(row.data.review_status as string | null, reviewedFields) && body.confirm !== true) {
    return NextResponse.json(
      { error: "This document has reviewed fields. Confirm before reading it again.", needs_confirmation: true },
      { status: 409 }
    )
  }

  const result = await runPersistedOpenAiExtraction({
    supabase,
    userId: user.id,
    businessId,
    existingDocumentId: documentId,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus })
  }
  return NextResponse.json({
    ok: true,
    document_id: result.documentId,
    extraction_id: result.extractionId,
    mode: result.mode,
    reviewed_fields_preserved: true,
  })
}
