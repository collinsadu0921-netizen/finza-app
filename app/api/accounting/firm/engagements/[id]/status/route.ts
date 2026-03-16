/**
 * PATCH /api/accounting/firm/engagements/[id]/status
 *
 * Partner-only. Transition engagement status with enforced rules.
 * Allowed: pending→accepted, accepted→active, accepted|active→suspended,
 * suspended→active, any→terminated.
 * Sets accepted_at/accepted_by when transitioning to accepted.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { getEngagementById } from "@/lib/firmEngagements"
import { logFirmActivity } from "@/lib/firmActivityLog"

const ALLOWED: Record<string, string[]> = {
  pending: ["accepted"],
  accepted: ["active", "suspended", "terminated"],
  active: ["suspended", "terminated"],
  suspended: ["active", "terminated"],
  terminated: [],
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const engagementId = resolvedParams?.id
    if (!engagementId) {
      return NextResponse.json(
        { error: "Missing engagement id", error_code: "MISSING_ID" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const body = (await request.json().catch(() => ({}))) as { status?: string }
    const newStatus = typeof body?.status === "string" ? body.status.trim().toLowerCase() : null

    if (!newStatus) {
      return NextResponse.json(
        { error: "status is required", error_code: "MISSING_STATUS" },
        { status: 400 }
      )
    }

    const validStatuses = ["pending", "accepted", "active", "suspended", "terminated"]
    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json(
        { error: "status must be one of: pending, accepted, active, suspended, terminated", error_code: "INVALID_STATUS" },
        { status: 400 }
      )
    }

    const engagement = await getEngagementById(supabase, engagementId)
    if (!engagement) {
      return NextResponse.json(
        { error: "Engagement not found" },
        { status: 404 }
      )
    }

    const { data: firmUser } = await supabase
      .from("accounting_firm_users")
      .select("role")
      .eq("firm_id", engagement.accounting_firm_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!firmUser || firmUser.role !== "partner") {
      return NextResponse.json(
        { error: "Only Partners can change engagement status via this endpoint" },
        { status: 403 }
      )
    }

    const current = engagement.status as keyof typeof ALLOWED
    const allowed = ALLOWED[current]
    if (!allowed?.includes(newStatus)) {
      return NextResponse.json(
        {
          error: `Transition from ${current} to ${newStatus} is not allowed`,
          error_code: "INVALID_TRANSITION",
          allowed_from_current: allowed ?? [],
        },
        { status: 400 }
      )
    }

    const today = new Date().toISOString().split("T")[0]
    if (newStatus === "accepted") {
      const from = engagement.effective_from
      if (from > today) {
        return NextResponse.json(
          {
            error: "Cannot accept engagement before effective_from",
            error_code: "INVALID_EFFECTIVE_WINDOW",
            effective_from: from,
          },
          { status: 400 }
        )
      }
    }

    const update: Record<string, unknown> = { status: newStatus }
    if (newStatus === "accepted") {
      update.accepted_at = new Date().toISOString()
      update.accepted_by = user.id
    }

    const { data: updated, error: updateError } = await supabase
      .from("firm_client_engagements")
      .update(update)
      .eq("id", engagementId)
      .select()
      .single()

    if (updateError) {
      console.error("Engagement status update error:", { engagementId, newStatus, updateError })
      return NextResponse.json(
        { error: "Failed to update engagement status" },
        { status: 500 }
      )
    }

    const actionType =
      newStatus === "accepted"
        ? "engagement_accepted"
        : newStatus === "active"
          ? "engagement_activated"
          : newStatus === "suspended"
            ? "engagement_suspended"
            : newStatus === "terminated"
              ? "engagement_terminated"
              : "engagement_resumed"

    await logFirmActivity({
      supabase,
      firmId: engagement.accounting_firm_id,
      actorUserId: user.id,
      actionType,
      entityType: "engagement",
      entityId: engagementId,
      metadata: {
        previous_status: current,
        new_status: newStatus,
        ...(newStatus === "accepted" ? { accepted_by: user.id } : {}),
      },
    })

    return NextResponse.json({
      success: true,
      engagement: updated,
    })
  } catch (e) {
    console.error("Error in PATCH engagement status:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
