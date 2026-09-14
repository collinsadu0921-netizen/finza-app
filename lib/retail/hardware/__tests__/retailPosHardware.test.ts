import {
  buildCashDrawerKickBytes,
  buildCustomerDisplayBytes,
  formatCustomerDisplayLines,
  padDisplayLine,
  saleIncludesCashTender,
} from "@/lib/retail/hardware/customerDisplayProtocol"

describe("customer display lines", () => {
  it("shows idle 0.00", () => {
    const lines = formatCustomerDisplayLines({ kind: "idle" })
    expect(lines.line1.trim()).toBe("THANK YOU")
    expect(lines.line2.trim()).toBe("0.00")
    expect(lines.line1).toHaveLength(20)
    expect(lines.line2).toHaveLength(20)
  })

  it("shows latest item and running total", () => {
    const lines = formatCustomerDisplayLines({
      kind: "item",
      itemName: "Bottled water extra long name",
      runningTotal: 12.5,
      currencyCode: "GHS",
    })
    expect(lines.line1.startsWith("Bottled water extra")).toBe(true)
    expect(lines.line2).toContain("12.50")
  })

  it("shows amount due at checkout", () => {
    const lines = formatCustomerDisplayLines({
      kind: "due",
      amountDue: 11.75,
      currencyCode: "GHS",
    })
    expect(lines.line1.trim()).toBe("AMOUNT DUE")
    expect(lines.line2).toContain("11.75")
  })

  it("shows tendered and change after cash payment", () => {
    const lines = formatCustomerDisplayLines({
      kind: "tendered",
      tendered: 20,
      change: 8.25,
      currencyCode: "GHS",
    })
    expect(lines.line1).toContain("20.00")
    expect(lines.line2).toContain("8.25")
  })

  it("pads to 20 columns", () => {
    expect(padDisplayLine("HI")).toBe("HI                  ")
  })

  it("builds ESC/POS VFD bytes without throwing", () => {
    const bytes = buildCustomerDisplayBytes("HELLO", "0.00")
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
    expect(bytes.length).toBeGreaterThan(20)
  })
})

describe("cash drawer trigger", () => {
  it("opens for cash-only sales", () => {
    expect(saleIncludesCashTender({ paymentMethod: "Cash" })).toBe(true)
    expect(saleIncludesCashTender({ paymentMethod: "cash" })).toBe(true)
  })

  it("does not open for card or mobile money", () => {
    expect(saleIncludesCashTender({ paymentMethod: "Card" })).toBe(false)
    expect(saleIncludesCashTender({ paymentMethod: "Mobile money" })).toBe(false)
    expect(saleIncludesCashTender({ paymentMethod: "momo" })).toBe(false)
  })

  it("opens for split payments that include cash", () => {
    expect(
      saleIncludesCashTender({
        paymentMethod: "Split payment",
        paymentBreakdown: [
          { method: "cash", amount: 5 },
          { method: "momo", amount: 6.75 },
        ],
      })
    ).toBe(true)
  })

  it("does not open for split payments without cash", () => {
    expect(
      saleIncludesCashTender({
        paymentMethod: "Split payment",
        paymentBreakdown: [
          { method: "card", amount: 5 },
          { method: "momo", amount: 6.75 },
        ],
      })
    ).toBe(false)
  })

  it("sends standard drawer-kick pulses for pin 2 and pin 5", () => {
    const bytes = buildCashDrawerKickBytes()
    expect(Array.from(bytes)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa])
  })
})
