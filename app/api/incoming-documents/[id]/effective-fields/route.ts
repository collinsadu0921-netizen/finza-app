/**
 * GET /api/incoming-documents/[id]/effective-fields?business_id=
 * Returns machine parse + review overlay for expense/bill prefill (Stage 2).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { getIncomingDocumentWithLatestExtraction } from "@/lib/documents/incomingDocumentsService"
import {
  buildEffectiveParsedFields,
  preferAcceptedReview,
} from "@/lib/documents/effectiveIncomingFields"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
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

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")?.trim() ?? ""
    if (!businessId) {
      return NextResponse.json({ error: "business_id query parameter is required" }, { status: 400 })
    }

    const role = await getUserRole(supabase, user.id, businessId)
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const payload = await getIncomingDocumentWithLatestExtraction(supabase, documentId, businessId)
    if (!payload) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const doc = payload.document as Record<string, unknown>
    const ext = payload.latest_extraction as Record<string, unknown> | null
    const machineParsed = (ext?.parsed_json as Record<string, unknown> | null) ?? null
    const reviewedFields = (doc.reviewed_fields as Record<string, unknown> | null) ?? null
    const reviewStatus = (doc.review_status as string | null) ?? "none"

    const effective_fields = buildEffectiveParsedFields({
      machineParsed,
      reviewedFields,
      reviewStatus,
    })
    const accepted_only_fields = preferAcceptedReview({
      machineParsed,
      reviewedFields,
      reviewStatus,
    })

    return NextResponse.json({
      document_id: documentId,
      review_status: reviewStatus,
      document_status: doc.status,
      machine_parsed: machineParsed ?? {},
      confidence: (ext?.confidence_json as Record<string, unknown> | null) ?? {},
      reviewed_fields: reviewedFields ?? {},
      effective_fields,
      /** Use for automated downstream flows that should only trust accepted review */
      accepted_only_fields,
      raw_text_preview: typeof ext?.raw_text === "string" ? String(ext.raw_text).slice(0, 2000) : null,
      extraction_mode: ext?.extraction_mode ?? null,
      extraction_warnings: ext?.extraction_warnings ?? [],
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[incoming-documents/effective-fields] GET", error)
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 })
  }
}
