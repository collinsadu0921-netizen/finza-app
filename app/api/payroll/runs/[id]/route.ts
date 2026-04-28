import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { logAudit } from "@/lib/auditLog"
import { derivePayrollPaymentSummary } from "@/lib/payroll/payrollPaymentSummary"

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

    const body = await request.json()
    const { status, notes } = body
    let journalEntryId: string | null = null

    // Get existing payroll run
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select("status, journal_entry_id")
      .eq("id", runId)
      .single()

    if (!existingRun) {
      return NextResponse.json(
        { error: "Payroll run not found" },
        { status: 404 }
      )
    }

    // Permission check — depends on the requested status transition
    if (status && status !== existingRun.status) {
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
    if (status && status !== existingRun.status) {
      const validTransitions: Record<string, string[]> = {
        'draft': ['approved'],
        'approved': ['locked'],
        'locked': [], // Locked payroll cannot be changed
      }

      const allowedTransitions = validTransitions[existingRun.status] || []
      if (!allowedTransitions.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status transition from "${existingRun.status}" to "${status}". Allowed transitions: ${allowedTransitions.join(', ') || 'none'}` },
          { status: 400 }
        )
      }
    }

    // If approving, post to ledger (must succeed or approval fails)
    if (status === "approved" && existingRun.status !== "approved") {
      // Check if already posted
      if (existingRun.journal_entry_id) {
        return NextResponse.json(
          { error: "Payroll run has already been posted to ledger" },
          { status: 400 }
        )
      }

      const { data: entries, error: entriesError } = await supabase
        .from("payroll_entries")
        .select("gross_salary, deductions_total, ssnit_employee, ssnit_employer, paye, net_salary")
        .eq("payroll_run_id", runId)

      if (entriesError) {
        return NextResponse.json(
          { error: `Failed to validate payroll entries before approval: ${entriesError.message}` },
          { status: 500 }
        )
      }

      const safe = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
      const aggregated = (entries || []).reduce(
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
          { error: `Payroll reconciliation failed before approval. Please regenerate run totals (${mismatches.join(", ")} mismatch).` },
          { status: 400 }
        )
      }

      // Post to ledger - if this fails, approval must fail
      const { data: postedJournalId, error: ledgerError } = await supabase.rpc(
        "post_payroll_to_ledger",
        {
          p_payroll_run_id: runId,
        }
      )
      journalEntryId = postedJournalId ?? null

      if (ledgerError || !journalEntryId) {
        console.error("Error posting payroll to ledger:", ledgerError)
        return NextResponse.json(
          { error: ledgerError?.message || "Failed to post payroll to ledger. Approval cannot proceed." },
          { status: 500 }
        )
      }

      console.log("Payroll posted to ledger:", journalEntryId)
    }

    const updateData: any = {}
    if (status) {
      updateData.status = status
      if (status === "approved") {
        updateData.approved_by = user?.id || null
        updateData.approved_at = new Date().toISOString()
        if (journalEntryId) updateData.journal_entry_id = journalEntryId
      }
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

    // Audit the status change
    if (status && status !== existingRun.status) {
      const actionType =
        status === "approved" ? "payroll.run_approved" :
        status === "locked"   ? "payroll.run_locked"   :
        "payroll.run_updated"

      await logAudit({
        businessId: business.id,
        userId: user.id,
        actionType,
        entityType: "payroll_run",
        entityId: runId,
        oldValues: { status: existingRun.status },
        newValues: { status, journal_entry_id: journalEntryId ?? undefined },
        description: `Payroll run ${runId} status changed from ${existingRun.status} to ${status}`,
        request,
      })
    }

    return NextResponse.json({ payrollRun })
  } catch (error: any) {
    console.error("Error updating payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


