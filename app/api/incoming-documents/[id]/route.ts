/**
 * GET /api/incoming-documents/[id]?business_id=
 * Debug / inspection: document row + latest extraction (requires business access).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { getIncomingDocumentWithLatestExtraction } from "@/lib/documents/incomingDocumentsService"

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
    const bucket = String(doc.storage_bucket ?? "receipts")
    const path = String(doc.storage_path ?? "")
    let preview_url: string | null = null
    if (bucket && path) {
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
      preview_url = signed?.signedUrl ?? null
    }

    return NextResponse.json({ ...payload, preview_url })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[incoming-documents] GET", error)
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 })
  }
}
