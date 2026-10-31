import type { SupabaseClient } from "@supabase/supabase-js"
import {
  destinationFieldsFromPaymentMethod,
  type StaffPaymentMethodRowForBatch,
} from "./paymentBatchItems"

const BLOCKING_TRANSFER_STATUSES = new Set([
  "initiating",
  "awaiting_authorization",
  "pending",
  "successful",
  "requires_attention",
])

const DESTINATION_FIELDS = [
  "destination_method_type",
  "destination_provider_name",
  "destination_bank_name",
  "destination_bank_code",
  "destination_branch_name",
  "destination_account_number",
  "destination_account_name",
  "destination_momo_provider",
  "destination_momo_number",
] as const

/**
 * Refresh unpaid batch instructions from each employee's current default
 * payment method. Never touches amounts, statuses, paid items or destinations
 * with an initiated/pending/successful transfer.
 */
export async function refreshBatchItemDestinations(input: {
  supabase: SupabaseClient
  businessId: string
  payrollRunId: string
  batchId: string
}): Promise<{ updated: number }> {
  const { supabase, businessId, payrollRunId, batchId } = input

  const { data: items, error: itemsError } = await supabase
    .from("payroll_payment_batch_items")
    .select("*")
    .eq("business_id", businessId)
    .eq("payroll_run_id", payrollRunId)
    .eq("batch_id", batchId)
    .in("status", ["pending", "failed"])
    .is("deleted_at", null)

  if (itemsError || !items || items.length === 0) return { updated: 0 }

  const itemIds = items.map((item) => String(item.id))
  const { data: transfers } = await supabase
    .from("payroll_paystack_transfers")
    .select("batch_item_id, status")
    .eq("business_id", businessId)
    .eq("payroll_run_id", payrollRunId)
    .in("batch_item_id", itemIds)

  const blockedItemIds = new Set(
    (transfers || [])
      .filter((transfer) =>
        BLOCKING_TRANSFER_STATUSES.has(String(transfer.status || "").toLowerCase())
      )
      .map((transfer) => String(transfer.batch_item_id))
  )

  const staffIds = Array.from(new Set(items.map((item) => String(item.staff_id))))
  const { data: methods } = await supabase
    .from("staff_payment_methods")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_default", true)
    .in("staff_id", staffIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  const methodByStaff = new Map<string, StaffPaymentMethodRowForBatch>()
  for (const method of (methods || []) as StaffPaymentMethodRowForBatch[]) {
    if (!methodByStaff.has(String(method.staff_id))) methodByStaff.set(String(method.staff_id), method)
  }

  let updated = 0
  for (const item of items) {
    if (item.payroll_payment_id || blockedItemIds.has(String(item.id))) continue
    const method = methodByStaff.get(String(item.staff_id))
    if (!method) continue

    const dest = destinationFieldsFromPaymentMethod(method)
    const changed =
      String(item.staff_payment_method_id || "") !== String(method.id) ||
      DESTINATION_FIELDS.some((field) => (item[field] ?? null) !== dest[field])
    if (!changed) continue

    const { error: updateError } = await supabase
      .from("payroll_payment_batch_items")
      .update({
        ...dest,
        staff_payment_method_id: method.id,
        legacy_destination_source: "staff_payment_method",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("business_id", businessId)
      .eq("payroll_run_id", payrollRunId)
      .eq("batch_id", batchId)
      .in("status", ["pending", "failed"])
      .is("payroll_payment_id", null)
      .is("deleted_at", null)

    if (!updateError) updated += 1
  }

  return { updated }
}
