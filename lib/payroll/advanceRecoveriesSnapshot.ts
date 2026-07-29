/**
 * Immutable salary-advance recovery snapshots for payroll entries.
 */

import { roundPayroll } from "@/lib/payrollEngine/versioning"
import { computeOutstandingAmount } from "@/lib/payroll/salaryAdvanceRepayments"

export type AdvanceRecoverySnapshotItem = {
  advanceId: string
  deductionId: string | null
  staffId: string
  amount: number
}

export type DeductionWithAdvance = {
  id?: string | null
  amount?: number | null
  advance_id?: string | null
  type?: string | null
}

export type AdvanceBalanceRow = {
  id: string
  staff_id: string
  business_id?: string | null
  amount: number
  repaid_amount?: number | null
  status?: string | null
  cancelled_at?: string | null
}

export const SALARY_ADVANCE_RECOVERY_EXCEEDS_OUTSTANDING =
  "SALARY_ADVANCE_RECOVERY_EXCEEDS_OUTSTANDING"

/** Normalize + validate a recovery snapshot array from DB/JSON. */
export function normalizeAdvanceRecoveriesSnapshot(raw: unknown): AdvanceRecoverySnapshotItem[] {
  if (!Array.isArray(raw)) return []
  const byAdvance = new Map<string, AdvanceRecoverySnapshotItem>()
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const advanceId = String(row.advanceId ?? row.advance_id ?? "").trim()
    const staffId = String(row.staffId ?? row.staff_id ?? "").trim()
    const amount = roundPayroll(Number(row.amount))
    if (!advanceId || !staffId || !(amount > 0)) continue
    const deductionRaw = row.deductionId ?? row.deduction_id
    const deductionId =
      deductionRaw == null || String(deductionRaw).trim() === ""
        ? null
        : String(deductionRaw).trim()
    // Deduplicate by advance within one entry — keep first positive amount.
    if (!byAdvance.has(advanceId)) {
      byAdvance.set(advanceId, { advanceId, deductionId, staffId, amount })
    }
  }
  return Array.from(byAdvance.values())
}

export function sumAdvanceRecoveries(snapshot: AdvanceRecoverySnapshotItem[]): number {
  return roundPayroll(snapshot.reduce((sum, item) => sum + Number(item.amount || 0), 0))
}

/**
 * Cap advance-linked deductions to outstanding balances and build the immutable snapshot.
 * Ordinary deductions pass through unchanged (and are not snapshotted).
 */
export function applyAdvanceRecoveryCaps(opts: {
  staffId: string
  businessId?: string | null
  deductions: DeductionWithAdvance[] | null | undefined
  advances: AdvanceBalanceRow[] | null | undefined
}): {
  deductionsForCalc: Array<DeductionWithAdvance & { amount: number }>
  advanceRecoveriesSnapshot: AdvanceRecoverySnapshotItem[]
} {
  const advancesById = new Map(
    (opts.advances || [])
      .filter((a) => a && a.id)
      .map((a) => [String(a.id), a] as const)
  )

  const deductionsForCalc: Array<DeductionWithAdvance & { amount: number }> = []
  const snapshot: AdvanceRecoverySnapshotItem[] = []
  const claimedByAdvance = new Map<string, number>()

  for (const ded of opts.deductions || []) {
    const rawAmount = roundPayroll(Number(ded.amount || 0))
    if (!(rawAmount > 0)) continue

    const advanceId = ded.advance_id ? String(ded.advance_id).trim() : ""
    if (!advanceId) {
      deductionsForCalc.push({ ...ded, amount: rawAmount })
      continue
    }

    const advance = advancesById.get(advanceId)
    if (
      !advance ||
      String(advance.staff_id) !== String(opts.staffId) ||
      advance.cancelled_at ||
      advance.status === "cancelled" ||
      advance.status === "cleared"
    ) {
      // Linked advance invalid for this employee — do not recover via payroll.
      continue
    }
    if (
      opts.businessId &&
      advance.business_id &&
      String(advance.business_id) !== String(opts.businessId)
    ) {
      continue
    }

    const outstanding = computeOutstandingAmount(
      Number(advance.amount),
      Number(advance.repaid_amount || 0)
    )
    const alreadyClaimed = claimedByAdvance.get(advanceId) || 0
    const remaining = roundPayroll(Math.max(0, outstanding - alreadyClaimed))
    const capped = roundPayroll(Math.min(rawAmount, remaining))
    if (!(capped > 0)) continue

    claimedByAdvance.set(advanceId, roundPayroll(alreadyClaimed + capped))
    deductionsForCalc.push({ ...ded, amount: capped })
    snapshot.push({
      advanceId,
      deductionId: ded.id ? String(ded.id) : null,
      staffId: String(opts.staffId),
      amount: capped,
    })
  }

  return { deductionsForCalc, advanceRecoveriesSnapshot: snapshot }
}

export function assertRecoveriesWithinDeductionsTotal(
  snapshot: AdvanceRecoverySnapshotItem[],
  deductionsTotal: number
): string | null {
  const sum = sumAdvanceRecoveries(snapshot)
  if (sum - roundPayroll(deductionsTotal) > 0.01) {
    return `Advance recoveries (${sum}) exceed deductions_total (${deductionsTotal})`
  }
  return null
}

export function payrollAdvanceRepaymentIdentity(
  payrollRunId: string,
  payrollEntryId: string,
  salaryAdvanceId: string
): string {
  return `payroll:${payrollRunId}:${payrollEntryId}:${salaryAdvanceId}`
}
