/**
 * GET /api/incoming-documents/[id]?business_id=
 * Debug / inspection: document row + latest extraction (requires business access).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { getIncomingDocumentWithLatestExtraction } from "@/lib/documents/incomingDocumentsService"

type RouteContext = { params: Promise<{ id: string }> }

const DELETABLE_FORM_SOURCES = new Set(["expense_form_upload", "bill_form_upload"])

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

/**
 * DELETE /api/incoming-documents/[id]?business_id=
 * Removes an uploaded-but-unlinked document from expense/bill create flows (safe cleanup).
 * Does not delete linked or manually ingested documents.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
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

    const { data: doc, error: loadErr } = await supabase
      .from("incoming_documents")
      .select("id, business_id, source_type, status, linked_entity_id, linked_entity_type, storage_bucket, storage_path")
      .eq("id", documentId)
      .eq("business_id", businessId)
      .maybeSingle()

    if (loadErr || !doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    if (doc.linked_entity_id != null) {
      return NextResponse.json(
        { error: "This document is linked to a saved record and cannot be deleted." },
        { status: 409 }
      )
    }
    if (doc.status === "linked") {
      return NextResponse.json(
        { error: "This document is marked as linked and cannot be deleted." },
        { status: 409 }
      )
    }
    if (!DELETABLE_FORM_SOURCES.has(String(doc.source_type))) {
      return NextResponse.json(
        { error: "Only expense or bill form uploads can be removed with this action." },
        { status: 403 }
      )
    }

    const bucket = String(doc.storage_bucket || "receipts")
    const path = String(doc.storage_path || "")
    if (bucket && path) {
      const { error: rmErr } = await supabase.storage.from(bucket).remove([path])
      if (rmErr) {
        console.warn("[incoming-documents] DELETE storage remove:", rmErr.message)
      }
    }

    const { error: delErr } = await supabase.from("incoming_documents").delete().eq("id", documentId).eq("business_id", businessId)

    if (delErr) {
      console.error("[incoming-documents] DELETE row:", delErr)
      return NextResponse.json({ error: delErr.message || "Delete failed" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[incoming-documents] DELETE", error)
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 })
  }
}
