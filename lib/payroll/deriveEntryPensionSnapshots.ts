/** Per-entry Ghana pension / SSNIT tier snapshots for payroll entries and exports. */

import { roundPayroll } from "@/lib/payrollEngine/versioning"
import { computeGhanaPensionAmounts } from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"

export type EntryPensionSnapshots = {
  pensionable_base: number
  employee_pension_contribution: number
  employer_pension_contribution: number
  total_mandatory_pension: number
  tier1_ssnit_remittance: number
  tier2_pension_remittance: number
}

/**
 * Persist pension snapshots. Prefer engine-computed tier amounts (base × rates).
 * If remittances are omitted, recompute from pensionable base using statutory tier rates
 * (not a proportional split of the rounded contribution total).
 */
export function deriveEntryPensionSnapshots(opts: {
  pensionableBase: number
  employeeContribution: number
  employerContribution: number
  tier1Remittance?: number
  tier2Remittance?: number
  tier1TotalRate?: number
  tier2Rate?: number
  employeeRate?: number
  employerRate?: number
}): EntryPensionSnapshots {
  const pensionable_base = roundPayroll(Number(opts.pensionableBase || 0))
  const employee_pension_contribution = roundPayroll(Number(opts.employeeContribution || 0))
  const employer_pension_contribution = roundPayroll(Number(opts.employerContribution || 0))
  const total_mandatory_pension = roundPayroll(
    employee_pension_contribution + employer_pension_contribution
  )

  if (total_mandatory_pension <= 0.01) {
    return {
      pensionable_base,
      employee_pension_contribution,
      employer_pension_contribution,
      total_mandatory_pension: 0,
      tier1_ssnit_remittance: 0,
      tier2_pension_remittance: 0,
    }
  }

  let tier1_ssnit_remittance = roundPayroll(Number(opts.tier1Remittance ?? 0))
  let tier2_pension_remittance = roundPayroll(Number(opts.tier2Remittance ?? 0))

  if (tier1_ssnit_remittance <= 0 && tier2_pension_remittance <= 0) {
    const computed = computeGhanaPensionAmounts(pensionable_base, {
      employeeRate: opts.employeeRate ?? 0.055,
      employerRate: opts.employerRate ?? 0.13,
      tier1TotalRate: opts.tier1TotalRate ?? 0.135,
      tier2Rate: opts.tier2Rate ?? 0.05,
    })
    tier1_ssnit_remittance = computed.tier1
    tier2_pension_remittance = computed.tier2
  }

  const tierSum = roundPayroll(tier1_ssnit_remittance + tier2_pension_remittance)
  const drift = roundPayroll(total_mandatory_pension - tierSum)
  if (Math.abs(drift) > 0 && Math.abs(drift) <= 0.01) {
    tier2_pension_remittance = roundPayroll(tier2_pension_remittance + drift)
  }

  return {
    pensionable_base,
    employee_pension_contribution,
    employer_pension_contribution,
    total_mandatory_pension,
    tier1_ssnit_remittance,
    tier2_pension_remittance,
  }
}
