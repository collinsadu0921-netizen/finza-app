import { resolveNetSalaryExportPayoutFields, type StaffLegacyBankFields } from "@/lib/staffPaymentMethods"

/** Full default payment method row as loaded from DB (for snapshots). */
export type StaffPaymentMethodRowForBatch = {
  id: string
  staff_id: string
  method_type: string
  provider_name?: string | null
  bank_name?: string | null
  bank_code?: string | null
  branch_name?: string | null
  account_number?: string | null
  account_name?: string | null
  momo_provider?: string | null
  momo_number?: string | null
}

export type PayrollEntryForBatchItem = {
  id: string
  staff_id: string
  net_salary: number | string | null
  staff?: {
    id?: string
    name?: string | null
    bank_name?: string | null
    bank_account?: string | null
    phone?: string | null
  } | null
}

export type BuiltBatchItemInsert = {
  business_id: string
  payroll_run_id: string
  payroll_entry_id: string
  staff_id: string
  employee_name: string | null
  amount: number
  currency: string
  status: "pending"
  staff_payment_method_id: string | null
  destination_method_type: string | null
  destination_provider_name: string | null
  destination_bank_name: string | null
  destination_bank_code: string | null
  destination_branch_name: string | null
  destination_account_number: string | null
  destination_account_name: string | null
  destination_momo_provider: string | null
  destination_momo_number: string | null
  legacy_destination_source: string
}

const TOLERANCE = 0.01

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export function destinationSnapshotComplete(row: {
  destination_method_type: string | null
  destination_bank_name: string | null
  destination_account_number: string | null
  destination_momo_provider: string | null
  destination_momo_number: string | null
}): boolean {
  const mt = String(row.destination_method_type || "").toLowerCase()
  if (mt === "cash") return true
  if (mt === "bank") {
    return Boolean(
      String(row.destination_bank_name || "").trim() && String(row.destination_account_number || "").trim()
    )
  }
  if (mt === "momo") {
    return Boolean(
      String(row.destination_momo_provider || "").trim() && String(row.destination_momo_number || "").trim()
    )
  }
  return false
}

/**
 * Build immutable batch item rows from payroll entries + default staff_payment_methods + legacy staff bank.
 */
export function buildPayrollPaymentBatchItemsFromEntries(input: {
  businessId: string
  payrollRunId: string
  currency?: string
  entries: PayrollEntryForBatchItem[]
  defaultMethodByStaffId: Map<string, StaffPaymentMethodRowForBatch>
}): {
  items: BuiltBatchItemInsert[]
  totalAmount: number
  allDestinationsComplete: boolean
  sumMatchesRunNet: boolean
  entriesNetTotal: number
} {
  const currency = input.currency ?? "GHS"
  const items: BuiltBatchItemInsert[] = []
  let entriesNetTotal = 0

  for (const entry of input.entries) {
    const staffId = String(entry.staff_id || "").trim()
    const net = Number(entry.net_salary ?? 0)
    const safeNet = Number.isFinite(net) ? roundMoney(net) : 0
    entriesNetTotal += safeNet

    const staff = entry.staff || {}
    const legacy: StaffLegacyBankFields = {
      bank_name: staff.bank_name ?? null,
      bank_account: staff.bank_account ?? null,
      phone: staff.phone ?? null,
    }

    const method = staffId ? input.defaultMethodByStaffId.get(staffId) ?? null : null

    let legacy_destination_source = "missing"
    let staff_payment_method_id: string | null = null
    let destination_method_type: string | null = null
    let destination_provider_name: string | null = null
    let destination_bank_name: string | null = null
    let destination_bank_code: string | null = null
    let destination_branch_name: string | null = null
    let destination_account_number: string | null = null
    let destination_account_name: string | null = null
    let destination_momo_provider: string | null = null
    let destination_momo_number: string | null = null

    if (method) {
      staff_payment_method_id = method.id
      legacy_destination_source = "staff_payment_method"
      destination_method_type = String(method.method_type || "").toLowerCase() || null
      destination_provider_name = method.provider_name ?? null
      destination_bank_name = method.bank_name ?? null
      destination_bank_code = method.bank_code ?? null
      destination_branch_name = method.branch_name ?? null
      destination_account_number = method.account_number ?? null
      destination_account_name = method.account_name ?? null
      destination_momo_provider = method.momo_provider ?? null
      destination_momo_number = method.momo_number ?? null
    } else {
      const payout = resolveNetSalaryExportPayoutFields(legacy, null)
      const hasLegacyBank = Boolean(payout.bankName && payout.bankAccountNumber)
      const hasMomoFromPhone = Boolean(payout.momoProvider && payout.momoNumber)
      if (hasLegacyBank) {
        legacy_destination_source = "legacy_staff_bank"
        destination_method_type = "bank"
        destination_bank_name = payout.bankName || null
        destination_account_number = payout.bankAccountNumber || null
        destination_account_name = payout.accountName || null
      } else if (hasMomoFromPhone) {
        legacy_destination_source = "legacy_staff_bank"
        destination_method_type = "momo"
        destination_momo_provider = payout.momoProvider || null
        destination_momo_number = payout.momoNumber || null
        destination_account_name = payout.accountName || null
      } else {
        legacy_destination_source = "missing"
      }
    }

    const row: BuiltBatchItemInsert = {
      business_id: input.businessId,
      payroll_run_id: input.payrollRunId,
      payroll_entry_id: entry.id,
      staff_id: staffId,
      employee_name: staff.name ? String(staff.name).trim() || null : null,
      amount: safeNet,
      currency,
      status: "pending",
      staff_payment_method_id,
      destination_method_type,
      destination_provider_name,
      destination_bank_name,
      destination_bank_code,
      destination_branch_name,
      destination_account_number,
      destination_account_name,
      destination_momo_provider,
      destination_momo_number,
      legacy_destination_source,
    }

    items.push(row)
  }

  const totalAmount = roundMoney(items.reduce((s, r) => s + r.amount, 0))
  entriesNetTotal = roundMoney(entriesNetTotal)
  const allDestinationsComplete = items.every((r) => destinationSnapshotComplete(r))
  const sumMatchesRunNet = Math.abs(totalAmount - entriesNetTotal) <= TOLERANCE

  return { items, totalAmount, allDestinationsComplete, sumMatchesRunNet, entriesNetTotal }
}

export type ItemStatusCount = Record<string, number>

export function countItemStatuses(statuses: string[]): ItemStatusCount {
  const out: ItemStatusCount = {}
  for (const s of statuses) {
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}

/**
 * Terminal-ish batch status suggestion from non-deleted item statuses.
 * Skipped/cancelled items are excluded from paid/partial calculations.
 */
export function deriveBatchStatusFromItemStatuses(statuses: string[]): {
  suggested: string
} {
  const relevant = statuses.filter((s) => s !== "skipped" && s !== "cancelled")
  if (relevant.length === 0) {
    return { suggested: "cancelled" }
  }

  const allPaid = relevant.every((s) => s === "paid")
  const anyPaid = relevant.some((s) => s === "paid")
  const anyFailed = relevant.some((s) => s === "failed")
  const anyPending = relevant.some((s) => s === "pending")

  if (allPaid) return { suggested: "paid" }
  if (anyFailed && !anyPaid && !anyPending) return { suggested: "failed" }
  if (anyPaid && (anyPending || anyFailed)) return { suggested: "partially_paid" }
  if (anyFailed && anyPaid) return { suggested: "partially_paid" }
  if (anyFailed) return { suggested: "failed" }
  return { suggested: "processing" }
}

/** Reconcile batch header status from item rows (snapshots only). */
export function syncBatchStatusFromItems(
  currentBatchStatus: string,
  items: Array<{
    status: string
    destination_method_type: string | null
    destination_bank_name: string | null
    destination_account_number: string | null
    destination_momo_provider: string | null
    destination_momo_number: string | null
  }>
): string {
  if (currentBatchStatus === "cancelled") return "cancelled"

  const statuses = items.map((i) => i.status)
  const anyPaidOrFailed = statuses.some((s) => s === "paid" || s === "failed")

  if (!anyPaidOrFailed) {
    if (["processing", "pending_authorization"].includes(currentBatchStatus)) {
      return currentBatchStatus
    }
    const allComplete = items.every((i) => destinationSnapshotComplete(i))
    return allComplete ? "ready" : "draft"
  }

  return deriveBatchStatusFromItemStatuses(statuses).suggested
}

export function assertManualBatchStatusTransition(from: string, to: string): void {
  if (from === to) return
  if (from === "cancelled" || from === "paid") {
    throw new Error(`Batch status "${from}" cannot be changed.`)
  }
  if (to === "cancelled") {
    const cancelFrom = new Set([
      "draft",
      "ready",
      "pending_authorization",
      "processing",
      "partially_paid",
      "failed",
    ])
    if (!cancelFrom.has(from)) {
      throw new Error(`Cannot cancel batch from status "${from}".`)
    }
    return
  }

  const edges: Record<string, Set<string>> = {
    draft: new Set(["ready"]),
    ready: new Set(["draft", "processing", "pending_authorization"]),
    pending_authorization: new Set(["processing"]),
    processing: new Set([]),
    partially_paid: new Set([]),
    failed: new Set([]),
  }

  const allowed = edges[from]
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Invalid batch status transition: ${from} → ${to}`)
  }
}

export const BATCH_EXPORT_DISCLAIMER =
  "IMPORTANT: This file does not send money. Confirm transfers externally and record salary payment in Finza after funds leave the account."

export const BATCH_EXPORT_HEADERS = [
  "Batch ID",
  "Payroll Run ID",
  "Payroll Period",
  "Employee Name",
  "Staff ID",
  "Payroll Entry ID",
  "Amount",
  "Currency",
  "Method Type",
  "Bank Name",
  "Bank Code",
  "Branch Name",
  "Account Number",
  "Account Name",
  "MoMo Provider",
  "MoMo Number",
  "Destination Source",
  "Item Status",
  "Payment Reference",
  "Failure Reason",
] as const
