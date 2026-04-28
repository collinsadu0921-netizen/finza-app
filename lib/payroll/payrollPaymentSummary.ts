export type PayrollPaymentStatus = "unpaid" | "partially_paid" | "paid"

export function derivePayrollPaymentSummary(
  totalNetSalaryRaw: number | null | undefined,
  paidAmountRaw: number | null | undefined,
  latestPaymentDate: string | null
) {
  const totalNetSalary = Number(totalNetSalaryRaw || 0)
  const paidAmount = Number(paidAmountRaw || 0)
  const outstandingAmount = Math.max(0, totalNetSalary - paidAmount)
  const paymentStatus: PayrollPaymentStatus =
    paidAmount <= 0
      ? "unpaid"
      : outstandingAmount <= 0.01
      ? "paid"
      : "partially_paid"

  return {
    total_net_salary: totalNetSalary,
    paid_amount: paidAmount,
    outstanding_amount: outstandingAmount,
    payment_status: paymentStatus,
    latest_payment_date: latestPaymentDate,
  }
}
