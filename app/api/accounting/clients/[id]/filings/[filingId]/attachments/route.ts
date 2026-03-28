import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/clients/[id]/filings/[filingId]/attachments
 * List attachments for a filing (read authority).
 * Returns each record with a 1-hour signed download URL. No public URLs.
 *
 * POST /api/accounting/clients/[id]/filings/[filingId]/attachments
 * Body: { file_name, storage_path, mime_type, file_size, metadata? }
 * Register a file already uploaded to the "documents" bucket.
 * Verifies the file exists in storage before inserting the metadata record.
 * Logs filing_attachment_uploaded / entity_type: client_filing.
 *
 * Storage pattern (identical to request attachments, migration 398):
 *   1. Browser → supabase.storage.from("documents").upload(path, file)
 *   2. Browser → POST here with storage_path + file metadata
 *   Storage path must start with "accounting-filings/" to prevent namespace abuse.
 */

const STORAGE_BUCKET = "documents"
const SIGNED_URL_TTL = 3600 // 1 hour

type RouteContext = { params: Promise<{ id: string; filingId: string }> }

// ── shared auth + filing ownership check ─────────────────────────────────────

async function resolveAuth(
  request: NextRequest,
  businessId: string,
  filingId: string,
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

  // Verify filing belongs to this firm + client
  const { data: filing, error: filingErr } = await supabase
    .from("client_filings")
    .select("id, filing_type")
    .eq("id", filingId)
    .eq("firm_id", auth.firmId)
    .eq("client_business_id", businessId)
    .maybeSingle()

  if (filingErr) {
    console.error("client_filings lookup:", filingErr)
    return { error: filingErr.message, status: 500 } as const
  }
  if (!filing) {
    return { error: "Filing not found", status: 404 } as const
  }

  return { supabase, user, resolved, auth, filing }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId, filingId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })
    if (!filingId)   return NextResponse.json({ error: "Missing filingId" }, { status: 400 })

    const result = await resolveAuth(request, businessId, filingId, "read")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, auth } = result

    const { data: rows, error: listErr } = await supabase
      .from("client_filing_attachments")
      .select("*")
      .eq("filing_id", filingId)
      .eq("firm_id", auth.firmId)
      .order("created_at", { ascending: true })

    if (listErr) {
      console.error("filing_attachments list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    const attachments = rows ?? []

    // Generate signed URLs server-side — never public URLs for firm documents
    const withUrls = await Promise.all(
      attachments.map(async (a) => {
        const { data: signed, error: signErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(a.storage_path, SIGNED_URL_TTL)

        return { ...a, signed_url: signErr || !signed ? null : signed.signedUrl }
      })
    )

    return NextResponse.json({ attachments: withUrls })
  } catch (e) {
    console.error("GET filing attachments:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId, filingId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })
    if (!filingId)   return NextResponse.json({ error: "Missing filingId" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
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

    if (!fileName)    return NextResponse.json({ error: "file_name is required" }, { status: 400 })
    if (!storagePath) return NextResponse.json({ error: "storage_path is required" }, { status: 400 })

    // Enforce path namespace — prevents registering arbitrary storage paths
    if (!storagePath.startsWith("accounting-filings/")) {
      return NextResponse.json(
        { error: "storage_path must be under accounting-filings/" },
        { status: 400 }
      )
    }

    const result = await resolveAuth(request, businessId, filingId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth, filing } = result

    // Verify the file actually exists in storage before registering it
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
      .from("client_filing_attachments")
      .insert({
        filing_id: filingId,
        firm_id: auth.firmId,
        client_business_id: businessId,
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
      console.error("filing_attachments insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId!,
      actorUserId: user.id,
      actionType: "filing_attachment_uploaded",
      entityType: "client_filing",
      entityId: filingId,
      metadata: {
        attachment_id: inserted.id,
        filing_id: filingId,
        filing_type: filing.filing_type,
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        client_business_id: businessId,
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
    console.error("POST filing attachment:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
