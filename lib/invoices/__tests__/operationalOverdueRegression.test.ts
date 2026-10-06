import fs from "fs"
import path from "path"
import { commitInvoiceListFetch } from "../invoiceListClient"
import { isOperationallyOverdue, operationalRemainingBalance } from "../operationalReceivables"

const TODAY = "2026-10-06"

function row(overrides: {
  status: string
  dueDate?: string | null
  total: number
  payments?: number
  appliedCredits?: number
  deleted?: boolean
}) {
  return {
    status: overrides.status,
    dueDate: overrides.dueDate,
    total: overrides.total,
    payments: overrides.payments ?? 0,
    appliedCredits: overrides.appliedCredits ?? 0,
    deleted: overrides.deleted,
  }
}

describe("operational overdue regression", () => {
  it("A. selecting Overdue replaces the listed invoice ids", () => {
    const all = commitInvoiceListFetch({
      requestGeneration: 1,
      latestGeneration: 1,
      ok: true,
      previousIds: [],
      nextIds: ["inv-open", "inv-paid", "inv-overdue"],
    })
    const overdue = commitInvoiceListFetch({
      requestGeneration: 2,
      latestGeneration: 2,
      ok: true,
      previousIds: all.ids,
      nextIds: ["inv-overdue"],
    })
    expect(overdue.apply).toBe(true)
    expect(overdue.ids).toEqual(["inv-overdue"])
    expect(overdue.ids).not.toEqual(all.ids)
  })

  it("B. includes a past-due sent invoice with remaining balance", () => {
    expect(
      isOperationallyOverdue(row({ status: "sent", dueDate: "2026-09-01", total: 2200 }), TODAY)
    ).toBe(true)
  })

  it("C. includes a partially paid past-due invoice with remaining balance", () => {
    const input = row({
      status: "partially_paid",
      dueDate: "2026-09-01",
      total: 1000,
      payments: 400,
    })
    expect(operationalRemainingBalance(input)).toBe(600)
    expect(isOperationallyOverdue(input, TODAY)).toBe(true)
  })

  it("D. excludes a fully paid invoice whose due date is in the past", () => {
    expect(
      isOperationallyOverdue(
        row({ status: "paid", dueDate: "2026-09-01", total: 500, payments: 500 }),
        TODAY
      )
    ).toBe(false)
  })

  it("E. excludes a draft invoice", () => {
    expect(
      isOperationallyOverdue(row({ status: "draft", dueDate: "2026-09-01", total: 500 }), TODAY)
    ).toBe(false)
  })

  it("F. excludes a cancelled invoice even with a historical remaining balance", () => {
    expect(
      isOperationallyOverdue(
        row({ status: "cancelled", dueDate: "2026-09-01", total: 45000 }),
        TODAY
      )
    ).toBe(false)
  })

  it("subtracts applied credit notes from remaining balance", () => {
    expect(
      operationalRemainingBalance({ total: 1000, payments: 200, appliedCredits: 300 })
    ).toBe(500)
  })

  it("G. a stale All response cannot overwrite a newer Overdue response", () => {
    const decision = commitInvoiceListFetch({
      requestGeneration: 1,
      latestGeneration: 2,
      ok: true,
      previousIds: ["inv-overdue"],
      nextIds: ["inv-open", "inv-paid", "inv-overdue"],
    })
    expect(decision.apply).toBe(false)
    expect(decision.ids).toEqual(["inv-overdue"])
  })

  it("H. a failed Overdue request does not keep the previous All list", () => {
    const decision = commitInvoiceListFetch({
      requestGeneration: 2,
      latestGeneration: 2,
      ok: false,
      previousIds: ["inv-open", "inv-paid"],
      nextIds: ["inv-open", "inv-paid"],
    })
    expect(decision.apply).toBe(true)
    expect(decision.ids).toEqual([])
  })

  it("a failed request that is already stale does not clear the newer list", () => {
    const decision = commitInvoiceListFetch({
      requestGeneration: 1,
      latestGeneration: 2,
      ok: false,
      previousIds: ["inv-overdue"],
      nextIds: [],
    })
    expect(decision.apply).toBe(false)
    expect(decision.ids).toEqual(["inv-overdue"])
  })

  it("migration 583 excludes draft and cancelled using the operational outstanding formula", () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/583_operational_overdue_exclude_cancelled.sql"
      ),
      "utf8"
    )
    expect(sql).toContain("i.status NOT IN ('draft', 'cancelled')")
    expect(sql).toContain("i.due_date < CURRENT_DATE")
    expect(sql).toContain("FROM payments p")
    expect(sql).toContain("cn.status = 'applied'")
    expect(sql).toContain("wo.outstanding > 0")
    expect(sql).not.toContain("i.status <> 'draft'")
  })
})
