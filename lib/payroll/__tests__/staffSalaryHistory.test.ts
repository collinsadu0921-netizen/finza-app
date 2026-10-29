import {
  deriveEmployeeSalaryPaymentSummary,
  summarizeEmployeeSalaryHistory,
} from "@/lib/payroll/staffSalaryHistory"

describe("employee salary payment status", () => {
  it("marks fully confirmed employee payments as paid", () => {
    const summary = deriveEmployeeSalaryPaymentSummary({
      netSalary: 1000,
      confirmedPaid: 1000,
      hasUnallocatedAggregatePayment: false,
    })
    expect(summary.payment_status).toBe("paid")
    expect(summary.outstanding_amount).toBe(0)
    expect(summary.confirmed_paid_amount).toBe(1000)
  })

  it("marks an individual partial payment as partially paid", () => {
    const summary = deriveEmployeeSalaryPaymentSummary({
      netSalary: 1000,
      confirmedPaid: 400,
      hasUnallocatedAggregatePayment: false,
    })
    expect(summary.payment_status).toBe("partially_paid")
    expect(summary.outstanding_amount).toBe(600)
    expect(summary.unverified_amount).toBe(0)
  })

  it("marks an unpaid salary without aggregate payments as unpaid", () => {
    const summary = deriveEmployeeSalaryPaymentSummary({
      netSalary: 1000,
      confirmedPaid: 0,
      hasUnallocatedAggregatePayment: false,
    })
    expect(summary.payment_status).toBe("unpaid")
    expect(summary.outstanding_amount).toBe(1000)
  })

  it("does not assume paid or unpaid when only an aggregate payment exists", () => {
    const summary = deriveEmployeeSalaryPaymentSummary({
      netSalary: 1000,
      confirmedPaid: 0,
      hasUnallocatedAggregatePayment: true,
    })
    expect(summary.payment_status).toBe("unverified")
    expect(summary.payment_status_label).toBe("Payment not individually verified")
    expect(summary.outstanding_amount).toBeNull()
    expect(summary.unverified_amount).toBe(1000)
  })

  it("keeps an unallocated balance unverified when a partial individual payment exists", () => {
    const summary = deriveEmployeeSalaryPaymentSummary({
      netSalary: 1000,
      confirmedPaid: 400,
      hasUnallocatedAggregatePayment: true,
    })
    expect(summary.payment_status).toBe("partially_paid")
    expect(summary.outstanding_amount).toBeNull()
    expect(summary.unverified_amount).toBe(600)
  })

  it("labels a zero-net payroll as no net pay instead of implying a payment", () => {
    const summary = deriveEmployeeSalaryPaymentSummary({
      netSalary: 0,
      confirmedPaid: 0,
      hasUnallocatedAggregatePayment: false,
    })
    expect(summary.payment_status).toBe("paid")
    expect(summary.payment_status_label).toBe("No net pay")
    expect(summary.outstanding_amount).toBe(0)
  })

  it("excludes reversed payroll from historical totals", () => {
    const summary = summarizeEmployeeSalaryHistory([
      {
        net_salary: 1000,
        confirmed_paid_amount: 1000,
        payment_status: "paid",
        outstanding_amount: 0,
        unverified_amount: 0,
        is_reversed_run: false,
      },
      {
        net_salary: 500,
        confirmed_paid_amount: 0,
        payment_status: "unpaid",
        outstanding_amount: 500,
        unverified_amount: 0,
        is_reversed_run: true,
      },
    ])
    expect(summary.total_net_salary).toBe(1000)
    expect(summary.total_confirmed_paid).toBe(1000)
    expect(summary.total_reversed_net_salary).toBe(500)
    expect(summary.period_count).toBe(2)
  })

  it("sums only individually established outstanding amounts", () => {
    const summary = summarizeEmployeeSalaryHistory([
      {
        net_salary: 1000,
        confirmed_paid_amount: 400,
        payment_status: "partially_paid",
        outstanding_amount: 600,
        unverified_amount: 0,
        is_reversed_run: false,
      },
      {
        net_salary: 800,
        confirmed_paid_amount: 200,
        payment_status: "partially_paid",
        outstanding_amount: null,
        unverified_amount: 600,
        is_reversed_run: false,
      },
    ])
    expect(summary.total_outstanding).toBe(600)
    expect(summary.total_unverified).toBe(600)
  })
})
