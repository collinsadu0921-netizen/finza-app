/**
 * Explicit PostgREST `.select(...)` fragments for unauthenticated public document routes.
 * Avoid `*` so new DB columns are not automatically exposed to the public internet.
 */

export const PUBLIC_BUSINESS_SELECT =
  "id, name, legal_name, trading_name, address, address_street, address_city, address_region, address_country, phone, whatsapp_phone, email, website, tin, tax_id, logo_url, registration_number, default_currency"

export const PUBLIC_INVOICE_SETTINGS_SELECT =
  "show_tax_breakdown, show_business_tin, brand_color, bank_name, bank_branch, bank_swift, bank_iban, bank_account_name, bank_account_number, momo_provider, momo_name, momo_number, default_payment_terms, default_footer_message"

/** Invoice row columns (no embeds). */
export const PUBLIC_INVOICE_COLUMNS = [
  "id",
  "business_id",
  "invoice_number",
  "issue_date",
  "due_date",
  "status",
  "public_token",
  "payment_terms",
  "notes",
  "footer_message",
  "currency_code",
  "currency_symbol",
  "subtotal",
  "nhil",
  "getfund",
  "covid",
  "vat",
  "total_tax",
  "total",
  "apply_taxes",
  "tax_lines",
  "wht_receivable_applicable",
  "wht_receivable_rate",
  "wht_receivable_amount",
  "fx_rate",
  "home_currency_code",
  "home_currency_total",
  "sent_at",
].join(", ")

export const PUBLIC_INVOICE_CUSTOMER_SELECT = "id, name, email, phone, whatsapp_phone, address, tin"

export const PUBLIC_INVOICE_ITEM_SELECT =
  "id, description, qty, unit_price, discount_amount, line_subtotal"

/** Public invoice JSON: invoice + customer embed only (business loaded separately). */
export const PUBLIC_INVOICE_SELECT_WITH_CUSTOMER = `
  ${PUBLIC_INVOICE_COLUMNS},
  customers ( ${PUBLIC_INVOICE_CUSTOMER_SELECT} )
`

/** Invoice HTML/PDF preview: invoice + customer + business + line items (same shape as prior `*` query). */
export const PUBLIC_INVOICE_PREVIEW_SELECT = `
  ${PUBLIC_INVOICE_COLUMNS},
  customers ( ${PUBLIC_INVOICE_CUSTOMER_SELECT} ),
  businesses ( ${PUBLIC_BUSINESS_SELECT} ),
  invoice_items ( ${PUBLIC_INVOICE_ITEM_SELECT} )
`

export const PUBLIC_PAYMENT_SELECT =
  "id, invoice_id, amount, wht_amount, date, method, reference, notes, public_token, e_levy_amount"

/** Nested under `payments` for public receipt — mirrors prior explicit nested invoice shape. */
export const PUBLIC_RECEIPT_EMBEDDED_INVOICE_SELECT = `
  id,
  business_id,
  invoice_number,
  issue_date,
  due_date,
  payment_terms,
  notes,
  footer_message,
  currency_code,
  currency_symbol,
  subtotal,
  nhil,
  getfund,
  covid,
  vat,
  total_tax,
  total,
  apply_taxes,
  tax_lines,
  wht_receivable_applicable,
  wht_receivable_rate,
  wht_receivable_amount,
  customers ( ${PUBLIC_INVOICE_CUSTOMER_SELECT} )
`

export const PUBLIC_PAYMENT_RECEIPT_SELECT = `
  ${PUBLIC_PAYMENT_SELECT},
  invoices ( ${PUBLIC_RECEIPT_EMBEDDED_INVOICE_SELECT} )
`

export const PUBLIC_CREDIT_NOTE_ITEM_SELECT =
  "id, description, qty, unit_price, discount_amount, line_subtotal"

/**
 * Public quote (estimate) row — fields used by public JSON normalizer + quote/proforma PDF HTML builders.
 * Includes legacy + canonical tax column names (`nhil` vs `nhil_amount`, etc.) across migration generations.
 */
export const PUBLIC_ESTIMATE_COLUMNS = [
  "id",
  "business_id",
  "customer_id",
  "estimate_number",
  "issue_date",
  "validity_date",
  "notes",
  "subtotal",
  "subtotal_before_tax",
  "nhil",
  "getfund",
  "covid",
  "vat",
  "nhil_amount",
  "getfund_amount",
  "covid_amount",
  "vat_amount",
  "total_tax_amount",
  "tax",
  "total",
  "total_amount",
  "status",
  "tax_lines",
  "currency_code",
  "currency_symbol",
  "public_token",
  "client_name_signed",
  "client_id_type",
  "client_id_number",
  "client_signature",
  "signed_at",
  "rejected_reason",
  "rejected_at",
  "fx_rate",
  "home_currency_code",
  "home_currency_total",
].join(", ")

/** Quote line items — supports legacy `quantity`/`price`/`total` and newer `qty`/`unit_price`/`line_total`. */
export const PUBLIC_ESTIMATE_ITEM_SELECT =
  "id, description, quantity, price, total, qty, unit_price, line_total, discount_amount, created_at"

/**
 * Public proforma invoice row — covers proforma-public UI + `buildProformaFinancialDocumentHtmlForPdf`.
 */
export const PUBLIC_PROFORMA_ITEM_SELECT =
  "id, description, qty, unit_price, discount_amount, line_subtotal, created_at"

export const PUBLIC_PROFORMA_INVOICE_COLUMNS = [
  "id",
  "business_id",
  "customer_id",
  "proforma_number",
  "status",
  "issue_date",
  "validity_date",
  "subtotal",
  "total_tax",
  "total",
  "nhil",
  "getfund",
  "covid",
  "vat",
  "currency_code",
  "currency_symbol",
  "payment_terms",
  "notes",
  "footer_message",
  "apply_taxes",
  "tax_lines",
  "public_token",
  "sent_at",
  "accepted_at",
  "client_name_signed",
  "client_id_type",
  "client_id_number",
  "client_signature",
  "signed_at",
  "rejected_reason",
  "rejected_at",
  "fx_rate",
  "home_currency_code",
  "home_currency_total",
].join(", ")
