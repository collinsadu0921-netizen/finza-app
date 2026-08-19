/**
 * GET /api/accounting/work
 *
 * Fast Practice Work index for the active firm.
 * Batch queries only — no per-client authority / readiness / recon / period RPC.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { filterPracticeWorkItems, sortPracticeWorkItems } from "@/lib/practice/work/filter"
import { resolvePracticeWorkView } from "@/lib/practice/work/defaultView"
import { loadPracticeWorkIndex } from "@/lib/practice/work/loadIndex"
import type { PracticeWorkStatusGroup } from "@/lib/practice/work/types"

export async function GET(request: NextRequest) {
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

    const params = request.nextUrl.searchParams
    const index = await loadPracticeWorkIndex({
      supabase,
      userId: user.id,
      requestedFirmId: params.get("firm_id"),
    })
    if (!index.ok) {
      return NextResponse.json({ error: index.error }, { status: index.status })
    }

    const view = resolvePracticeWorkView({
      role: index.scope.role,
      viewParam: params.get("view"),
    })
    const statusGroupParam = params.get("status_group")
    const statusGroup: PracticeWorkStatusGroup | null =
      statusGroupParam === "needs_action" ||
      statusGroupParam === "waiting" ||
      statusGroupParam === "done"
        ? statusGroupParam
        : null
    const dueParam = params.get("due")
    const dueState =
      dueParam === "overdue" ||
      dueParam === "today" ||
      dueParam === "soon" ||
      dueParam === "none"
        ? dueParam
        : null
    const includeDone = params.get("include_done") === "1"

    const filtered = sortPracticeWorkItems(
      filterPracticeWorkItems(index.items, {
        view,
        currentUserId: user.id,
        clientId: params.get("client") || params.get("business_id"),
        type: params.get("type"),
        statusGroup,
        assignee: params.get("assignee"),
        dueState,
        search: params.get("q"),
        includeDone,
      })
    )

    const counts = {
      all: index.items.filter((item) => item.status_group !== "done").length,
      my: index.items.filter(
        (item) => item.status_group !== "done" && item.assigned_user_id === user.id
      ).length,
      unassigned: index.items.filter(
        (item) => item.status_group !== "done" && !item.assigned_user_id
      ).length,
      waiting: index.items.filter((item) => item.status_group === "waiting").length,
      needs_action: index.items.filter((item) => item.status_group === "needs_action").length,
    }

    return NextResponse.json({
      firm_id: index.firmId,
      role: index.scope.role,
      view,
      items: filtered,
      staff: index.staff,
      clients: index.clients,
      counts,
      architecture: "fast_work_index",
    })
  } catch (err) {
    console.error("GET /api/accounting/work:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
