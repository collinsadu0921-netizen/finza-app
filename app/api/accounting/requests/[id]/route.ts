import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

const ALLOWED_STATUS = new Set(["open", "in_progress", "completed", "cancelled"])

/**
 * PATCH /api/accounting/requests/[id]
 * Body: { business_id, status?, title?, description?, document_type?, due_at?, completed_at?, metadata? }
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

    const { id: requestId } = await context.params
    if (!requestId) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
    if (!businessId) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
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

    const { data: existing, error: fetchError } = await supabase
      .from("client_requests")
      .select("*")
      .eq("id", requestId)
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", resolved.businessId)
      .maybeSingle()

    if (fetchError) {
      console.error("client_requests fetch:", fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    const patch: Record<string, unknown> = {}

    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim()
    if (typeof body.description === "string") patch.description = body.description

    if (body.status !== undefined) {
      const s = typeof body.status === "string" ? body.status.trim() : ""
      if (!ALLOWED_STATUS.has(s)) {
        return NextResponse.json(
          { error: "status must be one of: open, in_progress, completed, cancelled" },
          { status: 400 }
        )
      }
      patch.status = s
      if (s === "completed" && body.completed_at === undefined) {
        patch.completed_at = new Date().toISOString()
      } else if (s !== "completed" && body.completed_at === undefined) {
        patch.completed_at = null
      }
    }

    if (body.completed_at !== undefined) {
      patch.completed_at =
        body.completed_at === null || body.completed_at === ""
          ? null
          : typeof body.completed_at === "string"
            ? body.completed_at
            : null
    }

    if (body.document_type !== undefined) {
      patch.document_type =
        typeof body.document_type === "string" && body.document_type.trim()
          ? body.document_type.trim()
          : null
    }

    if (body.due_at !== undefined) {
      patch.due_at =
        typeof body.due_at === "string" && body.due_at ? body.due_at : null
    }

    if (body.metadata !== undefined && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      patch.metadata = { ...(existing.metadata as Record<string, unknown>), ...(body.metadata as object) }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    const { data: updated, error: updateError } = await supabase
      .from("client_requests")
      .update(patch)
      .eq("id", requestId)
      .eq("firm_id", auth.firmId)
      .select()
      .single()

    if (updateError) {
      console.error("client_requests update:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId,
      actorUserId: user.id,
      actionType: "client_request_updated",
      entityType: "client_request",
      entityId: requestId,
      metadata: {
        client_business_id: resolved.businessId,
        previous_status: existing.status,
        new_status: updated.status,
        changes: Object.keys(patch).filter((k) => k !== "updated_at"),
      },
    })

    return NextResponse.json({ request: updated })
  } catch (e) {
    console.error("PATCH /api/accounting/requests/[id]:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
