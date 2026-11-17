import { describe, expect, it } from "@jest/globals"
import { computeExpenseTax } from "../computeExpenseTax"

const round2 = (v: number) => Math.round(v * 100) / 100

const AMOUNTS = [
  0.01, 0.05, 0.10, 0.99, 1.0, 1.23, 9.99, 10.0, 12.34, 99.99, 100.0,
  123.45, 999.99, 1000.0, 1234.56, 70000, 70001, 84000, 123456.78,
]

const REGIMES = [
  { label: "post-2026 (simplified 20%)", date: "2026-11-09" },
  { label: "pre-2026 (compound)", date: "2025-12-01" },
]

describe("computeExpenseTax rounding invariants (inclusive + exclusive)", () => {
  for (const { label, date } of REGIMES) {
    describe(label, () => {
      for (const amt of AMOUNTS) {
        it(`inclusive ${amt} preserves gross and balances`, () => {
          const r = computeExpenseTax(amt, true, "inclusive", date)
          // gross equals entered
          expect(r.total).toBe(round2(amt))
          // totalTax equals summed rounded components
          expect(r.totalTax).toBe(round2(r.nhil + r.getfund + r.covid + r.vat))
          // net + totalTax = gross
          expect(round2(r.baseAmount + r.totalTax)).toBe(r.total)
          // posting-derived base (total − summed components) equals persisted net
          expect(r.baseAmount).toBe(round2(r.total - r.totalTax))
        })

        it(`exclusive ${amt} preserves net and balances`, () => {
          const r = computeExpenseTax(amt, true, "exclusive", date)
          // net equals entered
          expect(r.baseAmount).toBe(round2(amt))
          // totalTax equals summed rounded components
          expect(r.totalTax).toBe(round2(r.nhil + r.getfund + r.covid + r.vat))
          // net + totalTax = gross
          expect(round2(r.baseAmount + r.totalTax)).toBe(r.total)
          // posting-derived base (total − summed components) equals persisted net
          expect(r.baseAmount).toBe(round2(r.total - r.totalTax))
        })
      }
    })
  }
})
