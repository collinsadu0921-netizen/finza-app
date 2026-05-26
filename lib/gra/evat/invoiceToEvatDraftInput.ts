/**
 * Maps invoice rows loaded via Supabase into {@link EvatDraftInvoiceInput} for {@link mapInvoiceToEvatDraft}.
 */

import type { BusinessGraEvatEnrollmentRow } from "./enrollment"
import type { EvatDraftInvoiceInput, EvatDraftInvoiceItemInput } from "./mapInvoiceToEvatDraft"

function relOne<T extends Record<string, unknown>>(x: unknown): T | null {
  if (x == null) return null
  if (Array.isArray(x)) return (x[0] as T | undefined) ?? null
  return x as T
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export type LoadedInvoiceRowForEvat = {
  id: string
  business_id: string
  invoice_number?: string | null
  reference?: string | null
  issue_date?: string | null
  created_at?: string | null
  currency_code?: string | null
  subtotal?: unknown
  total_tax?: unknown
  total?: unknown
  tax_lines?: unknown
  customers?: unknown
  businesses?: unknown
}

/** Raw invoice_items row (`select("*")`); tolerates legacy column names. */
export type LoadedInvoiceItemRowForEvat = Record<string, unknown> & {
  id: string
}

function itemLineAmount(row: LoadedInvoiceItemRowForEvat): number {
  const sub = num(row.line_subtotal, NaN)
  if (Number.isFinite(sub)) return sub
  const lt = num(row.line_total, NaN)
  if (Number.isFinite(lt)) return lt
  return num(row.total, 0)
}

function itemQuantity(row: LoadedInvoiceItemRowForEvat): number {
  const q = num(row.qty, NaN)
  if (Number.isFinite(q)) return q
  return num(row.quantity, 0)
}

function itemUnitPrice(row: LoadedInvoiceItemRowForEvat): number {
  const u = num(row.unit_price, NaN)
  if (Number.isFinite(u)) return u
  return num(row.price, 0)
}

function itemProductId(row: LoadedInvoiceItemRowForEvat): string | null {
  const ps = row.product_service_id
  if (typeof ps === "string" && ps.trim()) return ps.trim()
  const pid = row.product_id
  if (typeof pid === "string" && pid.trim()) return pid.trim()
  return null
}

export function invoiceRowsToEvatDraftInput(
  invoice: LoadedInvoiceRowForEvat,
  items: LoadedInvoiceItemRowForEvat[],
  enrollment: Pick<BusinessGraEvatEnrollmentRow, "enrollment_status"> | null
): EvatDraftInvoiceInput {
  const customer = relOne<{
    name?: string | null
    tin?: string | null
    address?: string | null
    phone?: string | null
    whatsapp_phone?: string | null
    email?: string | null
  }>(invoice.customers)

  const business = relOne<{
    id?: string
    name?: string | null
    tin?: string | null
    tax_id?: string | null
    address_country?: string | null
  }>(invoice.businesses)

  const draftItems: EvatDraftInvoiceItemInput[] = items.map((row) => {
    const ps = relOne<{ id?: string; name?: string | null }>(row.products_services)
    const desc = row.description != null ? String(row.description) : null
    return {
      id: row.id,
      product_id: itemProductId(row),
      sku: null,
      code: null,
      description: desc?.trim() ? desc.trim() : null,
      name: ps?.name ?? null,
      quantity: itemQuantity(row),
      unit_price: itemUnitPrice(row),
      line_total: itemLineAmount(row),
      product_tax_category: null,
      gra_item_category: null,
    }
  })

  const buyerPhone = customer?.phone?.trim() || customer?.whatsapp_phone?.trim() || null

  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number ?? null,
    reference: invoice.reference ?? null,
    issue_date: invoice.issue_date ?? null,
    created_at: invoice.created_at ?? null,
    currency: (invoice.currency_code && String(invoice.currency_code).trim()) || "GHS",
    subtotal: num(invoice.subtotal, 0),
    total_tax: num(invoice.total_tax, 0),
    total: num(invoice.total, 0),
    tax_lines: invoice.tax_lines ?? null,
    seller: {
      business_id: invoice.business_id,
      name: business?.name ?? null,
      tin: business?.tin ?? null,
      tax_id: business?.tax_id ?? null,
      country: business?.address_country ?? null,
    },
    buyer: {
      name: customer?.name ?? null,
      tin: customer?.tin ?? null,
      tax_id: null,
      address: customer?.address ?? null,
      phone: buyerPhone,
      email: customer?.email ?? null,
    },
    items: draftItems,
    enrollment: enrollment ?? undefined,
  }
}
