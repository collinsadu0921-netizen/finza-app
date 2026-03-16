import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"
import { logAudit } from "@/lib/auditLog"

const LIFECYCLE_FINAL = ["resolved", "ignored"]

/**
 * PATCH /api/admin/accounting/forensic-failures/[id]/acknowledge
 * Sets status = acknowledged, acknowledged_by = user_id, acknowledged_at = now().
 * Rejects if status is already resolved or ignored.
 * Writes audit event forensic_ack after success.
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
        { error: "Forbidden. Only Owner, Firm Admin, or Accounting Admin can update forensic failures." },
        { status: 403 }
      )
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing failure id" }, { status: 400 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from("accounting_invariant_failures")
      .select("id, status, run_id, check_id, severity, business_id")
      .eq("id", id)
      .maybeSingle()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: existing ? fetchError?.message : "Failure not found" },
        { status: existing ? 500 : 404 }
      )
    }

    if (LIFECYCLE_FINAL.includes(existing.status)) {
      return NextResponse.json(
        { error: "Cannot change status; failure is already resolved or ignored." },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await supabase
      .from("accounting_invariant_failures")
      .update({
        status: "acknowledged",
        acknowledged_by: user.id,
        acknowledged_at: now,
      })
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      console.error("Forensic failure acknowledge error:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to acknowledge" },
        { status: 500 }
      )
    }

    if (existing.business_id) {
      await logAudit({
        businessId: existing.business_id,
        userId: user.id,
        actionType: "forensic_ack",
        entityType: "forensic_failure",
        entityId: id,
        description: "acknowledged",
        newValues: {
          run_id: existing.run_id,
          check_id: existing.check_id,
          severity: existing.severity,
        },
        request,
      })
    }

    return NextResponse.json({ failure: updated })
  } catch (err: unknown) {
    console.error("Forensic failure acknowledge:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
