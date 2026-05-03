import type { SupabaseClient } from "@supabase/supabase-js"
import {
  generateFinancialDocumentHTML,
  type BusinessInfo,
  type CustomerInfo,
  type DocumentItem,
  type DocumentMeta,
  type DocumentTotals,
} from "@/components/documents/FinancialDocument"
import { getCurrencySymbol } from "@/lib/currency"

export type BuildCreditNoteDocumentHtmlOk = {
  ok: true
  html: string
  creditNumber: string
}

export type BuildCreditNoteDocumentHtmlErr = {
  ok: false
  error: string
  status: number
}

export type BuildCreditNoteDocumentHtmlResult = BuildCreditNoteDocumentHtmlOk | BuildCreditNoteDocumentHtmlErr

type BuildOpts = {
  /** When set, restricts the credit note to this business (authenticated export). */
  restrictBusinessId?: string
}

/**
 * Loads credit note + relations and builds the same HTML as pdf-preview (FinancialDocument).
 */
export async function buildCreditNoteDocumentHtml(
  supabase: SupabaseClient,
  creditNoteId: string,
  opts?: BuildOpts
): Promise<BuildCreditNoteDocumentHtmlResult> {
  if (!creditNoteId?.trim()) {
    return { ok: false, error: "Credit Note ID is required", status: 400 }
  }

  let q = supabase
    .from("credit_notes")
    .select(
      `
        id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction,
        invoices (
          id,
          invoice_number,
          customers (
            id,
            name,
            email,
            phone,
            whatsapp_phone,
            address
          )
        ),
        businesses (
          id,
          name,
          legal_name,
          trading_name,
          phone,
          email,
          address,
          logo_url,
          tax_id,
          registration_number
        ),
        credit_note_items (
          id,
          description,
          qty,
          unit_price,
          discount_amount,
          line_subtotal
        )
      `
    )
    .eq("id", creditNoteId)
    .is("deleted_at", null)

  if (opts?.restrictBusinessId) {
    q = q.eq("business_id", opts.restrictBusinessId)
  }

  const { data: creditNote, error: creditNoteError } = await q.single()

  if (creditNoteError || !creditNote) {
    return { ok: false, error: "Credit note not found", status: 404 }
  }

  const invoiceRel = Array.isArray((creditNote as any).invoices)
    ? (creditNote as any).invoices[0]
    : (creditNote as any).invoices
  const businessRel = Array.isArray((creditNote as any).businesses)
    ? (creditNote as any).businesses[0]
    : (creditNote as any).businesses
  const customer = invoiceRel?.customers || null

  const business: BusinessInfo = {
    name: businessRel?.name,
    legal_name: businessRel?.legal_name,
    trading_name: businessRel?.trading_name,
    phone: businessRel?.phone,
    email: businessRel?.email,
    address: businessRel?.address,
    logo_url: businessRel?.logo_url,
    tax_id: businessRel?.tax_id,
    registration_number: businessRel?.registration_number,
  }

  const customerData: CustomerInfo = customer
    ? {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        whatsapp_phone: customer.whatsapp_phone,
        address: customer.address,
      }
    : { name: "Customer" }

  const documentItems: DocumentItem[] = (creditNote.credit_note_items || []).map((item: any) => ({
    id: item.id,
    description: item.description || "Item",
    qty: item.qty || 0,
    unit_price: item.unit_price || 0,
    discount_amount: Number(item.discount_amount) || 0,
    line_subtotal: Number(item.line_subtotal ?? 0),
  }))

  const cn = creditNote as Record<string, unknown>
  const documentTotals: DocumentTotals = {
    subtotal: Number(cn.subtotal || 0),
    total_tax: Number(cn.total_tax || 0),
    total: Number((cn as any).total_amount ?? cn.total ?? 0),
  }

  const rawNumber = ((cn as any).credit_note_number ?? cn.credit_number ?? String(cn.id).substring(0, 8)) as string

  const documentMeta: DocumentMeta = {
    document_number: rawNumber,
    issue_date: String((cn as any).issue_date ?? cn.date ?? cn.created_at ?? ""),
    status: (cn.status as string) || null,
  }

  const htmlPreview = generateFinancialDocumentHTML({
    documentType: "credit_note",
    business,
    customer: customerData,
    items: documentItems,
    totals: documentTotals,
    meta: documentMeta,
    notes: creditNote.notes || null,
    footer_message: null,
    apply_taxes: false,
    currency_symbol: (cn as any).currency_code
      ? getCurrencySymbol((cn as any).currency_code) || (cn as any).currency_symbol || null
      : (cn as any).currency_symbol || null,
    currency_code: (cn as any).currency_code || null,
  })

  return {
    ok: true,
    html: htmlPreview,
    creditNumber: String(cn.credit_number ?? rawNumber),
  }
}
