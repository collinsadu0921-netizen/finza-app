import {
  aggregateExpenseBreakdownByCategory,
} from "@/lib/server/dashboardExpenseBreakdownLoader"

describe("aggregateExpenseBreakdownByCategory", () => {
  const entries = [
    { id: "je-expense", reference_type: "expense" },
    { id: "je-bill", reference_type: "bill" },
    { id: "je-payroll", reference_type: "payroll" },
    { id: "je-dep", reference_type: "depreciation" },
    { id: "je-rev", reference_type: "reversal" },
    { id: "je-manual", reference_type: "manual_journal" },
  ]

  it("groups expense-account movement by dashboard category", () => {
    const totals = aggregateExpenseBreakdownByCategory(entries, [
      { journal_entry_id: "je-expense", debit: 1666.68, credit: 0 },
      { journal_entry_id: "je-bill", debit: 4071, credit: 0 },
      { journal_entry_id: "je-payroll", debit: 7119, credit: 0 },
      { journal_entry_id: "je-dep", debit: 5683.31, credit: 0 },
      { journal_entry_id: "je-rev", debit: 0, credit: 2900 },
      { journal_entry_id: "je-manual", debit: 50, credit: 0 },
    ])

    expect(totals).toEqual({
      module: 1666.68,
      bills: 4071,
      payroll: 7119,
      depreciation: 2783.31,
      other: 50,
    })
  })

  it("ignores zero lines", () => {
    const totals = aggregateExpenseBreakdownByCategory(
      [{ id: "je-expense", reference_type: "expense" }],
      [{ journal_entry_id: "je-expense", debit: 0, credit: 0 }]
    )

    expect(totals.module).toBe(0)
  })
})
