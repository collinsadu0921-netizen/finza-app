import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/clients/[id]/filings
 * List all filings for a client (firm-scoped, read authority).
 * Returns newest-first.
 *
 * POST /api/accounting/clients/[id]/filings
 * Body: { filing_type, period_id?, filed_at?, metadata? }
 * Create a new filing record (write authority).
 * Logs client_filing_created activity.
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
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500)
    const statusFilter = searchParams.get("status")

    let query = supabase
      .from("client_filings")
      .select("*")
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (statusFilter) {
      query = query.eq("status", statusFilter)
    }

    const { data: filings, error: listErr } = await query

    if (listErr) {
      console.error("client_filings list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    return NextResponse.json({ filings: filings ?? [] })
  } catch (e) {
    console.error("GET /api/accounting/clients/[id]/filings:", e)
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
    const filingType = typeof body.filing_type === "string" ? body.filing_type.trim() : ""
    const periodId = typeof body.period_id === "string" ? body.period_id.trim() || null : null
    const filedAt = typeof body.filed_at === "string" ? body.filed_at.trim() || null : null
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!filingType) {
      return NextResponse.json({ error: "filing_type is required" }, { status: 400 })
    }

    const result = await resolveAuth(request, businessId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth } = result

    const { data: inserted, error: insertErr } = await supabase
      .from("client_filings")
      .insert({
        firm_id: auth.firmId,
        client_business_id: businessId,
        period_id: periodId,
        filing_type: filingType,
        status: "pending",
        created_by_user_id: user.id,
        filed_at: filedAt,
        metadata,
      })
      .select()
      .single()

    if (insertErr) {
      console.error("client_filings insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId!,
      actorUserId: user.id,
      actionType: "client_filing_created",
      entityType: "client",
      entityId: businessId,
      metadata: {
        filing_id: inserted.id,
        filing_type: filingType,
        period_id: periodId,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ filing: inserted }, { status: 201 })
  } catch (e) {
    console.error("POST /api/accounting/clients/[id]/filings:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
