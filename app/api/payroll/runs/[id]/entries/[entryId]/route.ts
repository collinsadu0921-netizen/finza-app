import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  computeStaffPayrollEntry,
  isPayrollEngineCountryError,
} from "@/lib/payroll/computeStaffPayrollEntry"
import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"

async function syncPayrollRunTotals(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  runId: string
) {
  const { data: entries, error } = await supabase
    .from("payroll_entries")
    .select(
      "is_included, gross_salary, allowances_total, deductions_total, ssnit_employee, ssnit_employer, paye, net_salary"
    )
    .eq("payroll_run_id", runId)

  if (error) throw error

  const totals = rollupPayrollRunTotals(entries || [])
  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({
      ...totals,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)

  if (updateError) throw updateError
  return totals
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const { id: runId, entryId } = await params
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

    const tierDenied = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed: canEdit } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_CREATE
    )
    if (!canEdit) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data: payrollRun } = await supabase
      .from("payroll_runs")
      .select("id, business_id, status, payroll_month")
      .eq("id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!payrollRun) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
    }

    if (payrollRun.status !== "draft") {
      return NextResponse.json(
        { error: "Payroll lines can only be edited while the run is in draft status." },
        { status: 400 }
      )
    }

    const { data: existingEntry } = await supabase
      .from("payroll_entries")
      .select("*")
      .eq("id", entryId)
      .eq("payroll_run_id", runId)
      .single()

    if (!existingEntry) {
      return NextResponse.json({ error: "Payroll entry not found" }, { status: 404 })
    }

    const body = await request.json()
    const isIncluded =
      body.is_included !== undefined ? Boolean(body.is_included) : existingEntry.is_included !== false
    const adjustmentAmount =
      body.adjustment_amount !== undefined
        ? Number(body.adjustment_amount)
        : Number(existingEntry.adjustment_amount || 0)
    const adjustmentReason =
      body.adjustment_reason !== undefined
        ? body.adjustment_reason?.trim() || null
        : existingEntry.adjustment_reason
    const exclusionReason =
      body.exclusion_reason !== undefined
        ? body.exclusion_reason?.trim() || null
        : existingEntry.exclusion_reason

    if (!Number.isFinite(adjustmentAmount)) {
      return NextResponse.json({ error: "adjustment_amount must be a number" }, { status: 400 })
    }

    const { data: staff } = await supabase
      .from("staff")
      .select("*")
      .eq("id", existingEntry.staff_id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!staff) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
    }

    const businessCountry = business.address_country || business.country_code || null
    if (!businessCountry) {
      return NextResponse.json(
        { error: "Business country is required for payroll calculation." },
        { status: 400 }
      )
    }

    const [{ data: allowances }, { data: deductions }] = await Promise.all([
      supabase
        .from("allowances")
        .select("type, amount, recurring")
        .eq("staff_id", staff.id)
        .is("deleted_at", null),
      supabase
        .from("deductions")
        .select("amount")
        .eq("staff_id", staff.id)
        .is("deleted_at", null),
    ])

    let computed
    try {
      computed = computeStaffPayrollEntry({
        staff,
        businessCountry,
        effectiveDate: payrollRun.payroll_month,
        allowances: allowances || [],
        deductions: deductions || [],
        adjustmentAmount,
        isIncluded,
        baseSalarySnapshot: Number(existingEntry.base_salary_snapshot ?? staff.basic_salary) || 0,
        adjustmentReason: isIncluded ? adjustmentReason : null,
        exclusionReason: isIncluded ? null : exclusionReason,
      })
    } catch (error: unknown) {
      if (isPayrollEngineCountryError(error)) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    const { staff_id: _staffId, ...entryUpdate } = computed

    const { data: updatedEntry, error: updateError } = await supabase
      .from("payroll_entries")
      .update({
        ...entryUpdate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId)
      .eq("payroll_run_id", runId)
      .select(
        `
        *,
        staff (
          id,
          name,
          position,
          email,
          phone,
          whatsapp_phone
        )
      `
      )
      .single()

    if (updateError || !updatedEntry) {
      console.error("Error updating payroll entry:", updateError)
      return NextResponse.json(
        { error: updateError?.message || "Failed to update payroll entry" },
        { status: 500 }
      )
    }

    const runTotals = await syncPayrollRunTotals(supabase, runId)

    await logAudit({
      businessId: business.id,
      userId: user.id,
      actionType: "payroll.entry_updated",
      entityType: "payroll_entry",
      entityId: entryId,
      oldValues: {
        is_included: existingEntry.is_included,
        adjustment_amount: existingEntry.adjustment_amount,
      },
      newValues: {
        is_included: updatedEntry.is_included,
        adjustment_amount: updatedEntry.adjustment_amount,
        adjustment_reason: updatedEntry.adjustment_reason,
        exclusion_reason: updatedEntry.exclusion_reason,
      },
      description: `Updated payroll line for ${staff.name || "staff"} on run ${runId}`,
      request,
    })

    const { data: payrollRunUpdated } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("id", runId)
      .single()

    return NextResponse.json({
      entry: updatedEntry,
      payrollRun: payrollRunUpdated,
      runTotals,
    })
  } catch (error: unknown) {
    console.error("Error updating payroll entry:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
