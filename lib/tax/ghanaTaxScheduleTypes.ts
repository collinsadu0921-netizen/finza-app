/**
 * Hand-written row shapes for Phase 1 Ghana tax schedule tables.
 * Not wired into invoice runtime; use after regenerating Supabase types or for early typing.
 */

export type TaxScheduleClassification =
  | "levy"
  | "tax"
  | "duty"
  | "fee"
  | "margin"
  | "unclear"

export type TaxScheduleRow = {
  id: string
  business_id: string | null
  jurisdiction: string
  code: string
  name: string
  effective_from: string
  effective_to: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type TaxScheduleLineRow = {
  id: string
  tax_schedule_id: string
  sort_order: number
  internal_code: string
  gra_levy_slot: "A" | "B" | "C" | "D" | "E" | null
  gra_field_name: string | null
  display_label: string
  display_description: string | null
  classification: TaxScheduleClassification
  calculation_basis: string
  rate_percent: number | null
  ledger_account_code: string | null
  include_in_total_levy: boolean
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type ProductTaxCategoryRow = {
  id: string
  business_id: string | null
  jurisdiction: string
  code: string
  gra_item_category: string | null
  label: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type InvoiceItemTaxLineRow = {
  id: string
  invoice_item_id: string
  tax_schedule_line_id: string | null
  internal_code: string
  display_label: string
  classification: TaxScheduleClassification
  gra_levy_slot: "A" | "B" | "C" | "D" | "E" | null
  gra_field_name: string | null
  calculation_basis: string
  base_amount: string | null
  amount: string
  rate_percent: number | null
  ledger_account_code: string | null
  include_in_total_levy: boolean
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}
