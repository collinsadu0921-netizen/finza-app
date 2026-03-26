import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * PATCH /api/accounting/clients/[id]/filings/[filingId]/checklist/[itemId]
 * Body: { status?, note? }
 * Update a checklist item's status or note (write authority).
 * - status → 'done':    sets completed_at to now (unless already set)
 * - status → 'pending'/'na': clears completed_at
 * Logs filing_checklist_item_updated.
 */

const VALID_STATUSES = ["pending", "done", "na"]

type RouteContext = { params: Promise<{ id: string; filingId: string; itemId: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId, filingId, itemId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })
    if (!filingId)   return NextResponse.json({ error: "Missing filingId" }, { status: 400 })
    if (!itemId)     return NextResponse.json({ error: "Missing itemId" }, { status: 400 })

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

    // Verify item belongs to this firm + client + filing
    const { data: existing, error: fetchErr } = await supabase
      .from("client_filing_checklist_items")
      .select("id, status, title, completed_at, filing_id")
      .eq("id", itemId)
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", businessId)
      .eq("filing_id", filingId)
      .maybeSingle()

    if (fetchErr) {
      console.error("checklist item fetch:", fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: "Checklist item not found" }, { status: 404 })
    }

    // Build the patch
    const patch: Record<string, unknown> = {}
    let newStatus = existing.status

    if (typeof body.status === "string") {
      const s = body.status.trim()
      if (!VALID_STATUSES.includes(s)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 }
        )
      }
      patch.status = s
      newStatus = s

      if (s === "done") {
        // Set completed_at if not already done
        patch.completed_at = existing.completed_at ?? new Date().toISOString()
      } else {
        // Clear completed_at when reverting
        patch.completed_at = null
      }
    }

    if (typeof body.note === "string") {
      patch.note = body.note.trim()
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data: updated, error: updateErr } = await supabase
      .from("client_filing_checklist_items")
      .update(patch)
      .eq("id", itemId)
      .eq("firm_id", auth.firmId)
      .select()
      .single()

    if (updateErr) {
      console.error("checklist item update:", updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId,
      actorUserId: user.id,
      actionType: "filing_checklist_item_updated",
      entityType: "client",
      entityId: businessId,
      metadata: {
        item_id: itemId,
        filing_id: filingId,
        title: existing.title,
        previous_status: existing.status,
        new_status: newStatus,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ item: updated })
  } catch (e) {
    console.error("PATCH checklist item:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
