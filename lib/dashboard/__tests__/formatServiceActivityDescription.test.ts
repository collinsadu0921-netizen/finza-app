/**
 * Jest coverage for Service dashboard activity labels and bill/expense links.
 */
import { describe, it, expect } from "@jest/globals"
import {
  classifyLoanActivityKind,
  creditNoteDetailHref,
  expenseDetailHref,
  formatLoanActivityLabel,
  formatServiceActivityDescription,
  isCreditNoteReclassJournal,
  supplierBillDetailHref,
} from "../formatServiceActivityDescription"
import { mapJournalSourceToActivityType } from "@/lib/server/serviceDashboardActivityLoader"

describe("formatServiceActivityDescription", () => {
  it("labels supplier bills correctly", () => {
    expect(
      formatServiceActivityDescription({
        type: "bill",
        description: "Bill #SB-1001",
      })
    ).toBe("Supplier bill recorded — Bill #SB-1001")
    expect(
      formatServiceActivityDescription({
        type: "bill",
        description: null,
      })
    ).toBe("Supplier bill recorded")
  })

  it("does not label bills as expenses", () => {
    const label = formatServiceActivityDescription({
      type: "bill",
      description: "Bill #SB-9",
    })
    expect(label).not.toMatch(/Expense recorded/i)
    expect(label).toMatch(/^Supplier bill recorded/)
  })

  it("keeps genuine expenses as Expense recorded", () => {
    expect(
      formatServiceActivityDescription({
        type: "expense",
        description: "Office supplies",
      })
    ).toBe("Expense recorded — Office supplies")
  })

  it("labels bill payments distinctly", () => {
    expect(
      formatServiceActivityDescription({
        type: "bill_payment",
        description: "Payment for Bill #SB-1001",
      })
    ).toMatch(/^Supplier bill payment recorded/)
  })

  it("never labels loan drawdown as Expense recorded", () => {
    const label = formatServiceActivityDescription({
      type: "loan_drawdown",
      description: "Loan Drawdown",
      lenderName: "GCB Bank",
    })
    expect(label).toBe("Loan received — GCB Bank")
    expect(label).not.toMatch(/Expense recorded/i)
  })

  it("never labels loan principal repayment as Expense recorded", () => {
    const label = formatServiceActivityDescription({
      type: "loan_repayment",
      description: "Loan Repayment",
      lenderName: "Ecobank",
    })
    expect(label).toBe("Loan repayment — Ecobank")
    expect(label).not.toMatch(/Expense recorded/i)
  })

  it("labels loan interest with interest semantics", () => {
    expect(
      formatServiceActivityDescription({
        type: "loan_interest",
        description: "Loan Interest Payment",
      })
    ).toBe("Loan interest paid")
    expect(
      formatServiceActivityDescription({
        type: "loan_interest",
        description: "Loan Interest Payment",
        lenderName: "Stanbic",
      })
    ).toBe("Loan interest paid — Stanbic")
  })

  it("falls back without lender name", () => {
    expect(formatLoanActivityLabel("loan_drawdown", null)).toBe("Loan received")
    expect(formatLoanActivityLabel("loan_repayment", "  ")).toBe("Loan repayment")
  })

  it("guards misclassified expense rows that are loan journal descriptions", () => {
    const drawdown = formatServiceActivityDescription({
      type: "expense",
      description: "Loan Drawdown",
    })
    expect(drawdown).toBe("Loan received")
    expect(drawdown).not.toMatch(/Expense recorded/i)

    const repayment = formatServiceActivityDescription({
      type: "expense",
      description: "Loan Repayment",
      lenderName: "GCB Bank",
    })
    expect(repayment).toBe("Loan repayment — GCB Bank")
  })

  it("labels applied credit notes as Credit note created, using the CN reference not the invoice", () => {
    const journalDescription = "Credit Note #CN-0001 for Invoice #INV-1042"
    expect(
      formatServiceActivityDescription({
        type: "credit_note",
        description: journalDescription,
      })
    ).toBe("Credit note created — CN-0001")
    expect(
      formatServiceActivityDescription({
        type: "credit_note",
        description: "CN-0042",
      })
    ).toBe("Credit note created — CN-0042")
    expect(
      formatServiceActivityDescription({
        type: "credit_note",
        description: null,
      })
    ).toBe("Credit note created")
  })

  it("keeps ordinary invoice creation as Invoice created", () => {
    expect(
      formatServiceActivityDescription({
        type: "invoice",
        description: "Invoice #INV-1042",
      })
    ).toBe("Invoice created — INV-1042")
    expect(
      formatServiceActivityDescription({
        type: "invoice",
        description: "INV-2001",
      })
    ).toBe("Invoice created — INV-2001")
  })

  it("does not relabel invoices from credit-note wording when the stored type is invoice", () => {
    const label = formatServiceActivityDescription({
      type: "invoice",
      description: "Credit Note #CN-0001 for Invoice #INV-1042",
    })
    expect(label).toBe("Invoice created — INV-1042")
    expect(label).not.toMatch(/Credit note created/i)
  })

  it("recognizes ledger reclass posting context without treating it as creation", () => {
    expect(
      isCreditNoteReclassJournal("Credit Note Reclass #CN-0001 for Invoice #INV-1042")
    ).toBe(true)
    expect(isCreditNoteReclassJournal("Credit Note #CN-0001 for Invoice #INV-1042")).toBe(
      false
    )
  })
})

describe("classifyLoanActivityKind", () => {
  it("detects drawdown, repayment, and interest from descriptions", () => {
    expect(classifyLoanActivityKind("Loan Drawdown", "loan")).toBe("loan_drawdown")
    expect(classifyLoanActivityKind("Loan Repayment", "loan")).toBe("loan_repayment")
    expect(classifyLoanActivityKind("Loan Interest Payment", "manual")).toBe(
      "loan_interest"
    )
  })
})

describe("mapJournalSourceToActivityType", () => {
  it("classifies supplier bills as bill, not expense", () => {
    expect(mapJournalSourceToActivityType("bill", "bill")).toBe("bill")
    expect(mapJournalSourceToActivityType(null, "bill")).toBe("bill")
    expect(mapJournalSourceToActivityType("bill", "bill")).not.toBe("expense")
  })

  it("keeps expenses and bill payments distinct", () => {
    expect(mapJournalSourceToActivityType("expense", "expense")).toBe("expense")
    expect(mapJournalSourceToActivityType("bill_payment", "bill_payment")).toBe(
      "bill_payment"
    )
  })

  it("classifies credit-note journals as credit_note, not invoice", () => {
    expect(mapJournalSourceToActivityType("credit_note", "credit_note")).toBe(
      "credit_note"
    )
    expect(mapJournalSourceToActivityType(null, "credit_note")).toBe("credit_note")
    expect(mapJournalSourceToActivityType(null, "credit_note")).not.toBe("invoice")
  })

  it("classifies over-credit reclass journals as credit_note_reclass from posting description", () => {
    expect(
      mapJournalSourceToActivityType(
        null,
        "credit_note",
        "Credit Note Reclass #CN-0001 for Invoice #INV-1042"
      )
    ).toBe("credit_note_reclass")
    expect(
      mapJournalSourceToActivityType(
        null,
        "credit_note",
        "Credit Note #CN-0001 for Invoice #INV-1042"
      )
    ).toBe("credit_note")
  })

  it("keeps invoice journals as invoice", () => {
    expect(mapJournalSourceToActivityType("invoice", "invoice")).toBe("invoice")
    expect(mapJournalSourceToActivityType(null, "invoice")).toBe("invoice")
  })
})

describe("activity detail hrefs", () => {
  it("links supplier bills to bill view, not expenses", () => {
    const href = supplierBillDetailHref("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    expect(href).toBe("/bills/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/view")
    expect(href).not.toMatch(/\/expenses\//)
  })

  it("links expenses to the expense view route", () => {
    expect(expenseDetailHref("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).toBe(
      "/service/expenses/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/view"
    )
  })

  it("links credit notes to the service credit-note view, not the invoice", () => {
    const href = creditNoteDetailHref("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    expect(href).toBe("/service/credit-notes/cccccccc-cccc-4ccc-8ccc-cccccccccccc/view")
    expect(href).not.toMatch(/\/invoices\//)
  })
})

describe("credit note activity pipeline", () => {
  const postedCreditNoteJournalDescription =
    "Credit Note #CN-0001 for Invoice #INV-1042"

  it("renders successful credit-note posting as Credit note created with the CN reference", () => {
    const type = mapJournalSourceToActivityType(null, "credit_note")
    const label = formatServiceActivityDescription({
      type,
      description: postedCreditNoteJournalDescription,
    })
    expect(type).toBe("credit_note")
    expect(label).toBe("Credit note created — CN-0001")
    expect(label).not.toMatch(/^Invoice created/)
  })

  it("does not label over-credit reclass journals as Credit note created", () => {
    const type = mapJournalSourceToActivityType(
      null,
      "credit_note",
      "Credit Note Reclass #CN-0001 for Invoice #INV-1042"
    )
    const label = formatServiceActivityDescription({
      type,
      description: "Credit Note Reclass #CN-0001 for Invoice #INV-1042",
    })
    expect(type).toBe("credit_note_reclass")
    expect(label).toBe("Credit note adjustment — CN-0001")
    expect(label).not.toMatch(/Credit note created/i)
  })

  it("renders ordinary invoice posting as Invoice created", () => {
    const type = mapJournalSourceToActivityType(null, "invoice")
    const label = formatServiceActivityDescription({
      type,
      description: "Invoice #INV-1042",
    })
    expect(type).toBe("invoice")
    expect(label).toBe("Invoice created — INV-1042")
  })
})
