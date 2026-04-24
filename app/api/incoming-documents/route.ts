/**
 * GET  /api/incoming-documents — list summaries (Stage 3 workspace)
 * POST /api/incoming-documents — register upload before OCR
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { createIncomingDocumentRow } from "@/lib/documents/incomingDocumentsService"
import type { IncomingDocumentKind, IncomingDocumentSourceType } from "@/lib/documents/incomingDocumentTypes"
import {
  listIncomingDocumentSummaries,
  parseIncomingDocumentsListQuery,
} from "@/lib/documents/incomingDocumentsList"

const ALLOWED_BUCKETS = new Set(["receipts"])

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = parseIncomingDocumentsListQuery(new URL(request.url).searchParams)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const role = await getUserRole(supabase, user.id, parsed.params.businessId)
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const { summaries, total } = await listIncomingDocumentSummaries(supabase, parsed.params)
    return NextResponse.json({
      documents: summaries,
      total,
      limit: parsed.params.limit,
      offset: parsed.params.offset,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[incoming-documents] GET", error)
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const business_id = typeof body.business_id === "string" ? body.business_id.trim() : ""
    const storage_bucket = typeof body.storage_bucket === "string" ? body.storage_bucket.trim() : ""
    const storage_path = typeof body.storage_path === "string" ? body.storage_path.trim() : ""
    const source_type = body.source_type as IncomingDocumentSourceType | undefined
    const document_kind = (body.document_kind as IncomingDocumentKind | undefined) ?? "unknown"
    const file_name = typeof body.file_name === "string" ? body.file_name : null
    const mime_type = typeof body.mime_type === "string" ? body.mime_type : null
    const file_size = typeof body.file_size === "number" && Number.isFinite(body.file_size) ? body.file_size : null

    if (!business_id || !storage_bucket || !storage_path) {
      return NextResponse.json(
        { error: "business_id, storage_bucket, and storage_path are required" },
        { status: 400 }
      )
    }

    if (!ALLOWED_BUCKETS.has(storage_bucket)) {
      return NextResponse.json({ error: "storage_bucket must be receipts for this stage" }, { status: 400 })
    }

    const allowedSources: IncomingDocumentSourceType[] = [
      "manual_upload",
      "expense_form_upload",
      "bill_form_upload",
    ]
    if (!source_type || !allowedSources.includes(source_type)) {
      return NextResponse.json({ error: "Invalid or missing source_type" }, { status: 400 })
    }

    const allowedKinds: IncomingDocumentKind[] = ["expense_receipt", "supplier_bill_attachment", "unknown"]
    if (!allowedKinds.includes(document_kind)) {
      return NextResponse.json({ error: "Invalid document_kind" }, { status: 400 })
    }

    const role = await getUserRole(supabase, user.id, business_id)
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const created = await createIncomingDocumentRow(supabase, {
      businessId: business_id,
      userId: user.id,
      sourceType: source_type,
      documentKind: document_kind,
      storageBucket: storage_bucket,
      storagePath: storage_path,
      fileName: file_name,
      mimeType: mime_type,
      fileSize: file_size,
    })

    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: 500 })
    }

    return NextResponse.json({ document_id: created.id }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[incoming-documents] POST", error)
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 })
  }
}
