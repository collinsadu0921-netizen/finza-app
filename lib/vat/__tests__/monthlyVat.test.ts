import { describe, expect, it } from "@jest/globals"
import {
  resolveMonthlyVatNet,
  resolveMonthlyVatPosition,
} from "../monthlyVat"

const emptyLedger = {
  output_vat: 0,
  input_vat: 0,
  output_nhil: 0,
  input_nhil: 0,
  output_getfund: 0,
  input_getfund: 0,
  output_covid: 0,
  input_covid: 0,
}

describe("resolveMonthlyVatNet", () => {
  it("uses the canonical post-2026 net for an unfiled month", () => {
    const net = resolveMonthlyVatNet({
      month: "2026-11",
      ledger: {
        ...emptyLedger,
        output_vat: 12.5,
        output_nhil: 2.08,
        output_getfund: 2.08,
      },
    })

    expect(net).toBe(16.66)
  })

  it("uses the pre-2026 VAT-only net for an unfiled month", () => {
    const net = resolveMonthlyVatNet({
      month: "2025-12",
      ledger: {
        ...emptyLedger,
        output_vat: 15,
        output_nhil: 2.5,
        output_getfund: 2.5,
        output_covid: 1,
      },
    })

    expect(net).toBe(15)
  })

  it("prefers the immutable stored net for a filed month", () => {
    const net = resolveMonthlyVatNet({
      month: "2026-11",
      ledger: {
        ...emptyLedger,
        output_vat: 12.5,
        output_nhil: 2.08,
        output_getfund: 2.08,
        input_vat: 12.5,
        input_nhil: 2.08,
        input_getfund: 2.08,
      },
      filed: { net_vat_payable: 16.66, net_vat_refund: 0 },
    })

    expect(net).toBe(16.66)
  })

  it("returns a negative net for a filed refund", () => {
    const net = resolveMonthlyVatNet({
      month: "2026-10",
      ledger: emptyLedger,
      filed: { net_vat_payable: 0, net_vat_refund: 5 },
    })

    expect(net).toBe(-5)
  })

  it("returns zero for a zero/exempt month", () => {
    const net = resolveMonthlyVatNet({
      month: "2026-11",
      ledger: emptyLedger,
    })

    expect(net).toBe(0)
  })

  it("splits an unfiled pre-2026 month into VAT-only net and separate levies", () => {
    const position = resolveMonthlyVatPosition({
      month: "2025-12",
      ledger: {
        ...emptyLedger,
        output_vat: 130.43,
        input_vat: 130.43,
        output_nhil: 20.51,
        output_getfund: 20.51,
        output_covid: 8.2,
      },
    })

    expect(position.net_vat_payable).toBe(0)
    expect(position.net_vat_refund).toBe(0)
    expect(position.separate_levies_payable).toBe(49.22)
    expect(position.total_tax_payable).toBe(49.22)
    expect(position.total_tax_refund).toBe(0)
  })

  it("uses stored levy components for a filed pre-2026 month", () => {
    const position = resolveMonthlyVatPosition({
      month: "2025-12",
      ledger: emptyLedger,
      filed: {
        net_vat_payable: 0,
        net_vat_refund: 0,
        total_output_nhil: 20.51,
        total_output_getfund: 20.51,
        total_output_covid: 8.2,
      },
    })

    expect(position.net_vat_payable).toBe(0)
    expect(position.separate_levies_payable).toBe(49.22)
    expect(position.total_tax_payable).toBe(49.22)
  })

  it("does not offset a pre-2026 VAT refund against separate levies", () => {
    const position = resolveMonthlyVatPosition({
      month: "2025-12",
      ledger: {
        ...emptyLedger,
        output_vat: 10,
        input_vat: 20,
        output_nhil: 2.5,
        output_getfund: 2.5,
        output_covid: 1,
      },
    })

    expect(position.net_vat_refund).toBe(10)
    expect(position.separate_levies_payable).toBe(6)
    expect(position.total_tax_payable).toBe(6)
    expect(position.total_tax_refund).toBe(10)
  })

  it("keeps separate levies at zero for a post-2026 month", () => {
    const position = resolveMonthlyVatPosition({
      month: "2027-01",
      ledger: {
        ...emptyLedger,
        output_vat: 456.25,
        input_vat: 738.75,
        output_nhil: 76,
        input_nhil: 123.08,
        output_getfund: 76,
        input_getfund: 123.08,
      },
    })

    expect(position.net_vat_refund).toBe(376.66)
    expect(position.separate_levies_payable).toBe(0)
    expect(position.total_tax_payable).toBe(0)
    expect(position.total_tax_refund).toBe(376.66)
  })
})
