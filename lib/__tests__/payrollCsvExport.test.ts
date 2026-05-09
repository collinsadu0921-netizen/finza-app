import { formatNumeric, toCsv } from "../payroll/csvExport"

describe("payroll CSV export helpers", () => {
  it("formats numeric values safely", () => {
    expect(formatNumeric(12)).toBe("12.00")
    expect(formatNumeric("3.456")).toBe("3.46")
    expect(formatNumeric(undefined)).toBe("0.00")
  })

  it("builds csv with escaped values and headers", () => {
    const csv = toCsv([
      ["Employee Name", "PAYE"],
      ['Doe, John', '12.50'],
    ])
    expect(csv).toContain("Employee Name,PAYE")
    expect(csv).toContain('"Doe, John",12.50')
  })
})

