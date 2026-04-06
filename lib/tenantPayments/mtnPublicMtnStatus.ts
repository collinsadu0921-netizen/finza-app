/**
 * Public MTN tenant-invoice status: **invoice binding is required** (Phase 6).
 * Prevents reference-only polling from driving settlement checks for a session that does not belong
 * to the pay page invoice when the client cooperates (our public pay UI always sends invoice_id).
 */

export type RequireInvoiceIdResult =
  | { ok: true; invoiceId: string }
  | { ok: false; error: string; statusCode: 400 }

export function requireInvoiceIdForPublicTenantMtnStatus(invoiceId: string | null): RequireInvoiceIdResult {
  const trimmed = invoiceId?.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: "invoice_id is required for tenant MTN payment status",
      statusCode: 400,
    }
  }
  return { ok: true, invoiceId: trimmed }
}
