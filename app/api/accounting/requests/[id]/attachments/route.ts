import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/requests/[id]/attachments?business_id=
 * List attachments for a specific client request.
 * Returns each attachment record plus a 1-hour signed download URL.
 * Authority: read level.
 *
 * POST /api/accounting/requests/[id]/attachments
 * Body: { business_id, file_name, storage_path, mime_type, file_size, metadata? }
 * Register an attachment after the file has been uploaded to Supabase Storage.
 * Authority: write level.
 *
 * Upload flow:
 *   1. Browser calls supabase.storage.from("documents").upload(path, file)
 *   2. Browser calls POST here with the storage_path + file metadata
 *   3. GET returns signed URLs (1 h) for downloading — never public URLs
 */

const STORAGE_BUCKET = "documents"
const SIGNED_URL_TTL = 3600 // 1 hour

type RouteContext = { params: Promise<{ id: string }> }

// ── shared auth + parent-request verification ─────────────────────────────────

async function resolveAndVerify(
  request: NextRequest,
  businessId: string,
  requestId: string,
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

  // Verify the parent request belongs to this firm + client
  const { data: parentRequest, error: parentErr } = await supabase
    .from("client_requests")
    .select("id, title")
    .eq("id", requestId)
    .eq("firm_id", auth.firmId)
    .eq("client_business_id", resolved.businessId)
    .maybeSingle()

  if (parentErr) {
    console.error("client_requests lookup:", parentErr)
    return { error: parentErr.message, status: 500 } as const
  }
  if (!parentRequest) {
    return { error: "Request not found", status: 404 } as const
  }

  return { supabase, user, resolved, auth, parentRequest }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: requestId } = await context.params
    if (!requestId) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")?.trim()
    if (!businessId) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const result = await resolveAndVerify(request, businessId, requestId, "read")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, auth } = result

    const { data: rows, error: listErr } = await supabase
      .from("client_request_attachments")
      .select("*")
      .eq("request_id", requestId)
      .eq("firm_id", auth.firmId)
      .order("created_at", { ascending: true })

    if (listErr) {
      console.error("client_request_attachments list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    const attachments = rows ?? []

    // Generate server-side signed URLs — never expose public URLs for firm documents
    const withUrls = await Promise.all(
      attachments.map(async (a) => {
        const { data: signed, error: signErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(a.storage_path, SIGNED_URL_TTL)

        return {
          ...a,
          signed_url: signErr || !signed ? null : signed.signedUrl,
        }
      })
    )

    return NextResponse.json({ attachments: withUrls })
  } catch (e) {
    console.error("GET /api/accounting/requests/[id]/attachments:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: requestId } = await context.params
    if (!requestId) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
    const fileName = typeof body.file_name === "string" ? body.file_name.trim() : ""
    const storagePath = typeof body.storage_path === "string" ? body.storage_path.trim() : ""
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.trim() : ""
    const fileSize =
      typeof body.file_size === "number" && Number.isFinite(body.file_size)
        ? Math.max(0, Math.floor(body.file_size))
        : 0
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    if (!fileName)   return NextResponse.json({ error: "file_name is required" }, { status: 400 })
    if (!storagePath) return NextResponse.json({ error: "storage_path is required" }, { status: 400 })

    // Validate that storage_path is scoped to the expected prefix — prevents
    // registering arbitrary storage paths from outside the accounting namespace.
    if (!storagePath.startsWith("accounting-requests/")) {
      return NextResponse.json(
        { error: "storage_path must be under accounting-requests/" },
        { status: 400 }
      )
    }

    const result = await resolveAndVerify(request, businessId, requestId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth, resolved, parentRequest } = result

    // Verify the file actually exists in storage before registering it
    const { data: fileList, error: listErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(storagePath.substring(0, storagePath.lastIndexOf("/")), {
        search: storagePath.substring(storagePath.lastIndexOf("/") + 1),
        limit: 1,
      })

    if (listErr || !fileList?.length) {
      return NextResponse.json(
        { error: "File not found in storage — upload it before registering" },
        { status: 400 }
      )
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("client_request_attachments")
      .insert({
        request_id: requestId,
        firm_id: auth.firmId,
        client_business_id: resolved.businessId,
        uploaded_by_user_id: user.id,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size: fileSize,
        metadata,
      })
      .select()
      .single()

    if (insertErr) {
      console.error("client_request_attachments insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId!,
      actorUserId: user.id,
      actionType: "client_request_attachment_uploaded",
      entityType: "client_request",
      entityId: requestId,
      metadata: {
        attachment_id: inserted.id,
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        request_title: parentRequest.title,
        client_business_id: resolved.businessId,
        engagement_id: auth.engagementId,
      },
    })

    // Return the new record with a signed URL
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL)

    return NextResponse.json(
      { attachment: { ...inserted, signed_url: signed?.signedUrl ?? null } },
      { status: 201 }
    )
  } catch (e) {
    console.error("POST /api/accounting/requests/[id]/attachments:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
