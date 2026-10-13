import { GET } from "../route"
import { NextRequest } from "next/server"

describe("GET /api/reports/sales-summary", () => {
  it("still returns 410 before any report calculation", async () => {
    const response = await GET(new NextRequest("http://localhost/api/reports/sales-summary"))
    expect(response.status).toBe(410)
    const body = await response.json()
    expect(body.code).toBe("LEDGER_ONLY_REPORT_REQUIRED")
  })
})
