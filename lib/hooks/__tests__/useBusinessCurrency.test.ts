/** @jest-environment node */

import {
  syncBusinessCurrencyFromRow,
  formatBusinessCurrencyAmount,
} from "@/lib/hooks/businessCurrencyCore"

describe("businessCurrencyCore", () => {
  it("syncs currency from workspace business row", () => {
    const synced = syncBusinessCurrencyFromRow({
      id: "biz-1",
      default_currency: "GHS",
    })

    expect(synced.businessId).toBe("biz-1")
    expect(synced.currencyCode).toBe("GHS")
    expect(synced.currencySymbol).toBeTruthy()
  })

  it("returns null currency when business has no default_currency", () => {
    const synced = syncBusinessCurrencyFromRow({
      id: "biz-2",
      default_currency: null,
    })

    expect(synced.currencyCode).toBeNull()
    expect(formatBusinessCurrencyAmount(10, synced.currencyCode)).toBe("—")
  })

  it("handles missing business row", () => {
    const synced = syncBusinessCurrencyFromRow(null)
    expect(synced.businessId).toBeNull()
    expect(synced.currencyCode).toBeNull()
  })
})
