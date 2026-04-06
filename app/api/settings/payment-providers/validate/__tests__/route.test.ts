import { POST } from "../route"

describe("POST /api/settings/payment-providers/validate", () => {
  it("returns 501 stub", async () => {
    const res = await POST()
    expect(res.status).toBe(501)
    const body = await res.json()
    expect(body.error).toBe("validation_not_implemented")
  })
})
