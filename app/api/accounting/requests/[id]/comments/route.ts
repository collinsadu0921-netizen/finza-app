import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/requests/[id]/comments?business_id=
 * List comments for a specific client request (firm-scoped, read authority).
 *
 * POST /api/accounting/requests/[id]/comments
 * Body: { business_id, body, metadata? }
 * Create a new comment on a client request (write authority).
 */

type RouteContext = { params: Promise<{ id: string }> }

// ── shared auth helper ────────────────────────────────────────────────────────

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
    const { id: requestId } = await context.params
    if (!requestId) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")?.trim()
    if (!businessId) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const result = await resolveAuth(request, businessId, "read")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, auth, resolved } = result

    // Verify the parent request exists and belongs to this firm + client
    const { data: parentRequest, error: parentErr } = await result.supabase
      .from("client_requests")
      .select("id")
      .eq("id", requestId)
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", resolved.businessId)
      .maybeSingle()

    if (parentErr) {
      console.error("client_requests lookup:", parentErr)
      return NextResponse.json({ error: parentErr.message }, { status: 500 })
    }
    if (!parentRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    const { data: comments, error: listErr } = await supabase
      .from("client_request_comments")
      .select("*")
      .eq("request_id", requestId)
      .eq("firm_id", auth.firmId)
      .order("created_at", { ascending: true })

    if (listErr) {
      console.error("client_request_comments list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    return NextResponse.json({ comments: comments ?? [] })
  } catch (e) {
    console.error("GET /api/accounting/requests/[id]/comments:", e)
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
    const commentBody = typeof body.body === "string" ? body.body.trim() : ""
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!businessId) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }
    if (!commentBody) {
      return NextResponse.json({ error: "body is required" }, { status: 400 })
    }

    const result = await resolveAuth(request, businessId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth, resolved } = result

    // Verify parent request ownership
    const { data: parentRequest, error: parentErr } = await supabase
      .from("client_requests")
      .select("id, title")
      .eq("id", requestId)
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", resolved.businessId)
      .maybeSingle()

    if (parentErr) {
      console.error("client_requests lookup:", parentErr)
      return NextResponse.json({ error: parentErr.message }, { status: 500 })
    }
    if (!parentRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("client_request_comments")
      .insert({
        request_id: requestId,
        firm_id: auth.firmId,
        client_business_id: resolved.businessId,
        author_user_id: user.id,
        body: commentBody,
        metadata,
      })
      .select()
      .single()

    if (insertErr) {
      console.error("client_request_comments insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId,
      actorUserId: user.id,
      actionType: "client_request_comment_created",
      entityType: "client_request",
      entityId: requestId,
      metadata: {
        comment_id: inserted.id,
        request_title: parentRequest.title,
        client_business_id: resolved.businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ comment: inserted }, { status: 201 })
  } catch (e) {
    console.error("POST /api/accounting/requests/[id]/comments:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
