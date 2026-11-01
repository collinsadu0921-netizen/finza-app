import { evaluateLegacyDraftMetadata } from "@/lib/payroll/legacyDraftMetadata"

const run = {
  calculation_engine_version: null,
  calculation_jurisdiction: null,
  statutory_period_basis: null,
  paye_rate_version: "gh-paye-2024-01",
  pension_rate_version: "gh-pension-2026-01",
  pay_period_start: "2026-02-28",
  pay_period_end: "2026-03-30",
}

const entry = {
  is_included: true,
  calculation_engine_version: "finza-ghana-v3",
  calculation_jurisdiction: "GH",
  statutory_period_basis: "2026-03-01",
  paye_rate_version: "gh-paye-2024-01",
  pension_rate_version: "gh-pension-2026-01",
}

describe("legacy draft calculation metadata", () => {
  it("recovers missing header fields from consistent employee snapshots", () => {
    const result = evaluateLegacyDraftMetadata({ run, entries: [entry, { ...entry }] })
    expect(result.recoverable).toBe(true)
    if (result.recoverable) {
      expect(result.metadata).toMatchObject({
        calculation_engine_version: "finza-ghana-v3",
        calculation_jurisdiction: "GH",
        statutory_period_basis: "2026-03-01",
        paye_rate_version: "gh-paye-2024-01",
        pension_rate_version: "gh-pension-2026-01",
      })
      expect(result.fieldsToRepair).toEqual([
        "calculation_engine_version",
        "calculation_jurisdiction",
        "statutory_period_basis",
      ])
    }
  })

  it("rejects mixed employee metadata", () => {
    const result = evaluateLegacyDraftMetadata({
      run,
      entries: [entry, { ...entry, calculation_engine_version: "finza-ghana-v2" }],
    })
    expect(result.recoverable).toBe(false)
    if (!result.recoverable) expect(result.code).toBe("PAYROLL_METADATA_REPAIR_INCONSISTENT_ENTRIES")
  })

  it("rejects a period outside the payroll period", () => {
    const result = evaluateLegacyDraftMetadata({
      run,
      entries: [{ ...entry, statutory_period_basis: "2026-02-01" }],
    })
    expect(result.recoverable).toBe(false)
    if (!result.recoverable) expect(result.code).toBe("PAYROLL_METADATA_REPAIR_PERIOD_INVALID")
  })

  it("does not overwrite conflicting non-null run metadata", () => {
    const result = evaluateLegacyDraftMetadata({
      run: { ...run, calculation_engine_version: "finza-ghana-v2" },
      entries: [entry],
    })
    expect(result.recoverable).toBe(false)
    if (!result.recoverable) expect(result.code).toBe("PAYROLL_METADATA_REPAIR_CONFLICT")
  })

  it("rejects unrecognized engines", () => {
    const result = evaluateLegacyDraftMetadata({
      run,
      entries: [{ ...entry, calculation_engine_version: "unknown-engine" }],
    })
    expect(result.recoverable).toBe(false)
    if (!result.recoverable) expect(result.code).toBe("PAYROLL_METADATA_REPAIR_ENGINE_UNRECOGNIZED")
  })
})
