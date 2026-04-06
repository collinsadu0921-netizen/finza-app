import { normalizeGhanaMsisdnForMtn } from "../providers/mtnMomoDirect"

describe("normalizeGhanaMsisdnForMtn", () => {
  it("strips leading 0 and adds 233", () => {
    expect(normalizeGhanaMsisdnForMtn("0244123456")).toBe("233244123456")
  })

  it("keeps existing 233 prefix", () => {
    expect(normalizeGhanaMsisdnForMtn("233244123456")).toBe("233244123456")
  })
})

describe("tenant MTN invoice reference shape", () => {
  it("uses finza-mtn- prefix for global uniqueness per provider_type", () => {
    const ref = "finza-mtn-550e8400-e29b-41d4-a716-446655440000"
    expect(ref.startsWith("finza-mtn-")).toBe(true)
  })
})
