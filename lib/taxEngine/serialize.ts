/**
 * Tax Engine Serialization Helpers
 * 
 * Functions to serialize tax results for storage (e.g., JSONB in database).
 */

import type { TaxResult } from './types'

/**
 * Serialize TaxResult to JSONB-compatible format
 * 
 * INVARIANT 4: Normalize to ledger-ready shape with ledger_account_code and ledger_side at top level
 * 
 * Serializes:
 * - lines: array of tax lines (code, amount, rate, name, ledger_account_code, ledger_side, meta)
 * - meta: metadata (jurisdiction, effective_date_used, engine_version)
 * - pricing_mode: "inclusive" or "exclusive"
 * 
 * Note: Does NOT serialize amounts (base_amount, total_tax, total_amount) as these
 * can be recalculated from lines if needed.
 * 
 * @param result TaxResult to serialize
 * @returns JSON-serializable object suitable for JSONB storage
 */
export function toTaxLinesJsonb(result: TaxResult): Record<string, any> {
  return {
    lines: result.lines.map(line => {
      // Extract ledger metadata from meta field for top-level inclusion
      const ledgerAccountCode = line.meta?.ledger_account_code ?? null
      const ledgerSide = line.meta?.ledger_side ?? null
      
      return {
        code: line.code,
        amount: line.amount,
        // INVARIANT 4: Include ledger metadata at top level for ledger posting
        ledger_account_code: ledgerAccountCode,
        ledger_side: ledgerSide,
        ...(line.rate !== undefined && { rate: line.rate }),
        ...(line.name !== undefined && { name: line.name }),
        ...(line.meta && Object.keys(line.meta).length > 0 && { meta: line.meta }),
      }
    }),
    meta: {
      jurisdiction: result.meta.jurisdiction,
      effective_date_used: result.meta.effective_date_used,
      engine_version: result.meta.engine_version,
    },
    pricing_mode: result.pricing_mode,
  }
}
