import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"
import { logAudit } from "@/lib/auditLog"

/**
 * PATCH /api/admin/accounting/tenants/[id]/archive
 * Set businesses.archived_at = now() for the given business id.
 * Body: { reason?: string }
 * Admin-only. Writes audit log.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const allowed = await canAccessForensicMonitoring(supabase, user.id)
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden. Only Owner, Firm Admin, or Accounting Admin can archive tenants." },
        { status: 403 }
      )
    }

    const { id: businessId } = await params
    if (!businessId) {
      return NextResponse.json({ error: "Missing tenant id" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""

    const { data: existing, error: fetchError } = await supabase
      .from("businesses")
      .select("id, name, archived_at")
      .eq("id", businessId)
      .maybeSingle()

    if (fetchError) {
      console.error("Archive tenant fetch error:", fetchError)
      return NextResponse.json(
        { error: "Failed to load tenant" },
        { status: 500 }
      )
    }

    if (!existing) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    if (existing.archived_at) {
      return NextResponse.json(
        { error: "Tenant is already archived" },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from("businesses")
      .update({ archived_at: now })
      .eq("id", businessId)

    if (updateError) {
      console.error("Archive tenant update error:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to archive tenant" },
        { status: 500 }
      )
    }

    await logAudit({
      businessId,
      userId: user.id,
      actionType: "tenant_archive",
      entityType: "tenant",
      entityId: businessId,
      description: reason || "archived",
      newValues: { archived_at: now },
      request,
    })

    return NextResponse.json({
      ok: true,
      archived_at: now,
    })
  } catch (err: unknown) {
    console.error("Archive tenant error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
