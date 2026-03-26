/**
 * POST /api/accounting/control-tower/log-activity
 *
 * Logs Control Tower–specific actions to the firm activity log (orchestration only).
 * Allowed action types: CONTROL_TOWER_BULK_ACTION, CONTROL_TOWER_ASSIGNMENT, CONTROL_TOWER_RESOLUTION.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"
import { getUserFirmIds } from "@/lib/accounting/firm/activityLog"

const ALLOWED_ACTION_TYPES = new Set([
  "CONTROL_TOWER_BULK_ACTION",
  "CONTROL_TOWER_ASSIGNMENT",
  "CONTROL_TOWER_RESOLUTION",
])

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}))
    const actionType = body.actionType as string | undefined
    const entityType = (body.entityType as string) ?? "control_tower"
    const entityId = body.entityId as string | undefined
    const metadata = (body.metadata as Record<string, unknown>) ?? {}

    if (!actionType || !ALLOWED_ACTION_TYPES.has(actionType)) {
      return NextResponse.json(
        { error: "Invalid or missing actionType. Allowed: CONTROL_TOWER_BULK_ACTION, CONTROL_TOWER_ASSIGNMENT, CONTROL_TOWER_RESOLUTION" },
        { status: 400 }
      )
    }

    const firmIds = await getUserFirmIds(supabase, user.id)
    const firmId = firmIds[0]
    if (!firmId) {
      return NextResponse.json({ error: "User has no firm" }, { status: 403 })
    }

    await logFirmActivity({
      supabase,
      firmId,
      actorUserId: user.id,
      actionType,
      entityType,
      entityId: entityId ?? null,
      metadata,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("Control tower log-activity error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    )
  }
}
