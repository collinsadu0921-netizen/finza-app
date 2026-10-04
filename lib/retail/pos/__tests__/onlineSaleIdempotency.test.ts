import {
  decideOnlineSaleReplay,
  normalizeClientSaleId,
  simulateUniqueInsertRace,
} from "../onlineSaleIdempotency"

const SALE_A = "11111111-1111-4111-8111-111111111111"
const SALE_B = "22222222-2222-4222-8222-222222222222"

describe("online sale idempotency", () => {
  it("replays a duplicate split submission instead of inserting again", () => {
    const existing = {
      id: "sale-split",
      amount: 10,
      business_id: "biz-a",
      register_id: "reg-1",
    }
    expect(
      decideOnlineSaleReplay(existing, { businessId: "biz-a", registerId: "reg-1", amount: 10 })
    ).toBe("replay")
    expect(simulateUniqueInsertRace([`biz-a|reg-1|${SALE_A}`, `biz-a|reg-1|${SALE_A}`])).toEqual([
      "inserted",
      "duplicate",
    ])
  })

  it("replays the same request instead of inserting again", () => {
    const existing = {
      id: "sale-1",
      amount: 25,
      business_id: "biz-a",
      register_id: "reg-1",
    }
    expect(
      decideOnlineSaleReplay(existing, { businessId: "biz-a", registerId: "reg-1", amount: 25 })
    ).toBe("replay")
    expect(normalizeClientSaleId(SALE_A)).toBe(SALE_A)
  })

  it("treats a concurrent duplicate as one insert and one unique collision", () => {
    const key = `biz-a|reg-1|${SALE_A}`
    expect(simulateUniqueInsertRace([key, key])).toEqual(["inserted", "duplicate"])
  })

  it("replays after an uncertain response when the first sale already exists", () => {
    const existing = {
      id: "sale-1",
      amount: "10.00",
      business_id: "biz-a",
      register_id: "reg-1",
    }
    expect(
      decideOnlineSaleReplay(existing, { businessId: "biz-a", registerId: "reg-1", amount: 10 })
    ).toBe("replay")
  })

  it("allows two different sales from the same register", () => {
    const first = `biz-a|reg-1|${SALE_A}`
    const second = `biz-a|reg-1|${SALE_B}`
    expect(simulateUniqueInsertRace([first, second])).toEqual(["inserted", "inserted"])
    expect(
      decideOnlineSaleReplay(null, { businessId: "biz-a", registerId: "reg-1", amount: 8 })
    ).toBe("insert")
  })

  it("conflicts when the same id is reused for a different amount", () => {
    expect(
      decideOnlineSaleReplay(
        { id: "sale-1", amount: 10, business_id: "biz-a", register_id: "reg-1" },
        { businessId: "biz-a", registerId: "reg-1", amount: 11 }
      )
    ).toBe("conflict")
  })
})
