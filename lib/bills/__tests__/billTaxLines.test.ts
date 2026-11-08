import { describe, expect, it } from "@jest/globals"
import { ghanaTaxEngineCanonical } from "@/lib/taxEngine/jurisdictions/ghana"
import { emptyBillTaxResult, toBillTaxLinesJsonb } from "../billTaxLines"

describe("bill tax-line persistence", () => {
  it("absorbs pre-2026 non-creditable input levies into the absorption account", () => {
    const result = ghanaTaxEngineCanonical.calculateFromAmount(100, {
      jurisdiction: "GH",
      effectiveDate: "2025-12-31",
      taxInclusive: false,
      transactionType: "purchase",
    })
    const jsonb = toBillTaxLinesJsonb(result, "5200") as {
      tax_lines: Array<Record<string, unknown>>
      subtotal_excl_tax: number
      tax_total: number
      total_incl_tax: number
    }
    const byCode = Object.fromEntries(
      jsonb.tax_lines.map((line) => [line.code, line])
    )

    expect(jsonb.subtotal_excl_tax).toBe(100)
    expect(jsonb.tax_total).toBe(21.9)
    expect(jsonb.total_incl_tax).toBe(121.9)
    expect(byCode.NHIL.ledger_account_code).toBe("5200")
    expect(byCode.NHIL.ledger_side).toBe("debit")
    expect(byCode.NHIL.absorbed_to_cost).toBe(true)
    expect(byCode.NHIL.is_creditable_input).toBe(false)
    expect(byCode.GETFUND.ledger_account_code).toBe("5200")
    expect(byCode.COVID.ledger_account_code).toBe("5200")
    expect(byCode.VAT.ledger_account_code).toBe("2100")
    expect(byCode.VAT.ledger_side).toBe("debit")
    expect(byCode.VAT.is_creditable_input).toBe(true)
  })

  it("keeps post-2026 input tax in the control accounts", () => {
    const result = ghanaTaxEngineCanonical.calculateFromAmount(100, {
      jurisdiction: "GH",
      effectiveDate: "2026-01-01",
      taxInclusive: false,
      transactionType: "purchase",
    })
    const jsonb = toBillTaxLinesJsonb(result, "5200") as {
      tax_lines: Array<Record<string, unknown>>
    }
    const byCode = Object.fromEntries(
      jsonb.tax_lines.map((line) => [line.code, line])
    )

    expect(byCode.NHIL.ledger_account_code).toBe("2110")
    expect(byCode.GETFUND.ledger_account_code).toBe("2120")
    expect(byCode.VAT.ledger_account_code).toBe("2100")
    expect(byCode.NHIL.is_creditable_input).toBe(true)
    expect(byCode.NHIL.absorbed_to_cost).toBe(false)
  })

  it("uses inventory 1450 as the absorption account for material bills", () => {
    const result = ghanaTaxEngineCanonical.calculateFromAmount(100, {
      jurisdiction: "GH",
      effectiveDate: "2025-12-31",
      taxInclusive: false,
      transactionType: "purchase",
    })
    const jsonb = toBillTaxLinesJsonb(result, "1450") as {
      tax_lines: Array<Record<string, unknown>>
    }
    const nhil = jsonb.tax_lines.find((line) => line.code === "NHIL")
    expect(nhil?.ledger_account_code).toBe("1450")
  })

  it("records engine metadata even when taxes are off", () => {
    const jsonb = toBillTaxLinesJsonb(
      emptyBillTaxResult({
        baseAmount: 100,
        effectiveDate: "2025-12-31",
        pricingMode: "inclusive",
      }),
      "5200"
    ) as {
      tax_lines: unknown[]
      subtotal_excl_tax: number
      tax_total: number
      total_incl_tax: number
      meta: { effective_date_used: string; engine_version: string }
      pricing_mode: string
    }

    expect(jsonb.tax_lines).toEqual([])
    expect(jsonb.subtotal_excl_tax).toBe(100)
    expect(jsonb.tax_total).toBe(0)
    expect(jsonb.total_incl_tax).toBe(100)
    expect(jsonb.meta.effective_date_used).toBe("2025-12-31")
    expect(jsonb.meta.engine_version).toBe("GH-2025-A")
    expect(jsonb.pricing_mode).toBe("inclusive")
  })
})
