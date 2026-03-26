import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/clients/[id]/filings/[filingId]/comments
 * List comments for a filing (read authority), ordered oldest-first.
 *
 * POST /api/accounting/clients/[id]/filings/[filingId]/comments
 * Body: { body, metadata? }
 * Add a new comment (write authority). Plain text only.
 * Logs filing_comment_created / entity_type: client_filing.
 */

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

    const { data: comments, error: listErr } = await supabase
      .from("client_filing_comments")
      .select("*")
      .eq("filing_id", filingId)
      .eq("firm_id", auth.firmId)
      .order("created_at", { ascending: true })

    if (listErr) {
      console.error("filing_comments list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    return NextResponse.json({ comments: comments ?? [] })
  } catch (e) {
    console.error("GET filing comments:", e)
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
    const commentBody = typeof body.body === "string" ? body.body.trim() : ""
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!commentBody) {
      return NextResponse.json({ error: "body is required" }, { status: 400 })
    }

    const result = await resolveAuth(request, businessId, filingId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth, filing } = result

    const { data: inserted, error: insertErr } = await supabase
      .from("client_filing_comments")
      .insert({
        filing_id: filingId,
        firm_id: auth.firmId,
        client_business_id: businessId,
        author_user_id: user.id,
        body: commentBody,
        metadata,
      })
      .select()
      .single()

    if (insertErr) {
      console.error("filing_comments insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId,
      actorUserId: user.id,
      actionType: "filing_comment_created",
      entityType: "client_filing",
      entityId: filingId,
      metadata: {
        comment_id: inserted.id,
        filing_id: filingId,
        filing_type: filing.filing_type,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ comment: inserted }, { status: 201 })
  } catch (e) {
    console.error("POST filing comment:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
