import type { ReceiptExtraction } from "@/lib/ocr/openaiReceiptSchema"
import type { SupplierBillExtraction } from "@/lib/ocr/supplierBillExtraction"
import type { IncomingDocumentKind } from "@/lib/documents/incomingDocumentTypes"

export type IncomingExtractionMode = "expense" | "supplier_bill" | "unknown"

export type PersistedIncomingFields = {
  extraction_mode: IncomingExtractionMode
  supplier_name: string | null
  supplier_tax_id: string | null
  document_number: string | null
  document_date: string | null
  due_date: string | null
  currency_code: string | null
  subtotal: number | null
  tax_amount: number | null
  total: number | null
  line_items?: SupplierBillExtraction["line_items"]
  warnings: string[]
  evidence?: Record<string, string | null>
}

export type PersistedIncomingExtraction = {
  extraction_mode: IncomingExtractionMode
  document_kind: IncomingDocumentKind
  parsed_json: PersistedIncomingFields
  warnings: string[]
  needs_review: boolean
}

export function requestedOpenAiMode(kind: IncomingDocumentKind): "expense" | "supplier_bill" {
  return kind === "expense_receipt" ? "expense" : "supplier_bill"
}

function expenseFields(extraction: ReceiptExtraction): PersistedIncomingFields {
  return {
    extraction_mode: "expense",
    supplier_name: extraction.supplier_name,
    supplier_tax_id: extraction.supplier_tax_id,
    document_number: extraction.receipt_number,
    document_date: extraction.document_date,
    due_date: null,
    currency_code: extraction.currency,
    subtotal: extraction.subtotal,
    tax_amount: extraction.tax_amount,
    total: extraction.total_amount,
    warnings: extraction.warnings,
    evidence: extraction.evidence,
  }
}

function supplierFields(extraction: SupplierBillExtraction): PersistedIncomingFields {
  return {
    extraction_mode: "supplier_bill",
    supplier_name: extraction.supplier_name,
    supplier_tax_id: extraction.supplier_tax_id,
    document_number: extraction.invoice_number,
    document_date: extraction.document_date,
    due_date: extraction.due_date,
    currency_code: extraction.currency,
    subtotal: extraction.subtotal,
    tax_amount: extraction.tax_amount,
    total: extraction.total_amount,
    line_items: extraction.line_items,
    warnings: extraction.warnings,
    evidence: extraction.evidence,
  }
}

function unknownFields(extraction: SupplierBillExtraction): PersistedIncomingFields {
  return {
    extraction_mode: "unknown",
    supplier_name: extraction.supplier_name,
    supplier_tax_id: null,
    document_number: extraction.invoice_number,
    document_date: extraction.document_date,
    due_date: null,
    currency_code: extraction.currency,
    subtotal: extraction.subtotal,
    tax_amount: extraction.tax_amount,
    total: extraction.total_amount,
    warnings: extraction.warnings,
  }
}

function receiptFieldsFromSupplier(extraction: SupplierBillExtraction): PersistedIncomingFields {
  return {
    extraction_mode: "expense",
    supplier_name: extraction.supplier_name,
    supplier_tax_id: extraction.supplier_tax_id,
    document_number: extraction.invoice_number,
    document_date: extraction.document_date,
    due_date: null,
    currency_code: extraction.currency,
    subtotal: extraction.subtotal,
    tax_amount: extraction.tax_amount,
    total: extraction.total_amount,
    warnings: extraction.warnings,
    evidence: {
      supplier: extraction.evidence.supplier,
      date: extraction.evidence.date,
      total: extraction.evidence.total,
      currency: extraction.evidence.currency,
    },
  }
}

export function persistOpenAiResult(args: {
  requestedKind: IncomingDocumentKind
  expense?: ReceiptExtraction | null
  supplierBill?: SupplierBillExtraction | null
}): PersistedIncomingExtraction {
  if (args.requestedKind === "expense_receipt") {
    const fields = expenseFields(args.expense as ReceiptExtraction)
    return {
      extraction_mode: "expense",
      document_kind: "expense_receipt",
      parsed_json: fields,
      warnings: fields.warnings,
      needs_review: fields.total == null && !fields.supplier_name,
    }
  }

  const bill = args.supplierBill as SupplierBillExtraction
  if (args.requestedKind === "unknown" && bill.document_type === "unknown") {
    const fields = unknownFields(bill)
    return {
      extraction_mode: "unknown",
      document_kind: "unknown",
      parsed_json: fields,
      warnings: fields.warnings,
      needs_review: true,
    }
  }
  if (args.requestedKind === "unknown" && bill.document_type === "receipt") {
    const fields = receiptFieldsFromSupplier(bill)
    return {
      extraction_mode: "expense",
      document_kind: "expense_receipt",
      parsed_json: fields,
      warnings: fields.warnings,
      needs_review: fields.total == null && !fields.supplier_name,
    }
  }

  const fields = supplierFields(bill)
  return {
    extraction_mode: "supplier_bill",
    document_kind: "supplier_bill_attachment",
    parsed_json: fields,
    warnings: fields.warnings,
    needs_review: fields.total == null && (!fields.line_items || fields.line_items.length === 0),
  }
}

export function reextractRequiresConfirmation(
  reviewStatus: string | null | undefined,
  reviewedFields: Record<string, unknown> | null | undefined
): boolean {
  if (reviewStatus === "accepted") return true
  if (reviewStatus === "draft" && reviewedFields && Object.keys(reviewedFields).length > 0) return true
  return false
}

export function incomingHandoffSkipsUpload(args: {
  incomingDocumentId: string | null
  storedPath: string | null
}): boolean {
  return Boolean(args.incomingDocumentId && args.storedPath)
}

export function inboxStatusLabel(args: {
  status: string
  reviewStatus?: string | null
  linked?: boolean
}): string {
  if (args.linked || args.status === "linked") return "Handled"
  if (args.status === "failed") return "Could not read"
  if (args.status === "uploaded" || args.status === "extracting") return "Reading document…"
  if (args.status === "reviewed" || args.reviewStatus === "accepted") return "Ready"
  return "Needs review"
}
