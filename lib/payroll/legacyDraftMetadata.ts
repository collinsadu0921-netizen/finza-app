import { isSupportedGhanaEngineVersion } from "@/lib/payrollEngine/jurisdictions/ghanaProfileTax"

export type LegacyDraftRunMetadata = {
  calculation_engine_version?: string | null
  calculation_jurisdiction?: string | null
  statutory_period_basis?: string | null
  paye_rate_version?: string | null
  pension_rate_version?: string | null
  pay_period_start?: string | null
  pay_period_end?: string | null
}

export type LegacyDraftEntryMetadata = {
  is_included?: boolean | null
  calculation_engine_version?: string | null
  calculation_jurisdiction?: string | null
  statutory_period_basis?: string | null
  paye_rate_version?: string | null
  pension_rate_version?: string | null
}

export type LegacyDraftMetadataEvaluation =
  | {
      recoverable: true
      metadata: {
        calculation_engine_version: string
        calculation_jurisdiction: string
        statutory_period_basis: string
        paye_rate_version: string
        pension_rate_version: string
      }
      fieldsToRepair: string[]
    }
  | {
      recoverable: false
      code: string
      reason: string
      details: Record<string, unknown>
    }

function datePart(value: unknown): string {
  return String(value ?? "").slice(0, 10)
}

export function evaluateLegacyDraftMetadata(input: {
  run: LegacyDraftRunMetadata
  entries: LegacyDraftEntryMetadata[]
}): LegacyDraftMetadataEvaluation {
  const included = (input.entries || []).filter((entry) => entry.is_included !== false)
  if (included.length === 0) {
    return {
      recoverable: false,
      code: "PAYROLL_METADATA_REPAIR_INCOMPLETE_ENTRIES",
      reason: "No included employee entries are available to supply calculation metadata.",
      details: { included_entries: 0 },
    }
  }

  const distinct = (values: string[]) => Array.from(new Set(values))
  const engines = distinct(
    included.map((entry) => String(entry.calculation_engine_version ?? "").trim())
  )
  const jurisdictions = distinct(
    included.map((entry) => String(entry.calculation_jurisdiction ?? "").trim().toUpperCase())
  )
  const periods = distinct(included.map((entry) => datePart(entry.statutory_period_basis)))
  const payeVersions = distinct(
    included.map((entry) => String(entry.paye_rate_version ?? "").trim())
  )
  const pensionVersions = distinct(
    included.map((entry) => String(entry.pension_rate_version ?? "").trim())
  )

  const missing = included.filter(
    (entry) =>
      !String(entry.calculation_engine_version ?? "").trim() ||
      !String(entry.calculation_jurisdiction ?? "").trim() ||
      !datePart(entry.statutory_period_basis) ||
      !String(entry.paye_rate_version ?? "").trim() ||
      !String(entry.pension_rate_version ?? "").trim()
  ).length

  if (
    missing > 0 ||
    engines.length !== 1 ||
    jurisdictions.length !== 1 ||
    periods.length !== 1 ||
    payeVersions.length !== 1 ||
    pensionVersions.length !== 1
  ) {
    return {
      recoverable: false,
      code: "PAYROLL_METADATA_REPAIR_INCONSISTENT_ENTRIES",
      reason:
        "Included employee calculation snapshots are incomplete or disagree, so the draft cannot be repaired automatically.",
      details: {
        included_entries: included.length,
        missing_snapshots: missing,
        distinct_engines: engines.length,
        distinct_jurisdictions: jurisdictions.length,
        distinct_periods: periods.length,
        distinct_paye_versions: payeVersions.length,
        distinct_pension_versions: pensionVersions.length,
      },
    }
  }

  const engine = engines[0]
  const jurisdiction = jurisdictions[0]
  const period = periods[0]
  const paye = payeVersions[0]
  const pension = pensionVersions[0]

  if (!isSupportedGhanaEngineVersion(engine)) {
    return {
      recoverable: false,
      code: "PAYROLL_METADATA_REPAIR_ENGINE_UNRECOGNIZED",
      reason: "The employee snapshots use an unrecognized Ghana calculation engine.",
      details: { engine },
    }
  }
  if (jurisdiction !== "GH") {
    return {
      recoverable: false,
      code: "PAYROLL_METADATA_REPAIR_JURISDICTION_UNRECOGNIZED",
      reason: "The employee snapshots do not use the Ghana jurisdiction.",
      details: { jurisdiction },
    }
  }

  const periodStart = datePart(input.run.pay_period_start)
  const periodEnd = datePart(input.run.pay_period_end)
  if (!period || (periodStart && period < periodStart) || (periodEnd && period > periodEnd)) {
    return {
      recoverable: false,
      code: "PAYROLL_METADATA_REPAIR_PERIOD_INVALID",
      reason: "The employee calculation period is missing or outside this payroll period.",
      details: { statutory_period_basis: period || null, period_start: periodStart, period_end: periodEnd },
    }
  }

  const runChecks: Array<[string, string | null | undefined, string]> = [
    ["calculation_engine_version", input.run.calculation_engine_version, engine],
    ["calculation_jurisdiction", input.run.calculation_jurisdiction, jurisdiction],
    ["statutory_period_basis", input.run.statutory_period_basis, period],
    ["paye_rate_version", input.run.paye_rate_version, paye],
    ["pension_rate_version", input.run.pension_rate_version, pension],
  ]
  for (const [field, runValue, entryValue] of runChecks) {
    if (runValue != null && String(runValue).trim() !== "") {
      const normalizedRun =
        field === "calculation_jurisdiction"
          ? String(runValue).trim().toUpperCase()
          : field === "statutory_period_basis"
            ? datePart(runValue)
            : String(runValue).trim()
      if (normalizedRun !== entryValue) {
        return {
          recoverable: false,
          code: "PAYROLL_METADATA_REPAIR_CONFLICT",
          reason:
            "Existing run calculation metadata conflicts with the employee snapshots and cannot be repaired automatically.",
          details: { field, run_value: runValue, entry_value: entryValue },
        }
      }
    }
  }

  const fieldsToRepair: string[] = []
  if (!input.run.calculation_engine_version) fieldsToRepair.push("calculation_engine_version")
  if (!input.run.calculation_jurisdiction) fieldsToRepair.push("calculation_jurisdiction")
  if (!input.run.statutory_period_basis) fieldsToRepair.push("statutory_period_basis")
  if (!input.run.paye_rate_version) fieldsToRepair.push("paye_rate_version")
  if (!input.run.pension_rate_version) fieldsToRepair.push("pension_rate_version")

  return {
    recoverable: true,
    metadata: {
      calculation_engine_version: engine,
      calculation_jurisdiction: jurisdiction,
      statutory_period_basis: period,
      paye_rate_version: paye,
      pension_rate_version: pension,
    },
    fieldsToRepair,
  }
}
