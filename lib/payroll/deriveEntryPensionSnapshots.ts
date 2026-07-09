/** Per-entry Ghana pension / SSNIT tier snapshots for payroll entries and exports. */

const round2 = (value: number) => Math.round(value * 100) / 100

export type EntryPensionSnapshots = {
  pensionable_base: number
  employee_pension_contribution: number
  employer_pension_contribution: number
  total_mandatory_pension: number
  tier1_ssnit_remittance: number
  tier2_pension_remittance: number
}

export function deriveEntryPensionSnapshots(opts: {
  pensionableBase: number
  employeeContribution: number
  employerContribution: number
}): EntryPensionSnapshots {
  const pensionable_base = round2(Number(opts.pensionableBase || 0))
  const employee_pension_contribution = round2(Number(opts.employeeContribution || 0))
  const employer_pension_contribution = round2(Number(opts.employerContribution || 0))
  const total_mandatory_pension = round2(
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

  const tier1_ssnit_remittance = round2(total_mandatory_pension * (13.5 / 18.5))
  const tier2_pension_remittance = round2(total_mandatory_pension - tier1_ssnit_remittance)

  return {
    pensionable_base,
    employee_pension_contribution,
    employer_pension_contribution,
    total_mandatory_pension,
    tier1_ssnit_remittance,
    tier2_pension_remittance,
  }
}
