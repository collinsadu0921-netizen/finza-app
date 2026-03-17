/**
 * POST /api/admin/accounting/forensic-failures/[id]/escalate
 * Body: { reason: string (required), assignee?: string }
 * No schema changes. Records escalation in audit log only (forensic_escalate).
 * Access-gated same as acknowledge/resolve.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { canAccessForensicMonitoring } from "@/lib/forensicMonitoringAuth"
import { logAudit } from "@/lib/auditLog"

export async function POST(
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
        { error: "Forbidden. Only Owner, Firm Admin, or Accounting Admin can escalate forensic failures." },
        { status: 403 }
      )
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing failure id" }, { status: 400 })
    }

    let body: { reason?: string; assignee?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      )
    }

    const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
    if (reason.length < 10) {
      return NextResponse.json(
        { error: "reason is required and must be at least 10 characters" },
        { status: 400 }
      )
    }

    const assignee = typeof body?.assignee === "string" ? body.assignee.trim() || undefined : undefined

    const { data: failure, error: fetchError } = await supabase
      .from("accounting_invariant_failures")
      .select("id, run_id, check_id, severity, business_id")
      .eq("id", id)
      .maybeSingle()

    if (fetchError || !failure) {
      const message = !failure ? "Failure not found" : (fetchError as { message?: string } | null)?.message ?? "Failed to fetch"
      return NextResponse.json(
        { error: message },
        { status: failure ? 500 : 404 }
      )
    }

    if (failure.business_id) {
      await logAudit({
        businessId: failure.business_id,
        userId: user.id,
        actionType: "forensic_escalate",
        entityType: "forensic_failure",
        entityId: id,
        description: reason,
        newValues: {
          run_id: failure.run_id,
          check_id: failure.check_id,
          severity: failure.severity,
          ...(assignee != null && { assignee }),
        },
        request,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("Forensic failure escalate:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
