import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/clients/[id]/filings/[filingId]/checklist
 * List checklist items for a filing (read authority), ordered by created_at ASC.
 *
 * POST /api/accounting/clients/[id]/filings/[filingId]/checklist
 * Body: { title, note? }
 * Add a new checklist item (write authority). Status starts as 'pending'.
 * Logs filing_checklist_item_created.
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

    const { data: items, error: listErr } = await supabase
      .from("client_filing_checklist_items")
      .select("*")
      .eq("filing_id", filingId)
      .eq("firm_id", auth.firmId)
      .order("created_at", { ascending: true })

    if (listErr) {
      console.error("checklist list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    return NextResponse.json({ items: items ?? [] })
  } catch (e) {
    console.error("GET checklist:", e)
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
    const title = typeof body.title === "string" ? body.title.trim() : ""
    const note  = typeof body.note  === "string" ? body.note.trim()  : ""
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 })

    const result = await resolveAuth(request, businessId, filingId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth, filing } = result

    const { data: inserted, error: insertErr } = await supabase
      .from("client_filing_checklist_items")
      .insert({
        filing_id: filingId,
        firm_id: auth.firmId,
        client_business_id: businessId,
        title,
        status: "pending",
        note,
        created_by_user_id: user.id,
        completed_at: null,
        metadata,
      })
      .select()
      .single()

    if (insertErr) {
      console.error("checklist insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId!,
      actorUserId: user.id,
      actionType: "filing_checklist_item_created",
      entityType: "client",
      entityId: businessId,
      metadata: {
        item_id: inserted.id,
        filing_id: filingId,
        filing_type: filing.filing_type,
        title,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ item: inserted }, { status: 201 })
  } catch (e) {
    console.error("POST checklist:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
