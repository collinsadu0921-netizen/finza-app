import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeAllowanceType, ALLOWANCE_TYPES } from "@/lib/payrollTypes"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { recalcPayrollEntryForStaffOnDraftRun } from "@/lib/payroll/recalcPayrollEntryForStaff"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const staffId = resolvedParams.id

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

    // Verify staff belongs to the authenticated business
    const { data: staff } = await supabase
      .from("staff")
      .select("id")
      .eq("id", staffId)
      .eq("business_id", business.id)
      .single()

    if (!staff) {
      return NextResponse.json(
        { error: "Staff not found" },
        { status: 404 }
      )
    }

    const body = await request.json()
    const { type, amount, recurring, description, payroll_run_id } = body

    if (amount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

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

    const isRecurring = recurring !== undefined ? Boolean(recurring) : true
    const runId =
      payroll_run_id != null && String(payroll_run_id).trim()
        ? String(payroll_run_id).trim()
        : null

    if (isRecurring && runId) {
      return NextResponse.json(
        { error: "Recurring allowances cannot be linked to a payroll run." },
        { status: 400 }
      )
    }

    if (!isRecurring && !runId) {
      return NextResponse.json(
        {
          error:
            "One-off allowances must be assigned to an exact draft payroll run (payroll_run_id).",
          code: "ONE_OFF_REQUIRES_PAYROLL_RUN",
        },
        { status: 400 }
      )
    }

    if (runId) {
      const { data: run } = await supabase
        .from("payroll_runs")
        .select("id, status, business_id")
        .eq("id", runId)
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .maybeSingle()
      if (!run) {
        return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
      }
      if (run.status !== "draft") {
        return NextResponse.json(
          { error: "One-off allowances can only be assigned to draft payroll runs." },
          { status: 400 }
        )
      }
    }

    const { data: allowance, error } = await supabase
      .from("allowances")
      .insert({
        staff_id: staffId,
        type: normalizedType,
        amount: Number(amount),
        recurring: isRecurring,
        description: description?.trim() || null,
        payroll_run_id: runId,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating allowance:", error)
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This one-off allowance is already assigned to that payroll run." },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: error.message || "Failed to create allowance" },
        { status: 500 }
      )
    }

    if (runId) {
      const businessCountry = business.address_country || business.country_code || null
      if (businessCountry) {
        const recalc = await recalcPayrollEntryForStaffOnDraftRun({
          supabase,
          businessId: business.id,
          businessCountry,
          runId,
          staffId,
        })
        if (!recalc.ok) {
          await supabase.from("allowances").delete().eq("id", allowance.id)
          return NextResponse.json({ error: recalc.error }, { status: recalc.status })
        }
      }
    }

    return NextResponse.json({ allowance }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


