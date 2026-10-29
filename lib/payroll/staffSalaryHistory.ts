/**
 * Read-only employee salary-history helpers.
 *
 * Payment status is based only on confirmed employee-level batch payments.
 * Run-level aggregate payments are never allocated to an employee here.
 */

export type EmployeeSalaryPaymentStatus =
  | "paid"
  | "partially_paid"
  | "unpaid"
  | "unverified"

export type EmployeeSalaryPaymentSummary = {
  payment_status: EmployeeSalaryPaymentStatus
  payment_status_label: string
  confirmed_paid_amount: number
  outstanding_amount: number | null
  unverified_amount: number
  has_unallocated_aggregate_payment: boolean
}

export type EmployeeSalarySummaryRow = {
  net_salary: number | string | null
  confirmed_paid_amount: number | string | null
  payment_status: EmployeeSalaryPaymentStatus
  outstanding_amount: number | string | null
  unverified_amount: number | string | null
  is_reversed_run: boolean
}

const TOLERANCE = 0.01

export function roundPayrollMoney(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

export function deriveEmployeeSalaryPaymentSummary(input: {
  netSalary: number | string | null
  confirmedPaid: number | string | null
  hasUnallocatedAggregatePayment: boolean
}): EmployeeSalaryPaymentSummary {
  const net = roundPayrollMoney(input.netSalary)
  const paid = roundPayrollMoney(input.confirmedPaid)

  if (net <= TOLERANCE) {
    return {
      payment_status: "paid",
      payment_status_label: "No net pay",
      confirmed_paid_amount: paid,
      outstanding_amount: 0,
      unverified_amount: 0,
      has_unallocated_aggregate_payment: input.hasUnallocatedAggregatePayment,
    }
  }

  if (paid >= net - TOLERANCE) {
    return {
      payment_status: "paid",
      payment_status_label: "Paid",
      confirmed_paid_amount: paid,
      outstanding_amount: 0,
      unverified_amount: 0,
      has_unallocated_aggregate_payment: input.hasUnallocatedAggregatePayment,
    }
  }

  if (paid > TOLERANCE) {
    const remaining = roundPayrollMoney(Math.max(0, net - paid))
    if (input.hasUnallocatedAggregatePayment) {
      return {
        payment_status: "partially_paid",
        payment_status_label: "Partially paid — balance not individually verified",
        confirmed_paid_amount: paid,
        outstanding_amount: null,
        unverified_amount: remaining,
        has_unallocated_aggregate_payment: true,
      }
    }

    return {
      payment_status: "partially_paid",
      payment_status_label: "Partially paid",
      confirmed_paid_amount: paid,
      outstanding_amount: remaining,
      unverified_amount: 0,
      has_unallocated_aggregate_payment: false,
    }
  }

  if (input.hasUnallocatedAggregatePayment) {
    return {
      payment_status: "unverified",
      payment_status_label: "Payment not individually verified",
      confirmed_paid_amount: 0,
      outstanding_amount: null,
      unverified_amount: net,
      has_unallocated_aggregate_payment: true,
    }
  }

  return {
    payment_status: "unpaid",
    payment_status_label: "Unpaid",
    confirmed_paid_amount: 0,
    outstanding_amount: net,
    unverified_amount: 0,
    has_unallocated_aggregate_payment: false,
  }
}

export function summarizeEmployeeSalaryHistory(rows: EmployeeSalarySummaryRow[]): {
  total_net_salary: number
  total_confirmed_paid: number
  total_outstanding: number
  total_unverified: number
  total_reversed_net_salary: number
  period_count: number
} {
  let totalNet = 0
  let totalPaid = 0
  let totalOutstanding = 0
  let totalUnverified = 0
  let totalReversed = 0

  for (const row of rows) {
    const net = roundPayrollMoney(row.net_salary)
    if (row.is_reversed_run) {
      totalReversed += net
      continue
    }

    totalNet += net
    totalPaid += roundPayrollMoney(row.confirmed_paid_amount)
    totalOutstanding += roundPayrollMoney(row.outstanding_amount)
    totalUnverified += roundPayrollMoney(row.unverified_amount)
  }

  return {
    total_net_salary: roundPayrollMoney(totalNet),
    total_confirmed_paid: roundPayrollMoney(totalPaid),
    total_outstanding: roundPayrollMoney(totalOutstanding),
    total_unverified: roundPayrollMoney(totalUnverified),
    total_reversed_net_salary: roundPayrollMoney(totalReversed),
    period_count: rows.length,
  }
}
