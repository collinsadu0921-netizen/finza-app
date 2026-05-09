import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { syncBatchStatusFromItems } from "@/lib/payroll/paymentBatchItems"

const ITEM_STATUSES = new Set(["pending", "paid", "failed", "skipped", "cancelled"])

function parseIsoDateOrNull(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null
  const s = String(v).trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params:
      | Promise<{ id: string; batchId: string; itemId: string }>
      | { id: string; batchId: string; itemId: string }
  }
) {
  try {
    const { id: runId, batchId, itemId } = await Promise.resolve(params)
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

    const { data: batch, error: bErr } = await supabase
      .from("payroll_payment_batches")
      .select("id, status")
      .eq("id", batchId)
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .maybeSingle()

    if (bErr || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 })
    }

    if (batch.status === "cancelled") {
      return NextResponse.json({ error: "Cannot update items on a cancelled batch." }, { status: 400 })
    }
    if (batch.status === "paid") {
      return NextResponse.json({ error: "Cannot update items on a completed batch." }, { status: 400 })
    }

    const { data: item, error: iErr } = await supabase
      .from("payroll_payment_batch_items")
      .select("*")
      .eq("id", itemId)
      .eq("batch_id", batchId)
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .maybeSingle()

    if (iErr || !item) {
      return NextResponse.json({ error: "Batch item not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))

    const nextStatus =
      typeof body.status === "string" && body.status.trim() ? body.status.trim() : undefined
    if (!nextStatus || !ITEM_STATUSES.has(nextStatus)) {
      return NextResponse.json(
        { error: "status must be one of: pending, paid, failed, skipped, cancelled" },
        { status: 400 }
      )
    }

    if (nextStatus === "paid" && body.manual_confirm !== true) {
      return NextResponse.json(
        {
          error:
            'Marking an item paid requires manual_confirm: true (confirms the transfer was done outside Finza; this does not post to the ledger).',
        },
        { status: 400 }
      )
    }

    const failure_reason =
      body.failure_reason === undefined
        ? undefined
        : body.failure_reason === null || body.failure_reason === ""
          ? null
          : String(body.failure_reason).trim() || null

    const payment_reference =
      body.payment_reference === undefined
        ? undefined
        : body.payment_reference === null || body.payment_reference === ""
          ? null
          : String(body.payment_reference).trim() || null

    const paid_at: string | null =
      nextStatus === "paid"
        ? body.paid_at !== undefined
          ? parseIsoDateOrNull(body.paid_at) ?? new Date().toISOString()
          : new Date().toISOString()
        : null

    const patch: Record<string, unknown> = { status: nextStatus, paid_at }
    if (failure_reason !== undefined) patch.failure_reason = failure_reason
    if (payment_reference !== undefined) patch.payment_reference = payment_reference

    const { data: updatedItem, error: uErr } = await supabase
      .from("payroll_payment_batch_items")
      .update(patch)
      .eq("id", itemId)
      .select()
      .single()

    if (uErr || !updatedItem) {
      console.error("[batch item PATCH]", uErr)
      return NextResponse.json({ error: uErr?.message || "Failed to update item" }, { status: 500 })
    }

    const { data: allItems, error: allErr } = await supabase
      .from("payroll_payment_batch_items")
      .select(
        "status, destination_method_type, destination_bank_name, destination_account_number, destination_momo_provider, destination_momo_number"
      )
      .eq("batch_id", batchId)
      .is("deleted_at", null)

    if (allErr) {
      console.error("[batch item PATCH reload]", allErr)
      return NextResponse.json({ item: updatedItem, batch: null, warning: "Item updated but batch sync failed" })
    }

    const newBatchStatus = syncBatchStatusFromItems(
      String(batch.status),
      (allItems || []) as Array<{
        status: string
        destination_method_type: string | null
        destination_bank_name: string | null
        destination_account_number: string | null
        destination_momo_provider: string | null
        destination_momo_number: string | null
      }>
    )

    const { data: updatedBatch, error: bUpErr } = await supabase
      .from("payroll_payment_batches")
      .update({ status: newBatchStatus })
      .eq("id", batchId)
      .select()
      .single()

    if (bUpErr) {
      console.error("[batch item PATCH batch update]", bUpErr)
      return NextResponse.json({ item: updatedItem, batch: null, warning: "Item updated but batch status sync failed" })
    }

    return NextResponse.json({ item: updatedItem, batch: updatedBatch })
  } catch (e: any) {
    console.error("[batch item PATCH]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
