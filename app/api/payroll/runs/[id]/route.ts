import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { logAudit } from "@/lib/auditLog"
import { derivePayrollPaymentSummary } from "@/lib/payroll/payrollPaymentSummary"
import {
  enforceServiceIndustryMinTier,
  enforceServiceIndustryMinTierWrite,
} from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  isGhanaMonthlyStatutoryEngine,
  nonMonthlyApprovalBlockedMessage,
} from "@/lib/payroll/salaryBasis"
import { validateGhanaPayrollRunForApproval } from "@/lib/payroll/ghanaApprovalGuards"
import { mapApprovePayrollRunAtomicError } from "@/lib/payroll/mapApprovePayrollAtomicError"

export async function GET(
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

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const tierDeniedGet = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDeniedGet) return tierDeniedGet

    const { allowed: canView } = await requirePermission(
      supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW
    )
    if (!canView) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    // Get payroll run
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("id", runId)
      .is("deleted_at", null)
      .single()

    if (runError || !payrollRun) {
      return NextResponse.json(
        { error: "Payroll run not found" },
        { status: 404 }
      )
    }

    // Get payroll entries with staff details
    const { data: entries, error: entriesError } = await supabase
      .from("payroll_entries")
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
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    if (entriesError) {
      console.error("Error fetching payroll entries:", entriesError)
    }

    const { data: payrollPayments, error: paymentsError } = await supabase
      .from("payroll_payments")
      .select(
        `
        id,
        payroll_run_id,
        payment_date,
        amount,
        payment_account_id,
        reference,
        notes,
        journal_entry_id,
        created_at,
        payment_account:payment_account_id (
          id,
          name,
          code,
          sub_type,
          type
        )
      `
      )
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })

    if (paymentsError) {
      console.error("Error fetching payroll payments:", paymentsError)
    }

    const paidAmount = (payrollPayments || []).reduce((sum, payment: any) => sum + Number(payment.amount || 0), 0)
    const latestPaymentDate = (payrollPayments || [])[0]?.payment_date ?? null
    const paymentSummary = derivePayrollPaymentSummary(
      Number(payrollRun.total_net_salary || 0),
      paidAmount,
      latestPaymentDate
    )

    return NextResponse.json({
      payrollRun,
      entries: entries || [],
      payments: payrollPayments || [],
      paymentSummary,
    })
  } catch (error: any) {
    console.error("Error fetching payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
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

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const tierDeniedPut = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDeniedPut) return tierDeniedPut

    const body = await request.json()
    const { status, notes } = body

    // Get existing payroll run
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select(
        "status, journal_entry_id, payroll_frequency, calculation_engine_version, paye_rate_version, pension_rate_version, calculation_jurisdiction, statutory_period_basis"
      )
      .eq("id", runId)
      .single()

    if (!existingRun) {
      return NextResponse.json(
        { error: "Payroll run not found" },
        { status: 404 }
      )
    }

    // Permission check — depends on the requested status transition
    // Approve retries (idempotent) still require PAYROLL_APPROVE.
    if (status === "approved" || (status && status !== existingRun.status)) {
      const permissionRequired =
        status === "locked"   ? PERMISSIONS.PAYROLL_LOCK    :
        status === "approved" ? PERMISSIONS.PAYROLL_APPROVE :
        PERMISSIONS.PAYROLL_CREATE

      const { allowed } = await requirePermission(
        supabase, user.id, business.id, permissionRequired
      )
      if (!allowed) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
      }
    }

    // Validate status transitions (enforce workflow: draft → approved → locked)
    // Atomic approval may be retried when already approved (idempotent reuse).
    if (status && status !== existingRun.status) {
      const validTransitions: Record<string, string[]> = {
        'draft': ['approved'],
        'approved': ['locked'],
        'locked': [], // Locked payroll cannot be changed
      }

      const allowedTransitions = validTransitions[existingRun.status] || []
      const isIdempotentApproveRetry =
        status === "approved" &&
        (existingRun.status === "approved" || existingRun.status === "locked")

      if (!allowedTransitions.includes(status) && !isIdempotentApproveRetry) {
        return NextResponse.json(
          { error: `Invalid status transition from "${existingRun.status}" to "${status}". Allowed transitions: ${allowedTransitions.join(', ') || 'none'}` },
          { status: 400 }
        )
      }
    }

    // Atomic approval: one RPC owns journal + advances + obligations + status + audit
    if (status === "approved") {
      const frequency = String(existingRun.payroll_frequency || "monthly").toLowerCase()
      const businessCountry = business.address_country || business.country_code || null
      if (
        existingRun.status === "draft" &&
        frequency !== "monthly" &&
        isGhanaMonthlyStatutoryEngine(businessCountry)
      ) {
        return NextResponse.json(
          {
            error: nonMonthlyApprovalBlockedMessage(frequency),
            code: "NON_MONTHLY_STATUTORY_APPROVAL_BLOCKED",
          },
          { status: 400 }
        )
      }

      // Optional preflight (UI-friendly). Authoritative validation runs inside the RPC after lock.
      if (existingRun.status === "draft") {
        const { data: approvalEntries, error: approvalEntriesError } = await supabase
          .from("payroll_entries")
          .select(
            `
            staff_id,
            is_included,
            calculation_engine_version,
            paye_rate_version,
            pension_rate_version,
            calculation_jurisdiction,
            statutory_period_basis,
            payroll_tax_profile,
            filing_employee_name,
            staff:staff_id (
              id,
              name,
              employment_type,
              is_tax_resident,
              secondary_employment
            )
          `
          )
          .eq("payroll_run_id", runId)

        if (approvalEntriesError) {
          return NextResponse.json(
            { error: `Failed to validate payroll entries before approval: ${approvalEntriesError.message}` },
            { status: 500 }
          )
        }

        const ghanaGuard = validateGhanaPayrollRunForApproval({
          businessCountry,
          run: existingRun,
          entries: (approvalEntries || []) as any,
        })
        if (!ghanaGuard.ok) {
          return NextResponse.json(
            {
              error: ghanaGuard.message,
              code: ghanaGuard.code,
              affectedEmployees: ghanaGuard.affectedEmployees,
            },
            { status: 400 }
          )
        }

        const { data: entries, error: entriesError } = await supabase
          .from("payroll_entries")
          .select("is_included, gross_salary, deductions_total, ssnit_employee, ssnit_employer, paye, net_salary")
          .eq("payroll_run_id", runId)

        if (entriesError) {
          return NextResponse.json(
            { error: `Failed to validate payroll entries before approval: ${entriesError.message}` },
            { status: 500 }
          )
        }

        const safe = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
        const aggregated = (entries || [])
          .filter((entry: { is_included?: boolean | null }) => entry.is_included !== false)
          .reduce(
            (acc, entry: any) => {
              acc.gross += safe(entry.gross_salary)
              acc.deductions += safe(entry.deductions_total)
              acc.ssnitEmployee += safe(entry.ssnit_employee)
              acc.ssnitEmployer += safe(entry.ssnit_employer)
              acc.paye += safe(entry.paye)
              acc.net += safe(entry.net_salary)
              return acc
            },
            { gross: 0, deductions: 0, ssnitEmployee: 0, ssnitEmployer: 0, paye: 0, net: 0 }
          )

        const { data: runTotals, error: runTotalsError } = await supabase
          .from("payroll_runs")
          .select("total_gross_salary, total_deductions, total_ssnit_employee, total_ssnit_employer, total_paye, total_net_salary")
          .eq("id", runId)
          .single()

        if (runTotalsError || !runTotals) {
          return NextResponse.json(
            { error: "Failed to load payroll run totals for reconciliation." },
            { status: 500 }
          )
        }

        const TOLERANCE = 0.01
        const mismatches: string[] = []
        if (Math.abs(safe(runTotals.total_gross_salary) - aggregated.gross) > TOLERANCE) mismatches.push("gross salary")
        if (Math.abs(safe(runTotals.total_deductions) - aggregated.deductions) > TOLERANCE) mismatches.push("deductions")
        if (Math.abs(safe(runTotals.total_ssnit_employee) - aggregated.ssnitEmployee) > TOLERANCE) mismatches.push("employee statutory")
        if (Math.abs(safe(runTotals.total_ssnit_employer) - aggregated.ssnitEmployer) > TOLERANCE) mismatches.push("employer statutory")
        if (Math.abs(safe(runTotals.total_paye) - aggregated.paye) > TOLERANCE) mismatches.push("income tax")
        if (Math.abs(safe(runTotals.total_net_salary) - aggregated.net) > TOLERANCE) mismatches.push("net salary")

        if (mismatches.length > 0) {
          return NextResponse.json(
            {
              error: `Payroll reconciliation failed before approval. Please regenerate run totals (${mismatches.join(", ")} mismatch).`,
              code: "PAYROLL_TOTALS_OUT_OF_SYNC",
            },
            { status: 400 }
          )
        }
      }

      const { data: approvalResult, error: approvalError } = await supabase.rpc(
        "approve_payroll_run_atomic",
        {
          p_business_id: business.id,
          p_payroll_run_id: runId,
        }
      )

      if (approvalError) {
        console.error("Atomic payroll approval failed:", approvalError)
        const mapped = mapApprovePayrollRunAtomicError(approvalError)
        const { status: httpStatus, ...payload } = mapped
        return NextResponse.json(payload, { status: httpStatus })
      }

      if (notes !== undefined) {
        await supabase
          .from("payroll_runs")
          .update({ notes: notes?.trim() || null })
          .eq("id", runId)
          .eq("business_id", business.id)
      }

      const { data: payrollRun, error: reloadError } = await supabase
        .from("payroll_runs")
        .select("*")
        .eq("id", runId)
        .single()

      if (reloadError || !payrollRun) {
        return NextResponse.json(
          {
            error: reloadError?.message || "Approved but failed to reload payroll run",
            approval: approvalResult,
          },
          { status: 500 }
        )
      }

      return NextResponse.json({
        payrollRun,
        approval: approvalResult,
        reused: Boolean((approvalResult as { reused?: boolean } | null)?.reused),
      })
    }

    const updateData: any = {}
    if (status) {
      updateData.status = status
    }
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    const { data: payrollRun, error } = await supabase
      .from("payroll_runs")
      .update(updateData)
      .eq("id", runId)
      .select()
      .single()

    if (error) {
      console.error("Error updating payroll run:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Audit non-approval status changes only (approval audit is inside the DB transaction)
    if (status && status !== existingRun.status) {
      const actionType =
        status === "locked" ? "payroll.run_locked" : "payroll.run_updated"

      await logAudit({
        businessId: business.id,
        userId: user.id,
        actionType,
        entityType: "payroll_run",
        entityId: runId,
        oldValues: { status: existingRun.status },
        newValues: { status },
        description: `Payroll run ${runId} status changed from ${existingRun.status} to ${status}`,
        request,
      })
    }

    return NextResponse.json({
      payrollRun,
    })
  } catch (error: any) {
    console.error("Error updating payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const tierDeniedDelete = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDeniedDelete) return tierDeniedDelete

    const { allowed } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_CREATE
    )
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data: existingRun, error: fetchError } = await supabase
      .from("payroll_runs")
      .select("id, business_id, status, journal_entry_id")
      .eq("id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .maybeSingle()

    if (fetchError || !existingRun) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
    }

    if (existingRun.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft payroll runs can be deleted." },
        { status: 400 }
      )
    }

    if (existingRun.journal_entry_id) {
      return NextResponse.json(
        { error: "This payroll run has accounting records and cannot be deleted." },
        { status: 400 }
      )
    }

    const { count: paymentCount, error: paymentsError } = await supabase
      .from("payroll_payments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)

    if (paymentsError) {
      return NextResponse.json({ error: paymentsError.message }, { status: 500 })
    }

    if ((paymentCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "Payroll runs with salary payments cannot be deleted." },
        { status: 400 }
      )
    }

    const deletedAt = new Date().toISOString()

    const { error: entriesDeleteError } = await supabase
      .from("payroll_entries")
      .delete()
      .eq("payroll_run_id", runId)

    if (entriesDeleteError) {
      return NextResponse.json({ error: entriesDeleteError.message }, { status: 500 })
    }

    await supabase
      .from("payroll_payment_batches")
      .update({ deleted_at: deletedAt })
      .eq("payroll_run_id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)

    await supabase.from("payslips").delete().eq("payroll_run_id", runId)

    const { error: deleteError } = await supabase
      .from("payroll_runs")
      .update({ deleted_at: deletedAt })
      .eq("id", runId)
      .eq("business_id", business.id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    await logAudit({
      businessId: business.id,
      userId: user.id,
      actionType: "payroll.run_deleted",
      entityType: "payroll_run",
      entityId: runId,
      oldValues: { status: existingRun.status },
      newValues: { deleted_at: deletedAt },
      description: `Deleted draft payroll run ${runId}`,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

