import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { csvResponse, formatNumeric } from "@/lib/payroll/csvExport"
import { BATCH_EXPORT_DISCLAIMER, BATCH_EXPORT_HEADERS } from "@/lib/payroll/paymentBatchItems"

export async function GET(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; batchId: string }> | { id: string; batchId: string } }
) {
  try {
    const { id: runId, batchId } = await Promise.resolve(params)
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (tierDenied) return tierDenied

    const canView = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
    const canPay = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!canView && !canPay) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data: payrollRun, error: runErr } = await supabase
      .from("payroll_runs")
      .select("id, payroll_month")
      .eq("id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .maybeSingle()

    if (runErr || !payrollRun) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
    }

    const { data: batch, error: bErr } = await supabase
      .from("payroll_payment_batches")
      .select("id, payroll_run_id, export_filename")
      .eq("id", batchId)
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .maybeSingle()

    if (bErr || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 })
    }

    const { data: items, error: iErr } = await supabase
      .from("payroll_payment_batch_items")
      .select("*")
      .eq("batch_id", batchId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("employee_name", { ascending: true })

    if (iErr) {
      console.error("[batch export]", iErr)
      return NextResponse.json({ error: iErr.message }, { status: 500 })
    }

    const period = String(payrollRun.payroll_month || "").slice(0, 7)
    const rows: string[][] = [[BATCH_EXPORT_DISCLAIMER], [...BATCH_EXPORT_HEADERS]]

    for (const it of items || []) {
      const r = it as Record<string, unknown>
      rows.push([
        String(batch.id),
        String(batch.payroll_run_id),
        period,
        String(r.employee_name ?? ""),
        String(r.staff_id ?? ""),
        String(r.payroll_entry_id ?? ""),
        formatNumeric(r.amount),
        String(r.currency ?? "GHS"),
        String(r.destination_method_type ?? ""),
        String(r.destination_bank_name ?? ""),
        String(r.destination_bank_code ?? ""),
        String(r.destination_branch_name ?? ""),
        String(r.destination_account_number ?? ""),
        String(r.destination_account_name ?? ""),
        String(r.destination_momo_provider ?? ""),
        String(r.destination_momo_number ?? ""),
        String(r.legacy_destination_source ?? ""),
        String(r.status ?? ""),
        String(r.payment_reference ?? ""),
        String(r.failure_reason ?? ""),
      ])
    }

    const safePeriod = period.replace(/[^\d-]/g, "") || "period"
    const filename =
      (batch.export_filename && String(batch.export_filename).trim()) ||
      `payroll-salary-batch-${String(batch.id).slice(0, 8)}-${safePeriod}.csv`

    const res = csvResponse(filename, rows)

    if (!(batch as { export_filename?: string | null }).export_filename) {
      await supabase.from("payroll_payment_batches").update({ export_filename: filename }).eq("id", batchId)
    }

    return res
  } catch (e: any) {
    console.error("[batch export]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
