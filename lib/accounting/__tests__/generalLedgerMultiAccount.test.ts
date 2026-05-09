import {
  filterAccountsByCodeRange,
  PAYROLL_LIABILITY_PRESET_CODES,
} from "@/lib/accounting/resolveGeneralLedgerAccountSelection"
import type { GeneralLedgerAccountRow } from "@/lib/accounting/resolveGeneralLedgerAccount"

function row(code: string, id = code): GeneralLedgerAccountRow {
  return { id, code, name: `Account ${code}`, type: "liability" }
}

describe("filterAccountsByCodeRange", () => {
  const sorted: GeneralLedgerAccountRow[] = [
    row("1000"),
    row("2230"),
    row("2231"),
    row("2232"),
    row("3000"),
  ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))

  it("returns three accounts for range 2230 to 2232", () => {
    const r = filterAccountsByCodeRange(sorted, "2230", "2232")
    expect(r.map((a) => a.code)).toEqual(["2230", "2231", "2232"])
  })

  it("handles reversed from/to", () => {
    const r = filterAccountsByCodeRange(sorted, "2232", "2230")
    expect(r.map((a) => a.code)).toEqual(["2230", "2231", "2232"])
  })

  it("returns separate rows per code (no merged balances)", () => {
    const r = filterAccountsByCodeRange(sorted, "2230", "2231")
    expect(r).toHaveLength(2)
    expect(r[0].id).not.toBe(r[1].id)
  })
})

describe("PAYROLL_LIABILITY_PRESET_CODES", () => {
  it("includes 2241 employee deductions", () => {
    expect([...PAYROLL_LIABILITY_PRESET_CODES]).toContain("2241")
    expect([...PAYROLL_LIABILITY_PRESET_CODES]).toEqual(["2230", "2231", "2232", "2240", "2241"])
  })
})
