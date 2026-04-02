/**
 * GRA VAT 3 Form Field Mapping
 *
 * This module is the single source of truth for Ghana Revenue Authority (GRA)
 * VAT 3 return form box numbers and their mapping to Finza's internal data model.
 *
 * Both the UI label layer and the PDF export route import from this module,
 * guaranteeing box numbers are never inconsistent between views.
 *
 * GRA VAT 3 Form Structure:
 *   Section A: Output Tax (Sales)   — Boxes 1–7
 *   Section B: Input Tax (Purchases) — Boxes 8–14
 *   Section C: Net VAT               — Boxes 15–16
 *
 * Legislative references:
 *   - Value Added Tax Act, 2013 (Act 870) — base Act
 *   - Value Added Tax (Amendment) Act, 2022 (Act 1072) — COVID levy
 *   - Value Added Tax Act, 2025 (Act 1151) — simplified regime from 2026-01-01
 */

import { isSimplifiedRegime } from "@/lib/taxEngine/jurisdictions/ghana-shared"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Fields on a VatReturn record that a GRA box can map to.
 * "derived" means the value is computed at runtime (not a stored DB column).
 */
export type GraVatReturnField =
  | "total_taxable_sales"
  | "total_output_nhil"
  | "total_output_getfund"
  | "total_output_covid"
  | "total_output_vat"
  | "total_output_tax"
  | "total_taxable_purchases"
  | "total_input_nhil"
  | "total_input_getfund"
  | "total_input_covid"
  | "total_input_vat"
  | "total_input_tax"
  | "net_vat_payable"
  | "net_vat_refund"
  | "derived_total_sales"      // Box 1: total_taxable_sales + total_output_tax
  | "derived_total_purchases"  // Box 8: total_taxable_purchases + total_input_tax

export type GraSection = "A" | "B" | "C"

export interface GraBox {
  /** Official GRA VAT 3 box number (1–16) */
  boxNumber: number
  /** Short label shown in UI and PDF (e.g. "Output NHIL") */
  label: string
  /** Official GRA wording used as sub-description in PDF */
  description: string
  /** Tax rate string shown in Rate column (e.g. "2.5%"), or null for derived/total rows */
  rate: string | null
  /** Corresponding field on the VatReturn object */
  finzaField: GraVatReturnField
  /** Which section of the GRA form this box belongs to */
  section: GraSection
  /** True for the COVID levy boxes (6 and 13) — affects display post-2026 */
  isCovidBox: boolean
  /**
   * Post-2026 note to append to the description in the PDF and UI.
   * null means no change between regimes.
   */
  isCreditableNote: string | null
  /** Ledger account code this box corresponds to (for reference) */
  accountCode: string | null
}

// ─── GRA VAT 3 Box Definitions ───────────────────────────────────────────────

/**
 * Complete mapping of all GRA VAT 3 form boxes to Finza data fields.
 *
 * Order within each section follows the official GRA VAT 3 form.
 */
export const GRA_VAT3_BOXES: Record<string, GraBox> = {
  // ── Section A: Output Tax (Sales) ──────────────────────────────────────────

  box1: {
    boxNumber: 1,
    label: "Total Sales (gross)",
    description: "Total value of sales including all taxes (taxable value + total output tax)",
    rate: null,
    finzaField: "derived_total_sales",
    section: "A",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },
  box2: {
    boxNumber: 2,
    label: "Taxable Sales",
    description: "Total taxable value of supplies (excluding all taxes)",
    rate: null,
    finzaField: "total_taxable_sales",
    section: "A",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },
  box3: {
    boxNumber: 3,
    label: "Output VAT",
    description: "Value Added Tax collected on sales",
    rate: "15%",
    finzaField: "total_output_vat",
    section: "A",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: "2100",
  },
  box4: {
    boxNumber: 4,
    label: "Output NHIL",
    description: "National Health Insurance Levy on sales",
    rate: "2.5%",
    finzaField: "total_output_nhil",
    section: "A",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: "2110",
  },
  box5: {
    boxNumber: 5,
    label: "Output GETFund Levy",
    description: "Ghana Education Trust Fund Levy on sales",
    rate: "2.5%",
    finzaField: "total_output_getfund",
    section: "A",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: "2120",
  },
  box6: {
    boxNumber: 6,
    label: "Output COVID-19 Levy",
    description: "COVID-19 Health Recovery Levy on sales",
    rate: "1%",
    finzaField: "total_output_covid",
    section: "A",
    isCovidBox: true,
    isCreditableNote: null,
    accountCode: "2130",
  },
  box7: {
    boxNumber: 7,
    label: "Total Output Tax",
    description: "Sum of all output taxes (Box 3 + Box 4 + Box 5 + Box 6)",
    rate: null,
    finzaField: "total_output_tax",
    section: "A",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },

  // ── Section B: Input Tax (Purchases) ───────────────────────────────────────

  box8: {
    boxNumber: 8,
    label: "Total Purchases (gross)",
    description: "Total value of purchases including all taxes (taxable value + total input tax)",
    rate: null,
    finzaField: "derived_total_purchases",
    section: "B",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },
  box9: {
    boxNumber: 9,
    label: "Taxable Purchases",
    description: "Total taxable value of purchases (excluding all taxes)",
    rate: null,
    finzaField: "total_taxable_purchases",
    section: "B",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },
  box10: {
    boxNumber: 10,
    label: "Input VAT",
    description: "Value Added Tax paid on purchases (claimable as input credit)",
    rate: "15%",
    finzaField: "total_input_vat",
    section: "B",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: "2100",
  },
  box11: {
    boxNumber: 11,
    label: "Input NHIL",
    description: "National Health Insurance Levy paid on purchases",
    rate: "2.5%",
    finzaField: "total_input_nhil",
    section: "B",
    isCovidBox: false,
    isCreditableNote: "Claimable as input credit from 2026-01-01 (Act 1151)",
    accountCode: "2110",
  },
  box12: {
    boxNumber: 12,
    label: "Input GETFund Levy",
    description: "Ghana Education Trust Fund Levy paid on purchases",
    rate: "2.5%",
    finzaField: "total_input_getfund",
    section: "B",
    isCovidBox: false,
    isCreditableNote: "Claimable as input credit from 2026-01-01 (Act 1151)",
    accountCode: "2120",
  },
  box13: {
    boxNumber: 13,
    label: "Input COVID-19 Levy",
    description: "COVID-19 Health Recovery Levy paid on purchases",
    rate: "1%",
    finzaField: "total_input_covid",
    section: "B",
    isCovidBox: true,
    isCreditableNote: "NOT claimable as input credit — historical only",
    accountCode: "2130",
  },
  box14: {
    boxNumber: 14,
    label: "Total Input Tax",
    description: "Sum of all claimable input taxes (Box 10 + Box 11 + Box 12 + Box 13)",
    rate: null,
    finzaField: "total_input_tax",
    section: "B",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },

  // ── Section C: Net VAT ─────────────────────────────────────────────────────

  box15: {
    boxNumber: 15,
    label: "Net VAT Payable",
    description: "Net VAT payable to GRA (Box 7 minus Box 14, if positive)",
    rate: null,
    finzaField: "net_vat_payable",
    section: "C",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },
  box16: {
    boxNumber: 16,
    label: "Net VAT Refundable",
    description: "Net VAT refund due from GRA (Box 14 minus Box 7, if positive)",
    rate: null,
    finzaField: "net_vat_refund",
    section: "C",
    isCovidBox: false,
    isCreditableNote: null,
    accountCode: null,
  },
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Returns all GRA VAT 3 boxes for a given section, sorted by box number.
 */
export function getBoxesForSection(section: GraSection): GraBox[] {
  return Object.values(GRA_VAT3_BOXES)
    .filter((box) => box.section === section)
    .sort((a, b) => a.boxNumber - b.boxNumber)
}

/**
 * Determines whether the given period end date falls under the simplified
 * regime (2026-01-01 onwards, per Act 1151).
 *
 * Delegates to isSimplifiedRegime() from ghana-shared.ts — do not duplicate
 * the date comparison logic here.
 */
export function isPost2026Period(periodEndDate: string): boolean {
  return isSimplifiedRegime(periodEndDate)
}

/**
 * Minimal VAT return shape needed for resolveBoxValue.
 * The full VatReturn type in the view page is a superset of this.
 */
export interface GraVatReturnData {
  total_taxable_sales: number
  total_output_nhil: number
  total_output_getfund: number
  total_output_covid: number
  total_output_vat: number
  total_output_tax: number
  total_taxable_purchases: number
  total_input_nhil: number
  total_input_getfund: number
  total_input_covid: number
  total_input_vat: number
  total_input_tax: number
  net_vat_payable: number
  net_vat_refund: number
}

/**
 * Resolves the numeric display value for a given GRA box from a VAT return.
 *
 * Rules:
 * - COVID boxes (6 and 13) return 0 when isPost2026 is true, regardless of
 *   the stored DB value. The 1% levy was removed from 2026-01-01.
 * - Box 1 (derived_total_sales) = total_taxable_sales + total_output_tax
 * - Box 8 (derived_total_purchases) = total_taxable_purchases + total_input_tax
 * - All other boxes read directly from the corresponding field.
 */
export function resolveBoxValue(
  box: GraBox,
  vatReturn: GraVatReturnData,
  isPost2026: boolean
): number {
  // COVID boxes are zero for post-2026 periods (levy removed)
  if (box.isCovidBox && isPost2026) return 0

  const field = box.finzaField

  // Derived fields (not stored as DB columns)
  if (field === "derived_total_sales") {
    return Number(vatReturn.total_taxable_sales || 0) + Number(vatReturn.total_output_tax || 0)
  }
  if (field === "derived_total_purchases") {
    return Number(vatReturn.total_taxable_purchases || 0) + Number(vatReturn.total_input_tax || 0)
  }

  // Direct DB field lookup
  const value = vatReturn[field as keyof GraVatReturnData]
  return Number(value || 0)
}

/**
 * Convenience: returns the box key (e.g. "box4") for a given box number.
 * Returns undefined if not found.
 */
export function getBoxKey(boxNumber: number): string | undefined {
  return Object.keys(GRA_VAT3_BOXES).find(
    (key) => GRA_VAT3_BOXES[key].boxNumber === boxNumber
  )
}
