import type { TaxResult } from "@/lib/taxEngine/types"
import { getGhanaEngineVersion } from "@/lib/taxEngine/jurisdictions/ghana-shared"

/**
 * Convert a canonical bill TaxResult into the tax_lines JSONB shape consumed
 * by the existing bill ledger posting function.
 *
 * The posting function reads `tax_lines` (not `lines`) and posts any line with
 * a ledger account and side. Non-creditable input levies (pre-2026 NHIL,
 * GETFund and COVID) are marked `absorbed_to_cost` by the canonical engine and
 * have no control account. They are pointed at the bill's absorption account
 * (inventory 1450 for material bills, otherwise expense 5200) so the journal
 * remains balanced and the levies are not claimed as input tax.
 */
export function toBillTaxLinesJsonb(
  result: TaxResult,
  absorptionAccountCode: string
): Record<string, unknown> {
  return {
    tax_lines: result.lines.map((line) => {
      const meta = line.meta ?? {}
      const absorbed =
        meta.absorbed_to_cost === true ||
        meta.is_creditable_input === false ||
        meta.ledger_account_code == null

      return {
        code: line.code,
        name: line.name ?? line.code,
        rate: line.rate ?? 0,
        base: line.base ?? result.base_amount,
        amount: line.amount,
        ledger_account_code: absorbed
          ? absorptionAccountCode
          : meta.ledger_account_code,
        ledger_side: absorbed
          ? "debit"
          : (meta.ledger_side ?? null),
        is_creditable_input: meta.is_creditable_input === true,
        absorbed_to_cost: absorbed,
      }
    }),
    subtotal_excl_tax: result.base_amount,
    tax_total: result.total_tax,
    total_incl_tax: result.total_amount,
    meta: result.meta,
    pricing_mode: result.pricing_mode,
  }
}

export function emptyBillTaxResult(input: {
  baseAmount: number
  effectiveDate: string
  pricingMode: "inclusive" | "exclusive"
}): TaxResult {
  return {
    base_amount: input.baseAmount,
    total_tax: 0,
    total_amount: input.baseAmount,
    pricing_mode: input.pricingMode,
    lines: [],
    meta: {
      jurisdiction: "GH",
      effective_date_used: input.effectiveDate,
      engine_version: getGhanaEngineVersion(input.effectiveDate),
    },
  }
}
