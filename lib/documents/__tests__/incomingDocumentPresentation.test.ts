import { describe, it, expect } from "@jest/globals"
import {
  emailOriginLines,
  formatInboxAmount,
  inboxPrimaryAction,
  inboxPrimaryLabel,
  inboxRowFileName,
  inboxRowFromLine,
  inboxRowSecondary,
  inboxRowTitle,
  inboxStatusText,
  sharesInboundEmail,
  type InboxDocumentRow,
} from "@/lib/documents/incomingDocumentPresentation"

function row(overrides: Partial<InboxDocumentRow> = {}): InboxDocumentRow {
  return {
    id: "doc-1",
    display_name: "Invoice-UPWOCJMT-0004.pdf",
    document_kind: "supplier_bill_attachment",
    source_type: "manual_upload",
    source_email_sender: null,
    source_email_subject: null,
    mime_type: "application/pdf",
    status: "needs_review",
    review_status: "none",
    document_date: "2026-07-29",
    document_number: "UPWOCJMT-0004",
    supplier_name: "Vercel Inc. (@vercel)",
    currency_code: "USD",
    total: 25,
    ...overrides,
  }
}

describe("incoming document inbox presentation", () => {
  it("shows an extracted email as supplier, invoice, and sender", () => {
    const email = row({
      source_type: "email_inbound",
      source_email_sender: "billing@vercel.com",
      source_email_subject: "Your Vercel invoice for July",
    })
    expect(inboxRowTitle(email)).toBe("Vercel Inc. (@vercel)")
    expect(inboxRowSecondary(email)).toBe("Invoice UPWOCJMT-0004 · Jul 29, 2026")
    expect(inboxRowFromLine(email)).toBe("From billing@vercel.com")
    expect(inboxRowFileName(email)).toBeNull()
  })

  it("shows sender, subject, and file name before extraction", () => {
    const email = row({
      supplier_name: null,
      document_number: null,
      document_date: null,
      source_type: "email_inbound",
      source_email_sender: "billing@vercel.com",
      source_email_subject: "Your Vercel invoice for July",
    })
    expect(inboxRowTitle(email)).toBe("billing@vercel.com")
    expect(inboxRowSecondary(email)).toBe("Your Vercel invoice for July")
    expect(inboxRowFileName(email)).toBe("Invoice-UPWOCJMT-0004.pdf")
    expect(inboxRowFromLine(email)).toBeNull()
  })

  it("shows a manual upload by supplier and document number", () => {
    const uploaded = row({ source_type: "manual_upload", supplier_name: "Golden hands services Ltd", document_number: "INV-000018", document_date: "2026-04-21", document_kind: "supplier_bill_attachment" })
    expect(inboxRowTitle(uploaded)).toBe("Golden hands services Ltd")
    expect(inboxRowSecondary(uploaded)).toBe("Invoice INV-000018 · Apr 21, 2026")
    expect(inboxRowFromLine(uploaded)).toBeNull()
  })

  it("does not show a zero or missing amount as money", () => {
    expect(formatInboxAmount(null, "GHS")).toBeNull()
    expect(formatInboxAmount(0, "GHS")).toBeNull()
    expect(formatInboxAmount(103.23, "GHS")).toContain("103.23")
  })

  it("labels reading, review, ready, handled, and failed without internal names", () => {
    expect(inboxStatusText(row({ status: "extracting" }))).toBe("Reading…")
    expect(inboxStatusText(row({ status: "uploaded" }))).toBe("Needs review")
    expect(inboxStatusText(row({ status: "needs_review" }))).toBe("Needs review")
    expect(inboxStatusText(row({ status: "reviewed", review_status: "accepted" }))).toBe("Ready")
    expect(inboxStatusText(row({ status: "extracted", linked_entity_id: "bill-1" }))).toBe("Handled")
    expect(inboxStatusText(row({ status: "failed" }))).toBe("Could not read")
  })

  it("chooses the primary action from review and link state", () => {
    expect(inboxPrimaryAction(row())).toBe("review")
    expect(inboxPrimaryLabel("review")).toBe("Review document")
    expect(inboxPrimaryAction(row({ review_status: "accepted", document_kind: "expense_receipt" }))).toBe("create_expense")
    expect(inboxPrimaryAction(row({ review_status: "accepted", document_kind: "supplier_bill_attachment" }))).toBe("create_bill")
    expect(inboxPrimaryAction(row({ review_status: "accepted", document_kind: "unknown" }))).toBe("review")
    expect(inboxPrimaryAction(row({ linked_entity_id: "b1", linked_entity_type: "bill" }))).toBe("view_bill")
  })

  it("marks attachments that share an inbound email", () => {
    const first = row({ id: "a", source_type: "email_inbound", inbound_email_message_id: "msg-1" })
    const second = row({ id: "b", source_type: "email_inbound", inbound_email_message_id: "msg-1" })
    const alone = row({ id: "c", source_type: "email_inbound", inbound_email_message_id: "msg-2" })
    expect(sharesInboundEmail([first, second, alone], first)).toBe(true)
    expect(sharesInboundEmail([first, second, alone], alone)).toBe(false)
  })

  it("shows only stored email fields on the review page", () => {
    expect(emailOriginLines({
      source_type: "email_inbound",
      source_email_sender: "billing@vercel.com",
      source_email_subject: "Your Vercel invoice for July",
      file_name: "Invoice-UPWOCJMT-0004.pdf",
      created_at: "2026-07-29T10:00:00.000Z",
    }).map((line) => line.label)).toEqual(["From", "Subject", "Added", "Attachment"])
    expect(emailOriginLines({
      source_type: "email_inbound",
      source_email_sender: "billing@vercel.com",
      source_email_subject: "Your Vercel invoice for July",
      file_name: "Invoice-UPWOCJMT-0004.pdf",
      created_at: "2026-07-29T10:00:00.000Z",
    }).map((line) => `${line.label}:${line.value}`)).toEqual([
      "From:billing@vercel.com",
      "Subject:Your Vercel invoice for July",
      "Added:Jul 29, 2026",
      "Attachment:Invoice-UPWOCJMT-0004.pdf",
    ])
    expect(emailOriginLines({
      source_type: "email_inbound",
      source_email_sender: "billing@vercel.com",
      created_at: "2026-07-30T10:00:00.000Z",
      email_received_at: "2026-07-29T08:00:00.000Z",
    }).find((line) => line.label === "Received")?.value).toBe("Jul 29, 2026")
    expect(emailOriginLines({ source_type: "manual_upload", file_name: "scan.pdf" })).toEqual([])
    expect(emailOriginLines({ source_type: "email_inbound", source_email_sender: "billing@vercel.com" }).some((line) => line.label === "Subject")).toBe(false)
  })
})
