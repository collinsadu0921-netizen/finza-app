/**
 * @jest-environment node
 */
import { cashierPosBusinessBootstrap } from "../retail/cashierPosBusinessBootstrap"

describe("cashierPosBusinessBootstrap", () => {
  const session = { businessId: "biz-from-pin" }

  it("uses session business id when client cannot read businesses (RLS / no row)", () => {
    const out = cashierPosBusinessBootstrap(session, null)
    expect(out.businessId).toBe("biz-from-pin")
    expect(out.address_country).toBeNull()
    expect(out.default_currency).toBeNull()
  })

  it("prefers loaded business row when present", () => {
    const out = cashierPosBusinessBootstrap(session, {
      id: "biz-from-db",
      address_country: "GH",
      default_currency: "GHS",
    })
    expect(out.businessId).toBe("biz-from-db")
    expect(out.address_country).toBe("GH")
    expect(out.default_currency).toBe("GHS")
  })
})
