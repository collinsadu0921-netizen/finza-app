import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeAllowanceType, ALLOWANCE_TYPES } from "@/lib/payrollTypes"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { recalcPayrollEntryForStaffOnDraftRun } from "@/lib/payroll/recalcPayrollEntryForStaff"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; allowanceId: string }> | { id: string; allowanceId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { id: staffId, allowanceId } = resolvedParams

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (denied) return denied

    const { data: existing } = await supabase
      .from("allowances")
      .select("id, recurring, payroll_run_id")
      .eq("id", allowanceId)
      .eq("staff_id", staffId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: "Allowance not found" }, { status: 404 })
    }

    if (existing.payroll_run_id) {
      const { data: run } = await supabase
        .from("payroll_runs")
        .select("id, status")
        .eq("id", existing.payroll_run_id)
        .maybeSingle()
      if (run && run.status !== "draft") {
        return NextResponse.json(
          {
            error:
              "Cannot change a one-off allowance after its payroll run is no longer a draft. Historical payroll snapshots are preserved.",
          },
          { status: 400 }
        )
      }
    }

    const body = await request.json()
    const { type, amount, recurring, description } = body

    const updateData: Record<string, unknown> = {}
    if (type !== undefined) {
      const normalizedType = normalizeAllowanceType(type)
      if (normalizedType === null) {
        return NextResponse.json(
          {
            error: "Invalid allowance type",
            code: "INVALID_ALLOWANCE_TYPE",
            allowed: ALLOWANCE_TYPES,
          },
          { status: 400 }
        )
      }
      updateData.type = normalizedType
    }
    if (amount !== undefined) updateData.amount = Number(amount)
    if (description !== undefined) updateData.description = description?.trim() || null

    const nextRecurring =
      recurring !== undefined ? Boolean(recurring) : existing.recurring !== false
    if (recurring !== undefined) updateData.recurring = nextRecurring

    if (!nextRecurring && !existing.payroll_run_id) {
      return NextResponse.json(
        {
          error:
            "One-off allowances must be assigned to an exact draft payroll run. Create them from the payroll run page.",
          code: "ONE_OFF_REQUIRES_PAYROLL_RUN",
        },
        { status: 400 }
      )
    }

    if (nextRecurring && existing.payroll_run_id) {
      updateData.payroll_run_id = null
    }

    const { data: allowance, error } = await supabase
      .from("allowances")
      .update(updateData)
      .eq("id", allowanceId)
      .eq("staff_id", staffId)
      .select()
      .single()

    if (error) {
      console.error("Error updating allowance:", error)
      return NextResponse.json(
        { error: error.message || "Failed to update allowance" },
        { status: 500 }
      )
    }

    const runIdForRecalc = allowance?.payroll_run_id || existing.payroll_run_id
    if (runIdForRecalc) {
      const businessCountry = business.address_country || business.country_code || null
      if (businessCountry) {
        const recalc = await recalcPayrollEntryForStaffOnDraftRun({
          supabase,
          businessId: business.id,
          businessCountry,
          runId: String(runIdForRecalc),
          staffId,
        })
        if (!recalc.ok) {
          return NextResponse.json({ error: recalc.error }, { status: recalc.status })
        }
      }
    }

    return NextResponse.json({ allowance })
  } catch (error: any) {
    console.error("Error updating allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; allowanceId: string }> | { id: string; allowanceId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { id: staffId, allowanceId } = resolvedParams

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (denied) return denied

    const { error } = await supabase
      .from("allowances")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", allowanceId)
      .eq("staff_id", staffId)

    if (error) {
      console.error("Error deleting allowance:", error)
      return NextResponse.json(
        { error: error.message || "Failed to delete allowance" },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: "Allowance deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

