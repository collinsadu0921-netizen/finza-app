export type IncomingDocumentSourceType =
  | "manual_upload"
  | "expense_form_upload"
  | "bill_form_upload"
  | "email_inbound"

export type IncomingDocumentKind = "expense_receipt" | "supplier_bill_attachment" | "unknown"

export type IncomingDocumentStatus =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "needs_review"
  | "reviewed"
  | "failed"
  | "linked"

export type IncomingExtractionStatus = "started" | "succeeded" | "failed"

export type LinkedEntityType = "expense" | "bill"
