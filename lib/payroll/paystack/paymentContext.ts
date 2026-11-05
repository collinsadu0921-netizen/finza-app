import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { loadPaystackPayrollConnection, type PaystackPayrollConnectionRow } from "./connection"
import { resolvePaystackDestination, type PaystackPayoutDestination } from "./destination"
import { fetchPaystackGhsBalancePesewas } from "./paystackClient"

export type PaystackPaymentContext = {
  run: {
    id: string
    status: string
    total_net_salary: number | null
    payroll_month: string | null
  }
  batch: {
    id: string
    status: string
    currency: string | null
    total_amount_snapshot: number | null
  }
  item: {
    id: string
    batch_id: string
    payroll_run_id: string
    payroll_entry_id: string
    staff_id: string
    employee_name: string | null
    amount: number
    currency: string | null
    status: string
    payroll_payment_id: string | null
    destination_method_type: string | null
    destination_provider_name: string | null
    destination_bank_name: string | null
    destination_bank_code: string | null
    destination_account_number: string | null
    destination_account_name: string | null
    destination_momo_provider: string | null
    destination_momo_number: string | null
  }
  connection: { row: PaystackPayrollConnectionRow; secretKey: string } | null
  balancePesewas: number | null
  balanceError: string | null
  hasUnallocatedAggregatePayment: boolean
  activeTransfer: {
    id: string
    status: string
    reference: string
    created_at: string
  } | null
  destination: PaystackPayoutDestination
}

export type PaystackPaymentContextError = {
  error: string
  code: string
  status: number
}

export async function loadPaystackPaymentContext(input: {
  supabase: SupabaseClient
  admin: SupabaseClient
  businessId: string
  runId: string
  batchId: string
  itemId: string
}): Promise<PaystackPaymentContext | PaystackPaymentContextError> {
  const { supabase, admin, businessId, runId, batchId, itemId } = input

  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select("id, status, total_net_salary, payroll_month, business_id, deleted_at")
    .eq("id", runId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (runError) return { error: runError.message, code: "RUN_LOOKUP_FAILED", status: 500 }
  if (!run) return { error: "Payroll run not found", code: "RUN_NOT_FOUND", status: 404 }

  const { data: batch, error: batchError } = await supabase
    .from("payroll_payment_batches")
    .select("id, status, currency, total_amount_snapshot, business_id, payroll_run_id, deleted_at")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .eq("payroll_run_id", runId)
    .is("deleted_at", null)
    .maybeSingle()

  if (batchError) return { error: batchError.message, code: "BATCH_LOOKUP_FAILED", status: 500 }
  if (!batch) return { error: "Payment batch not found", code: "BATCH_NOT_FOUND", status: 404 }

  const { data: item, error: itemError } = await supabase
    .from("payroll_payment_batch_items")
    .select("*")
    .eq("id", itemId)
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .eq("payroll_run_id", runId)
    .is("deleted_at", null)
    .maybeSingle()

  if (itemError) return { error: itemError.message, code: "ITEM_LOOKUP_FAILED", status: 500 }
  if (!item) return { error: "Employee payment instruction not found", code: "ITEM_NOT_FOUND", status: 404 }

  const { count: aggregateCount, error: aggregateError } = await admin
    .from("payroll_payments")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("payroll_run_id", runId)
    .is("deleted_at", null)
    .not("journal_entry_id", "is", null)
    .is("reversed_at", null)
    .is("batch_item_id", null)

  if (aggregateError) {
    return { error: aggregateError.message, code: "AGGREGATE_LOOKUP_FAILED", status: 500 }
  }

  const { data: activeTransfer, error: transferError } = await admin
    .from("payroll_paystack_transfers")
    .select("id, status, reference, created_at")
    .eq("business_id", businessId)
    .eq("batch_item_id", itemId)
    .in("status", ["initiating", "awaiting_authorization", "pending", "successful"])
    .maybeSingle()

  if (transferError) {
    return { error: transferError.message, code: "TRANSFER_LOOKUP_FAILED", status: 500 }
  }

  const connection = await loadPaystackPayrollConnection(admin, businessId)

  let balancePesewas: number | null = null
  let balanceError: string | null = null
  if (connection?.row.is_active && connection.secretKey && connection.row.status === "connected") {
    const balance = await fetchPaystackGhsBalancePesewas(connection.secretKey)
    if (balance.ok) {
      balancePesewas = balance.data.balance_pesewas
    } else {
      balanceError = balance.error
    }
  }

  const destination = resolvePaystackDestination({
    businessId,
    staffId: String(item.staff_id),
    destination: item,
  })

  return {
    run: {
      id: String(run.id),
      status: String(run.status),
      total_net_salary: run.total_net_salary != null ? Number(run.total_net_salary) : null,
      payroll_month: run.payroll_month != null ? String(run.payroll_month) : null,
    },
    batch: {
      id: String(batch.id),
      status: String(batch.status),
      currency: batch.currency != null ? String(batch.currency) : null,
      total_amount_snapshot:
        batch.total_amount_snapshot != null ? Number(batch.total_amount_snapshot) : null,
    },
    item: {
      id: String(item.id),
      batch_id: String(item.batch_id),
      payroll_run_id: String(item.payroll_run_id),
      payroll_entry_id: String(item.payroll_entry_id),
      staff_id: String(item.staff_id),
      employee_name: item.employee_name != null ? String(item.employee_name) : null,
      amount: Number(item.amount),
      currency: item.currency != null ? String(item.currency) : null,
      status: String(item.status),
      payroll_payment_id: item.payroll_payment_id != null ? String(item.payroll_payment_id) : null,
      destination_method_type: item.destination_method_type ?? null,
      destination_provider_name: item.destination_provider_name ?? null,
      destination_bank_name: item.destination_bank_name ?? null,
      destination_bank_code: item.destination_bank_code ?? null,
      destination_account_number: item.destination_account_number ?? null,
      destination_account_name: item.destination_account_name ?? null,
      destination_momo_provider: item.destination_momo_provider ?? null,
      destination_momo_number: item.destination_momo_number ?? null,
    },
    connection:
      connection?.secretKey && connection.row
        ? { row: connection.row, secretKey: connection.secretKey }
        : null,
    balancePesewas,
    balanceError,
    hasUnallocatedAggregatePayment: (aggregateCount ?? 0) > 0,
    activeTransfer: activeTransfer ? (activeTransfer as PaystackPaymentContext["activeTransfer"]) : null,
    destination,
  }
}
