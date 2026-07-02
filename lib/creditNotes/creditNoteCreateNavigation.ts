/** Legacy sessionStorage key — URL ?invoiceId= is the only source of truth for create flow. */
export const LEGACY_CREDIT_NOTE_CREATE_INVOICE_STORAGE_KEY = "credit_note_create_invoice_id"

export function clearLegacyCreditNoteCreateInvoiceStorage(): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.removeItem(LEGACY_CREDIT_NOTE_CREATE_INVOICE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function getCreditNoteCreateBasePath(pathname?: string | null): string {
  return pathname?.startsWith("/service/") ? "/service/credit-notes/create" : "/credit-notes/create"
}

export function getCreditNoteViewPath(creditNoteId: string, pathname?: string | null): string {
  return pathname?.startsWith("/service/")
    ? `/service/credit-notes/${creditNoteId}/view`
    : `/credit-notes/${creditNoteId}/view`
}

export function getInvoiceViewPath(invoiceId: string, pathname?: string | null): string {
  return pathname?.startsWith("/service/")
    ? `/service/invoices/${invoiceId}/view`
    : `/invoices/${invoiceId}/view`
}
