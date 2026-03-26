import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/clients/[id]/documents?category=&limit=
 * List documents for a client (read authority), newest-first.
 * Optional ?category= filter.
 * Returns each record with a 1-hour signed download URL. No public URLs.
 *
 * POST /api/accounting/clients/[id]/documents
 * Body: { title, category?, note?, file_name, storage_path, mime_type, file_size, metadata? }
 * Register a file already uploaded to the "documents" bucket.
 * Verifies the file exists in storage before inserting the metadata record.
 * Logs client_document_uploaded / entity_type: client.
 *
 * Storage pattern (identical to request/filing attachments):
 *   1. Browser → supabase.storage.from("documents").upload(path, file)
 *   2. Browser → POST here with storage_path + file metadata
 *   storage_path must start with "accounting-documents/{businessId}/"
 */

const STORAGE_BUCKET = "documents"
const SIGNED_URL_TTL = 3600 // 1 hour

type RouteContext = { params: Promise<{ id: string }> }

// ── shared auth ───────────────────────────────────────────────────────────────

async function resolveAuth(
  request: NextRequest,
  businessId: string,
  requiredLevel: "read" | "write"
) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized", status: 401 } as const

  try {
    assertAccountingAccess(accountingUserFromRequest(request))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Forbidden"
    return { error: msg, status: msg === "Unauthorized" ? 401 : 403 } as const
  }

  const resolved = await resolveAccountingContext({
    supabase,
    userId: user.id,
    searchParams: new URLSearchParams({ business_id: businessId }),
    pathname: new URL(request.url).pathname,
    source: "api",
  })
  if ("error" in resolved) {
    return { error: "Missing or invalid business context", status: 400 } as const
  }

  const auth = await getAccountingAuthority({
    supabase,
    firmUserId: user.id,
    businessId: resolved.businessId,
    requiredLevel,
  })
  if (!auth.allowed || !auth.firmId) {
    return { error: "Forbidden", reason: auth.reason, status: 403 } as const
  }

  return { supabase, user, resolved, auth }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

    const result = await resolveAuth(request, businessId, "read")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, auth } = result

    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")?.trim()
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10), 500)

    let query = supabase
      .from("client_documents")
      .select("*")
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (category) {
      query = query.eq("category", category)
    }

    const { data: rows, error: listErr } = await query

    if (listErr) {
      console.error("client_documents list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    const docs = rows ?? []

    // Generate server-side signed URLs — never public URLs
    const withUrls = await Promise.all(
      docs.map(async (d) => {
        const { data: signed, error: signErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(d.storage_path, SIGNED_URL_TTL)

        return { ...d, signed_url: signErr || !signed ? null : signed.signedUrl }
      })
    )

    return NextResponse.json({ documents: withUrls })
  } catch (e) {
    console.error("GET /api/accounting/clients/[id]/documents:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const title       = typeof body.title        === "string" ? body.title.trim()        : ""
    const category    = typeof body.category     === "string" ? body.category.trim()     : ""
    const note        = typeof body.note         === "string" ? body.note.trim()         : ""
    const fileName    = typeof body.file_name    === "string" ? body.file_name.trim()    : ""
    const storagePath = typeof body.storage_path === "string" ? body.storage_path.trim() : ""
    const mimeType    = typeof body.mime_type    === "string" ? body.mime_type.trim()    : ""
    const fileSize    =
      typeof body.file_size === "number" && Number.isFinite(body.file_size)
        ? Math.max(0, Math.floor(body.file_size))
        : 0
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!title)       return NextResponse.json({ error: "title is required" }, { status: 400 })
    if (!fileName)    return NextResponse.json({ error: "file_name is required" }, { status: 400 })
    if (!storagePath) return NextResponse.json({ error: "storage_path is required" }, { status: 400 })

    // Enforce path namespace
    if (!storagePath.startsWith("accounting-documents/")) {
      return NextResponse.json(
        { error: "storage_path must be under accounting-documents/" },
        { status: 400 }
      )
    }

    const result = await resolveAuth(request, businessId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth } = result

    // Verify the file actually exists in storage before registering
    const folder = storagePath.substring(0, storagePath.lastIndexOf("/"))
    const name   = storagePath.substring(storagePath.lastIndexOf("/") + 1)
    const { data: fileList, error: listErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(folder, { search: name, limit: 1 })

    if (listErr || !fileList?.length) {
      return NextResponse.json(
        { error: "File not found in storage — upload it before registering" },
        { status: 400 }
      )
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("client_documents")
      .insert({
        firm_id: auth.firmId,
        client_business_id: businessId,
        uploaded_by_user_id: user.id,
        title,
        category,
        note,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size: fileSize,
        metadata,
      })
      .select()
      .single()

    if (insertErr) {
      console.error("client_documents insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId,
      actorUserId: user.id,
      actionType: "client_document_uploaded",
      entityType: "client",
      entityId: businessId,
      metadata: {
        document_id: inserted.id,
        title,
        category,
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    // Return the record with a signed URL
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL)

    return NextResponse.json(
      { document: { ...inserted, signed_url: signed?.signedUrl ?? null } },
      { status: 201 }
    )
  } catch (e) {
    console.error("POST /api/accounting/clients/[id]/documents:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
