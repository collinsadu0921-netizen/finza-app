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
    expect(decision.updateRows).toBe(false)
    expect(decision.updateError).toBe(false)
    expect(decision.updatePagination).toBe(false)
    expect(decision.updateLoading).toBe(false)
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
    expect(decision.updateRows).toBe(true)
    expect(decision.updateError).toBe(true)
    expect(decision.clearError).toBe(false)
    expect(decision.updatePagination).toBe(true)
    expect(decision.updateLoading).toBe(true)
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
    expect(decision.updateRows).toBe(false)
    expect(decision.updateError).toBe(false)
    expect(decision.clearError).toBe(false)
    expect(decision.updatePagination).toBe(false)
    expect(decision.updateLoading).toBe(false)
  })

  it("cancelled invoices stay out of overdue pages, totalCount, and outstanding", () => {
    const sent = Array.from({ length: 26 }, (_, index) => ({
      id: `sent-${index}`,
      status: "sent",
      dueDate: "2026-09-01",
      issueDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
      total: 10,
    }))
    const rows = [
      ...sent,
      {
        id: "partial",
        status: "partially_paid",
        dueDate: "2026-09-01",
        issueDate: "2026-07-01",
        total: 1000,
        payments: 400,
      },
      {
        id: "cancelled",
        status: "cancelled",
        dueDate: "2026-09-01",
        issueDate: "2026-08-15",
        total: 45000,
      },
      {
        id: "draft",
        status: "draft",
        dueDate: "2026-09-01",
        issueDate: "2026-08-16",
        total: 9999,
      },
      {
        id: "paid",
        status: "paid",
        dueDate: "2026-09-01",
        issueDate: "2026-08-17",
        total: 800,
        payments: 800,
      },
    ]

    const page1 = pageOperationalOverdue(rows, 25, 0)
    const page2 = pageOperationalOverdue(rows, 25, 25)

    expect(page1.totalCount).toBe(27)
    expect(page2.totalCount).toBe(27)
    expect(page1.ids).toHaveLength(25)
    expect(page2.ids).toHaveLength(2)
    expect(page1.outstanding).toBe(26 * 10 + 600)
    expect(page2.outstanding).toBe(page1.outstanding)
    const ids = [...page1.ids, ...page2.ids]
    expect(ids).not.toContain("cancelled")
    expect(ids).not.toContain("draft")
    expect(ids).not.toContain("paid")
    expect(new Set([...page1.ids, ...page2.ids]).size).toBe(27)
  })

  it("migration 587 excludes draft and cancelled on both overdue overloads", () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/587_operational_overdue_exclude_cancelled.sql"
      ),
      "utf8"
    )
    const bodies = sql
      .split(/(?=CREATE OR REPLACE FUNCTION)/)
      .filter((part) => part.includes("CREATE OR REPLACE FUNCTION"))

    expect(bodies).toHaveLength(2)
    expect(bodies[0]).not.toContain("p_customer_approval_status")
    expect(bodies[1]).toContain("p_customer_approval_status")
    expect(sql.match(/i\.status NOT IN \('draft', 'cancelled'\)/g)).toHaveLength(2)
    expect(sql.match(/'total_count', \(SELECT COUNT\(\*\)::BIGINT FROM overdue\)/g)).toHaveLength(2)
    expect(sql.match(/LIMIT v_limit OFFSET v_offset/g)).toHaveLength(2)

    for (const body of bodies) {
      expect(body).toContain("i.business_id = p_business_id")
      expect(body).toContain("p.business_id = p_business_id")
      expect(body).toContain("cn.business_id = p_business_id")
      expect(body).toContain("c.business_id = p_business_id")
      expect(body).toContain("i.due_date < CURRENT_DATE")
      expect(body).toContain("FROM payments p")
      expect(body).toContain("cn.status = 'applied'")
      expect(body).toContain("wo.outstanding > 0")
      expect(body).toContain("SECURITY INVOKER")
      expect(body).toContain("SET search_path = public")
      expect(body).toContain("STABLE")
      expect(body).toContain("RETURNS JSONB")
      expect(body).not.toContain("SECURITY DEFINER")
    }

    expect(sql).not.toContain("i.status <> 'draft'")
    expect(sql).not.toMatch(/^GRANT\s+EXECUTE/m)
    expect(sql).not.toMatch(/^REVOKE\s+/m)
  })
})

function pageOperationalOverdue(
  rows: Array<{
    id: string
    status: string
    dueDate: string
    issueDate: string
    total: number
    payments?: number
    appliedCredits?: number
  }>,
  limit: number,
  offset: number
) {
  const overdue = rows
    .filter((row) => isOperationallyOverdue(row, TODAY))
    .sort((a, b) => (a.issueDate < b.issueDate ? 1 : a.issueDate > b.issueDate ? -1 : 0))
  const outstanding = overdue.reduce((sum, row) => sum + operationalRemainingBalance(row), 0)
  return {
    totalCount: overdue.length,
    ids: overdue.slice(offset, offset + limit).map((row) => row.id),
    outstanding: Math.round(outstanding * 100) / 100,
  }
}
