/**
 * LEGACY / REPAIR ONLY.
 *
 * Normal payroll approval creates obligations inside approve_payroll_run_atomic.
 * Do not call this route as part of the approval flow.
 * Kept for diagnostics / explicit repair of historical runs.
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { generateOrSyncPayrollObligationsForRun } from "@/lib/payroll/obligations"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase, user.id, business.id, "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const { data: run } = await supabase
      .from("payroll_runs")
      .select("id, status, journal_entry_id")
      .eq("id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .maybeSingle()

    if (!run) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
    }

    if (run.status === "draft" || !run.journal_entry_id) {
      return NextResponse.json(
        {
          error:
            "Legacy obligation repair is only allowed for approved/locked payroll runs that already have a journal. Draft approval must use atomic approval.",
          code: "PAYROLL_OBLIGATION_REPAIR_NOT_ALLOWED",
          legacyRepairOnly: true,
        },
        { status: 409 }
      )
    }

    const result = await generateOrSyncPayrollObligationsForRun(
      supabase as any,
      business.id,
      runId,
      { allowLegacyDerivation: true }
    )

    return NextResponse.json({
      ok: true,
      legacyRepairOnly: true,
      warning: result.warning,
      message:
        "Legacy repair: payroll obligations generated/synced. Not part of normal approval.",
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

