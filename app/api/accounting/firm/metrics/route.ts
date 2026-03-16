import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { getUserFirmIds } from "@/lib/firmActivityLog"

/**
 * GET /api/accounting/firm/metrics
 * 
 * Returns firm dashboard metrics:
 * - Total clients
 * - Clients with draft AFS
 * - Clients blocked by preflight
 * 
 * Access: Users who belong to accounting firms
 */
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

    // Get user's firm IDs
    const firmIds = await getUserFirmIds(supabase, user.id)

    if (firmIds.length === 0) {
      return NextResponse.json({
        total_clients: 0,
        clients_with_draft_afs: 0,
        clients_blocked_by_preflight: 0,
      })
    }

    // Get all clients for these firms
    const { data: firmClients, error: clientsError } = await supabase
      .from("accounting_firm_clients")
      .select("business_id")
      .in("firm_id", firmIds)

    if (clientsError) {
      console.error("Error fetching firm clients:", clientsError)
      return NextResponse.json(
        { error: "Failed to fetch clients" },
        { status: 500 }
      )
    }

    if (!firmClients || firmClients.length === 0) {
      return NextResponse.json({
        total_clients: 0,
        clients_with_draft_afs: 0,
        clients_blocked_by_preflight: 0,
      })
    }

    const businessIds = firmClients.map((fc) => fc.business_id)
    const totalClients = businessIds.length

    // Count clients with draft AFS
    const { data: draftAfsRuns, error: afsError } = await supabase
      .from("afs_runs")
      .select("business_id")
      .in("business_id", businessIds)
      .eq("status", "draft")

    if (afsError) {
      console.error("Error fetching draft AFS:", afsError)
    }

    // Count clients blocked by preflight (clients with critical exceptions or locked periods)
    // For now, we'll count clients with locked periods as "blocked"
    // Future: integrate with actual preflight validation results
    const { data: lockedPeriods, error: periodsError } = await supabase
      .from("accounting_periods")
      .select("business_id")
      .in("business_id", businessIds)
      .eq("status", "locked")

    if (periodsError) {
      console.error("Error fetching locked periods:", periodsError)
    }

    // Get unique business IDs for each metric
    const clientsWithDraftAfs = new Set((draftAfsRuns || []).map((r) => r.business_id))
    const clientsBlockedByPreflight = new Set((lockedPeriods || []).map((p) => p.business_id))

    return NextResponse.json({
      total_clients: totalClients,
      clients_with_draft_afs: clientsWithDraftAfs.size,
      clients_blocked_by_preflight: clientsBlockedByPreflight.size,
    })
  } catch (error: any) {
    console.error("Error in firm metrics API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
