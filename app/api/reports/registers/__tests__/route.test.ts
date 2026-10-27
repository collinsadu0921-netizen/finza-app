import { GET } from "@/app/api/reports/registers/route"

describe("GET /api/reports/registers", () => {
  it("returns the retired-report 410 contract", async () => {
    const res = await GET()

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toEqual({
      code: "LEDGER_READ_BLOCKED",
      error: "This report uses ledger data. Use accounting workspace reports.",
      canonical_alternative: "/api/accounting/reports/registers",
    })
  })
})
