import { describe, it, expect } from "@jest/globals"
import {
  computeFilingTaxAmounts,
  mapVatPaymentRpcError,
  reconcileVatFilingToLedger,
  vatPaymentState,
} from "@/lib/vat/vatReturnPayment"

const filing = {
  total_output_vat: 1662.5,
  total_input_vat: 287.5,
  total_output_nhil: 277.08,
  total_input_nhil: 47.91,
  total_output_getfund: 277.08,
  total_input_getfund: 47.91,
  total_output_covid: 0,
  total_input_covid: 0,
  net_vat_payable: 1833.34,
}

describe("VAT return payment reconciliation", () => {
  it("computes the filing split per tax control account", () => {
    expect(computeFilingTaxAmounts(filing)).toEqual({
      "2100": 1375,
      "2110": 229.17,
      "2120": 229.17,
      "2130": 0,
    })
  })

  it("accepts a filing that matches the filing-period ledger movement", () => {
    const result = reconcileVatFilingToLedger(filing, [
      { code: "2100", amount: 1375 },
      { code: "2110", amount: 229.17 },
      { code: "2120", amount: 229.17 },
      { code: "2130", amount: 0 },
    ])
    expect(result.ok).toBe(true)
    expect(result.difference).toBe(0)
    expect(result.filingTotal).toBe(1833.34)
    expect(result.ledgerTotal).toBe(1833.34)
  })

  it("surfaces the staging July mismatch using period movement only", () => {
    const result = reconcileVatFilingToLedger(filing, [
      { code: "2100", amount: 1234.15 },
      { code: "2110", amount: 205.77 },
      { code: "2120", amount: 205.77 },
      { code: "2130", amount: 0 },
    ])
    expect(result.ok).toBe(false)
    expect(result.filingTotal).toBe(1833.34)
    expect(result.ledgerTotal).toBe(1645.69)
    expect(result.difference).toBe(187.65)
    expect(result.accounts.find((row) => row.code === "2100")?.difference).toBe(140.85)
    expect(result.accounts.find((row) => row.code === "2110")?.difference).toBe(23.4)
    expect(result.accounts.find((row) => row.code === "2120")?.difference).toBe(23.4)
  })

  it("rejects a filing whose split does not add up to the filing total", () => {
    const result = reconcileVatFilingToLedger(
      { ...filing, total_output_vat: 1700 },
      [
        { code: "2100", amount: 1412.5 },
        { code: "2110", amount: 229.17 },
        { code: "2120", amount: 229.17 },
      ]
    )
    expect(result.filingMatchesNetPayable).toBe(false)
    expect(result.ok).toBe(false)
  })
})

describe("VAT payment state", () => {
  it("distinguishes recorded payments from legacy paid filings", () => {
    expect(
      vatPaymentState({ status: "paid", payment_journal_entry_id: "je-1" })
    ).toBe("paid_recorded")
    expect(
      vatPaymentState({ status: "paid", payment_journal_entry_id: null })
    ).toBe("paid_without_payment")
    expect(
      vatPaymentState({ status: "submitted", payment_journal_entry_id: null })
    ).toBe("unpaid")
  })
})

describe("VAT payment error mapping", () => {
  it("maps reconciliation details and status", () => {
    const mapped = mapVatPaymentRpcError({
      message: "VAT_PAYMENT_RECONCILIATION_MISMATCH",
      details: JSON.stringify({
        message: "The filing does not match the ledger.",
        filing_total: 1833.34,
        ledger_total: 1645.69,
        difference: 187.65,
        accounts: [{ code: "2100", difference: 140.85 }],
      }),
    })
    expect(mapped.status).toBe(409)
    expect(mapped.body.error).toBe("VAT_PAYMENT_RECONCILIATION_MISMATCH")
    expect(mapped.body.difference).toBe(187.65)
    expect(mapped.body.filing_total).toBe(1833.34)
    expect(mapped.body.message).toBe("The filing does not match the ledger.")
  })

  it("maps a legacy paid-without-journal error", () => {
    const mapped = mapVatPaymentRpcError({
      message: "VAT_PAYMENT_LEGACY_PAID_WITHOUT_JOURNAL",
      details: '{"vat_return_id":"abc"}',
    })
    expect(mapped.status).toBe(409)
    expect(mapped.body.error).toBe("VAT_PAYMENT_LEGACY_PAID_WITHOUT_JOURNAL")
  })
})
