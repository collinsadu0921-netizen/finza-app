import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * PATCH /api/accounting/clients/[id]/filings/[filingId]
 * Body: { status?, filed_at?, metadata? }
 * Update a filing's status or metadata (write authority).
 * - When status transitions to "filed" and filed_at is not explicitly provided,
 *   filed_at is set to the current timestamp automatically.
 * - When status moves away from "filed"/"accepted", filed_at is NOT cleared
 *   (preserve the record of when it was filed).
 * Logs client_filing_updated activity.
 */

const VALID_STATUSES = ["pending", "in_progress", "filed", "accepted", "rejected", "cancelled"]

type RouteContext = { params: Promise<{ id: string; filingId: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId, filingId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })
    if (!filingId)   return NextResponse.json({ error: "Missing filingId" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Request body is empty" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Forbidden"
      return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 403 })
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
    if (!auth.allowed || !auth.firmId) {
      return NextResponse.json({ error: "Forbidden", reason: auth.reason }, { status: 403 })
    }

    // Verify the filing belongs to this firm + client
    const { data: existing, error: fetchErr } = await supabase
      .from("client_filings")
      .select("id, status, filing_type, filed_at")
      .eq("id", filingId)
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", businessId)
      .maybeSingle()

    if (fetchErr) {
      console.error("client_filings fetch:", fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: "Filing not found" }, { status: 404 })
    }

    // Build the patch
    const patch: Record<string, unknown> = {}

    if (typeof body.status === "string") {
      const newStatus = body.status.trim()
      if (!VALID_STATUSES.includes(newStatus)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 }
        )
      }
      patch.status = newStatus

      // Auto-set filed_at when transitioning to "filed" (if not explicitly provided)
      if (newStatus === "filed" && body.filed_at === undefined) {
        patch.filed_at = new Date().toISOString()
      }
    }

    if (body.filed_at !== undefined) {
      patch.filed_at =
        body.filed_at === null ? null
        : typeof body.filed_at === "string" ? body.filed_at
        : existing.filed_at
    }

    if (body.metadata !== undefined && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      patch.metadata = body.metadata
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data: updated, error: updateErr } = await supabase
      .from("client_filings")
      .update(patch)
      .eq("id", filingId)
      .eq("firm_id", auth.firmId)
      .select()
      .single()

    if (updateErr) {
      console.error("client_filings update:", updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId!,
      actorUserId: user.id,
      actionType: "client_filing_updated",
      entityType: "client",
      entityId: businessId,
      metadata: {
        filing_id: filingId,
        filing_type: existing.filing_type,
        previous_status: existing.status,
        new_status: updated.status,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ filing: updated })
  } catch (e) {
    console.error("PATCH /api/accounting/clients/[id]/filings/[filingId]:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
