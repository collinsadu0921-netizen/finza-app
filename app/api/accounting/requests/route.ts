import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/requests?business_id=   → requests for a single client (firm-scoped)
 * GET /api/accounting/requests                → all requests across all firm clients (dashboard use)
 *
 * POST /api/accounting/requests
 * Body: { business_id, title, description?, document_type?, due_at?, metadata? }
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")?.trim()

    // ── Firm-wide listing (no business_id) ──────────────────────────────────
    // Used by the accountant dashboard to show open/overdue requests across all
    // clients in a single call. Authority: firm membership required (read level).
    if (!businessId) {
      // Authority check: requireFirmMemberForApi enforces read-level firm membership,
      // consistent with how all other firm-level endpoints (e.g. work-items) gate access.
      const memberForbidden = await requireFirmMemberForApi(supabase, user.id)
      if (memberForbidden) return memberForbidden

      // Resolve all firm IDs for this user (column is firm_id per authorityEngine).
      const { data: firmUsers, error: firmErr } = await supabase
        .from("accounting_firm_users")
        .select("firm_id")
        .eq("user_id", user.id)

      if (firmErr || !firmUsers?.length) {
        return NextResponse.json({ error: "Not a firm member" }, { status: 403 })
      }

      const firmIds = firmUsers.map((f) => f.firm_id as string).filter(Boolean)

      const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10), 500)

      const { data: rows, error: listErr } = await supabase
        .from("client_requests")
        .select(`
          id,
          firm_id,
          client_business_id,
          title,
          status,
          due_at,
          document_type,
          created_at,
          businesses!client_requests_client_business_id_fkey (
            id,
            name
          )
        `)
        .in("firm_id", firmIds)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit)

      if (listErr) {
        console.error("client_requests firm-wide list error:", listErr)
        return NextResponse.json({ error: listErr.message }, { status: 500 })
      }

      const requests = (rows ?? []).map((row) => {
        const business = row.businesses as { id: string; name: string } | null
        const { businesses: _drop, ...rest } = row as typeof row & { businesses: unknown }
        return {
          ...rest,
          client_name: business?.name ?? null,
        }
      })

      return NextResponse.json({ requests })
    }

    // ── Per-client listing (business_id provided) ────────────────────────────
    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: businessId }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json({ error: "Missing or invalid business context" }, { status: 400 })
    }

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId: resolved.businessId,
      requiredLevel: "read",
    })
    if (!auth.allowed || !auth.firmId) {
      return NextResponse.json({ error: "Forbidden", reason: auth.reason }, { status: 403 })
    }

    const { data: rows, error } = await supabase
      .from("client_requests")
      .select("*")
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", resolved.businessId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("client_requests list error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ requests: rows ?? [] })
  } catch (e) {
    console.error("GET /api/accounting/requests:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const body = await request.json().catch(() => ({}))
    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
    const title = typeof body.title === "string" ? body.title.trim() : ""
    const description = typeof body.description === "string" ? body.description : ""
    const document_type =
      typeof body.document_type === "string" && body.document_type.trim()
        ? body.document_type.trim()
        : null
    const due_at = typeof body.due_at === "string" && body.due_at ? body.due_at : null
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!businessId || !title) {
      return NextResponse.json({ error: "business_id and title are required" }, { status: 400 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: businessId }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json({ error: "Missing or invalid business context" }, { status: 400 })
    }

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId: resolved.businessId,
      requiredLevel: "write",
    })
    if (!auth.allowed || !auth.firmId || !auth.engagementId) {
      return NextResponse.json({ error: "Forbidden", reason: auth.reason }, { status: 403 })
    }

    const { data: inserted, error: insertError } = await supabase
      .from("client_requests")
      .insert({
        firm_id: auth.firmId,
        client_business_id: resolved.businessId,
        engagement_id: auth.engagementId,
        title,
        description,
        status: "open",
        created_by: user.id,
        due_at,
        document_type,
        metadata,
      })
      .select()
      .single()

    if (insertError) {
      console.error("client_requests insert:", insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId,
      actorUserId: user.id,
      actionType: "client_request_created",
      entityType: "client_request",
      entityId: inserted.id,
      metadata: {
        title,
        client_business_id: resolved.businessId,
        engagement_id: auth.engagementId,
        status: inserted.status,
      },
    })

    return NextResponse.json({ request: inserted })
  } catch (e) {
    console.error("POST /api/accounting/requests:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
