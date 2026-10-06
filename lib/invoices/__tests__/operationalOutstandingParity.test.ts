import fs from "fs"
import path from "path"
import {
  isOperationallyUnpaid,
  sumOperationalUnpaid,
  type OperationalInvoiceStatusInput,
} from "../operationalReceivables"

const fixture: OperationalInvoiceStatusInput[] = [
  { status: "sent", dueDate: "2026-10-20", total: 100, payments: 0, appliedCredits: 0 },
  { status: "sent", dueDate: "2026-09-01", total: 45000, payments: 0, appliedCredits: 0 },
  { status: "partially_paid", dueDate: "2026-09-15", total: 1000, payments: 250, appliedCredits: 0 },
  { status: "paid", dueDate: "2026-08-01", total: 800, payments: 800, appliedCredits: 0 },
  { status: "draft", dueDate: "2026-09-01", total: 9999, payments: 0, appliedCredits: 0 },
  { status: "cancelled", dueDate: "2026-09-01", total: 45000, payments: 0, appliedCredits: 0 },
  { status: "sent", dueDate: "2026-11-01", total: 400, payments: 0, appliedCredits: 150 },
  ...Array.from({ length: 24 }, (_, index) => ({
    status: "sent",
    dueDate: "2026-12-01",
    total: 10,
    payments: 0,
    appliedCredits: 0,
  })),
]

describe("dashboard unpaid and invoices outstanding use one total", () => {
  const canonical = sumOperationalUnpaid(fixture)

  it("includes sent, past-due, partial, and credited balances, and excludes paid, draft, and cancelled", () => {
    expect(canonical).toBe(100 + 45000 + 750 + 250 + 24 * 10)
    expect(isOperationallyUnpaid(fixture[3])).toBe(false)
    expect(isOperationallyUnpaid(fixture[4])).toBe(false)
    expect(isOperationallyUnpaid(fixture[5])).toBe(false)
  })

  it("does not change when the invoice list moves to another page", () => {
    expect(fixture.length).toBeGreaterThan(25)
    const page1 = fixture.slice(0, 25)
    const page2 = fixture.slice(25)
    expect(sumOperationalUnpaid(page1)).not.toBe(canonical)
    expect(sumOperationalUnpaid(page2)).toBe(60)
    expect(sumOperationalUnpaid([...page2, ...page1])).toBe(canonical)
    expect(sumOperationalUnpaid(fixture)).toBe(canonical)
  })

  it("dashboard and invoices outstanding both call the operational unpaid loader", () => {
    const root = process.cwd()
    const dashboard = fs.readFileSync(
      path.join(root, "lib/server/serviceDashboardMetricsLoader.ts"),
      "utf8"
    )
    const invoicesRoute = fs.readFileSync(
      path.join(root, "app/api/invoices/operational-unpaid/route.ts"),
      "utf8"
    )
    const loader = fs.readFileSync(
      path.join(root, "lib/server/operationalUnpaidInvoicesLoader.ts"),
      "utf8"
    )
    expect(dashboard).toContain("loadOperationalUnpaidInvoicesSummary")
    expect(invoicesRoute).toContain("loadOperationalUnpaidInvoicesSummary")
    expect(loader).toContain('supabase.rpc("get_operational_unpaid_invoices_total"')
    expect(invoicesRoute).toContain("Not page-scoped")
  })
})
