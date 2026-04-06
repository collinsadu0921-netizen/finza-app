import { POST } from "../route"

describe("POST /api/payments/momo/initiate (deprecated legacy stub)", () => {
  it("returns 410 and points to tenant invoice initiate", async () => {
    const res = await POST()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe("deprecated")
    expect(String(body.message)).toContain("/api/payments/momo/tenant/invoice/initiate")
  })
})
