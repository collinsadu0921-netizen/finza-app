import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission, requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  buildPayrollPaymentBatchItemsFromEntries,
  countItemStatuses,
  type PayrollEntryForBatchItem,
  type StaffPaymentMethodRowForBatch,
} from "@/lib/payroll/paymentBatchItems"

async function getAuthorizedRun(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  runId: string
) {
  const { data: run, error } = await supabase
    .from("payroll_runs")
    .select("id, business_id, status, payroll_month")
    .eq("id", runId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .single()

  if (error || !run) return { error: NextResponse.json({ error: "Payroll run not found" }, { status: 404 }) }
  return { run }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: runId } = await Promise.resolve(params)
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

    const runAuth = await getAuthorizedRun(supabase, business.id, runId)
    if ("error" in runAuth) return runAuth.error

    const { data: batches, error: bErr } = await supabase
      .from("payroll_payment_batches")
      .select("*")
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (bErr) {
      console.error("[payment-batches GET]", bErr)
      return NextResponse.json({ error: bErr.message }, { status: 500 })
    }

    const list = batches || []
    const batchIds = list.map((b) => b.id)
    const statusCountsByBatch = new Map<string, Record<string, number>>()

    if (batchIds.length > 0) {
      const { data: itemRows, error: iErr } = await supabase
        .from("payroll_payment_batch_items")
        .select("batch_id, status")
        .in("batch_id", batchIds)
        .is("deleted_at", null)

      if (iErr) {
        console.error("[payment-batches GET items]", iErr)
        return NextResponse.json({ error: iErr.message }, { status: 500 })
      }

      for (const row of itemRows || []) {
        const bid = String((row as { batch_id: string }).batch_id)
        const st = String((row as { status: string }).status)
        const cur = statusCountsByBatch.get(bid) || {}
        cur[st] = (cur[st] ?? 0) + 1
        statusCountsByBatch.set(bid, cur)
      }
    }

    const enriched = list.map((b) => ({
      ...b,
      status_counts: statusCountsByBatch.get(String(b.id)) || {},
    }))

    return NextResponse.json({ batches: enriched })
  } catch (e: any) {
    console.error("[payment-batches GET]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: runId } = await Promise.resolve(params)
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const runAuth = await getAuthorizedRun(supabase, business.id, runId)
    if ("error" in runAuth) return runAuth.error
    const run = runAuth.run as { status: string }

    if (!["approved", "locked"].includes(run.status)) {
      return NextResponse.json(
        { error: "Payment batches can only be created for approved or locked payroll runs." },
        { status: 400 }
      )
    }

    const { data: existingBatch } = await supabase
      .from("payroll_payment_batches")
      .select("id")
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .neq("status", "cancelled")
      .is("deleted_at", null)
      .maybeSingle()

    if (existingBatch) {
      return NextResponse.json(
        { error: "An active payment batch already exists for this run. Cancel it before creating another." },
        { status: 409 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const funding_account_id =
      typeof body.funding_account_id === "string" && body.funding_account_id.trim()
        ? body.funding_account_id.trim()
        : null
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null

    const { data: entriesRaw, error: entErr } = await supabase
      .from("payroll_entries")
      .select(
        `
        id,
        staff_id,
        net_salary,
        staff:staff_id (
          id,
          name,
          bank_name,
          bank_account,
          phone
        )
      `
      )
      .eq("payroll_run_id", runId)

    if (entErr) {
      console.error("[payment-batches POST entries]", entErr)
      return NextResponse.json({ error: entErr.message }, { status: 500 })
    }

    const entries: PayrollEntryForBatchItem[] = (entriesRaw || []).map((row: any) => {
      const st = row.staff
      const staffObj = Array.isArray(st) ? st[0] : st
      return {
        id: row.id,
        staff_id: row.staff_id,
        net_salary: row.net_salary,
        staff: staffObj || null,
      }
    })

    if (entries.length === 0) {
      return NextResponse.json({ error: "No payroll entries found for this run." }, { status: 400 })
    }

    const staffIds = Array.from(new Set(entries.map((e) => String(e.staff_id)).filter(Boolean)))

    const defaultMethodByStaffId = new Map<string, StaffPaymentMethodRowForBatch>()
    if (staffIds.length > 0) {
      const { data: methods, error: mErr } = await supabase
        .from("staff_payment_methods")
        .select("*")
        .eq("business_id", business.id)
        .in("staff_id", staffIds)
        .eq("is_default", true)
        .is("deleted_at", null)

      if (mErr) {
        console.error("[payment-batches POST methods]", mErr)
        return NextResponse.json({ error: mErr.message }, { status: 500 })
      }

      for (const m of methods || []) {
        defaultMethodByStaffId.set(String((m as { staff_id: string }).staff_id), m as StaffPaymentMethodRowForBatch)
      }
    }

    const built = buildPayrollPaymentBatchItemsFromEntries({
      businessId: business.id,
      payrollRunId: runId,
      entries,
      defaultMethodByStaffId,
    })

    if (!built.sumMatchesRunNet) {
      return NextResponse.json(
        {
          error: "Batch item totals do not reconcile to payroll entry net salaries.",
          detail: { totalAmount: built.totalAmount, entriesNetTotal: built.entriesNetTotal },
        },
        { status: 400 }
      )
    }

    const initialStatus = built.allDestinationsComplete ? "ready" : "draft"

    const { data: batch, error: batchErr } = await supabase
      .from("payroll_payment_batches")
      .insert({
        business_id: business.id,
        payroll_run_id: runId,
        status: initialStatus,
        currency: "GHS",
        total_amount_snapshot: built.totalAmount,
        item_count: built.items.length,
        funding_account_id,
        notes,
        created_by: user.id,
      })
      .select()
      .single()

    if (batchErr || !batch) {
      console.error("[payment-batches POST batch]", batchErr)
      const code = (batchErr as { code?: string } | undefined)?.code
      if (code === "23505") {
        return NextResponse.json(
          { error: "An active payment batch already exists for this run. Cancel it before creating another." },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: batchErr?.message || "Failed to create batch" }, { status: 500 })
    }

    const batchId = String(batch.id)
    const rows = built.items.map((r) => ({
      ...r,
      batch_id: batchId,
    }))

    const { error: insErr } = await supabase.from("payroll_payment_batch_items").insert(rows)

    if (insErr) {
      console.error("[payment-batches POST items]", insErr)
      await supabase.from("payroll_payment_batches").delete().eq("id", batchId)
      const code = (insErr as { code?: string }).code
      if (code === "23505") {
        return NextResponse.json(
          { error: "An active payment batch already exists for this run. Cancel it before creating another." },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    const status_counts = countItemStatuses(built.items.map((i) => i.status))

    return NextResponse.json(
      {
        batch: { ...batch, status_counts },
      },
      { status: 201 }
    )
  } catch (e: any) {
    console.error("[payment-batches POST]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
