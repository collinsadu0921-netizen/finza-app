import { operationalRemainingBalance } from "../operationalReceivables"
import { invoiceCustomerStatusLabel } from "../invoiceCustomerPaymentDisplay"
import {
  listInvoiceBadgeLabel,
  presentInvoiceSettlement,
  sumRecordedPaymentAmounts,
} from "../invoiceSettlementPresentation"

describe("presentInvoiceSettlement", () => {
  it("labels a fully cash-paid invoice Paid in full", () => {
    const result = presentInvoiceSettlement({ total: 2000, payments: 2000, appliedCredits: 0 })
    expect(result.label).toBe("Paid in full")
    expect(result.remaining).toBe(0)
  })

  it("does not call a zero-cash full credit Paid in full", () => {
    const result = presentInvoiceSettlement({ total: 2000, payments: 0, appliedCredits: 2000 })
    expect(result.label).toBe("Fully credited")
    expect(result.label).not.toBe("Paid in full")
    expect(result.cash).toBe(0)
    expect(result.remaining).toBe(0)
  })

  it("labels partial cash without treating the invoice total as cash", () => {
    const result = presentInvoiceSettlement({ total: 2000, payments: 1000, appliedCredits: 0 })
    expect(result.label).toBe("Partially cash paid")
    expect(result.remaining).toBe(1000)
  })

  it("labels a partial credit with zero cash", () => {
    const result = presentInvoiceSettlement({ total: 2000, payments: 0, appliedCredits: 500 })
    expect(result.label).toBe("Partially credited")
    expect(result.remaining).toBe(1500)
  })

  it("labels mixed cash and credit and uses the canonical remaining balance", () => {
    const result = presentInvoiceSettlement({ total: 2000, payments: 1000, appliedCredits: 500 })
    expect(result.label).toBe("Mixed cash and credit")
    expect(result.remaining).toBe(
      operationalRemainingBalance({ total: 2000, payments: 1000, appliedCredits: 500 })
    )
    expect(result.remaining).toBe(500)
  })

  it("does not invent zero cash when amounts failed to load", () => {
    const result = presentInvoiceSettlement({
      total: 2000,
      payments: null,
      appliedCredits: null,
      amountsUnavailable: true,
    })
    expect(result.label).toBe("Amounts unavailable")
    expect(result.cash).toBeNull()
    expect(result.remaining).toBeNull()
    expect(result.amountsAvailable).toBe(false)
  })

  it("treats a missing amount as unavailable even when the other figure is zero", () => {
    const result = presentInvoiceSettlement({ total: 2000, payments: 0, appliedCredits: null })
    expect(result.label).toBe("Amounts unavailable")
    expect(result.cash).toBeNull()
  })

  it("sums multiple payments before choosing the label", () => {
    const cash = sumRecordedPaymentAmounts([400, 600])
    expect(cash).toBe(1000)
    expect(presentInvoiceSettlement({ total: 2000, payments: cash, appliedCredits: 0 }).label).toBe(
      "Partially cash paid"
    )
  })

  it("keeps the 0.01 settled boundary and treats 0.01 cash as zero", () => {
    expect(presentInvoiceSettlement({ total: 2000, payments: 1999.99, appliedCredits: 0 }).label).toBe(
      "Paid in full"
    )
    expect(presentInvoiceSettlement({ total: 2000, payments: 1999.98, appliedCredits: 0 }).label).toBe(
      "Partially cash paid"
    )
    expect(
      presentInvoiceSettlement({ total: 2000, payments: 0.01, appliedCredits: 1999.99 }).label
    ).toBe("Fully credited")
    expect(presentInvoiceSettlement({ total: 2000, payments: 0, appliedCredits: 0 }).label).toBe(
      "Outstanding"
    )
  })

  it("keeps draft and cancelled workflow labels", () => {
    expect(
      listInvoiceBadgeLabel({
        workflowBadgeKey: "draft",
        total: 2000,
        payments: 0,
        appliedCredits: 0,
      })
    ).toBe("Draft")
    expect(
      listInvoiceBadgeLabel({
        workflowBadgeKey: "cancelled",
        total: 2000,
        payments: 2000,
        appliedCredits: 0,
      })
    ).toBe("Cancelled")
    expect(
      listInvoiceBadgeLabel({
        workflowBadgeKey: "overdue",
        total: 2000,
        payments: 0,
        appliedCredits: 0,
      })
    ).toBe("Overdue")
  })

  it("replaces a stored paid badge when the invoice was fully credited", () => {
    expect(
      listInvoiceBadgeLabel({
        workflowBadgeKey: "paid",
        total: 2000,
        payments: 0,
        appliedCredits: 2000,
      })
    ).toBe("Fully credited")
  })

  it("uses the settlement words on customer paid copy and keeps overdue workflow copy", () => {
    expect(
      invoiceCustomerStatusLabel("paid", { total: 2000, payments: 0, appliedCredits: 2000 })
    ).toBe("Fully credited")
    expect(invoiceCustomerStatusLabel("paid")).toBe("Amounts unavailable")
    expect(
      invoiceCustomerStatusLabel("overdue", { total: 2000, payments: 0, appliedCredits: 0 })
    ).toBe("Overdue")
    expect(invoiceCustomerStatusLabel("draft")).toBe("Payment pending")
    expect(invoiceCustomerStatusLabel("cancelled")).toBe("Cancelled")
  })
})
