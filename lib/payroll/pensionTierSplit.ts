/** Pension tier split for ledger / obligations (Ghana). Does not change payroll engine math. */

const TOLERANCE = 0.02

export function tiersMatchTotalPension(tier1: number, tier2: number, totalPension: number): boolean {
  return Math.abs(Number(tier1 || 0) + Number(tier2 || 0) - Number(totalPension || 0)) <= TOLERANCE
}

/**
 * Derive Tier 1 / Tier 2 amounts for posting and obligations.
 * If snapshot sums align with total pension, use them.
 * Otherwise (legacy / draft), split from aggregate using 13.5/18.5 and residual Tier 2.
 */
export function computePensionTierAmounts(
  tier1SnapshotSum: number,
  tier2SnapshotSum: number,
  totalPension: number,
  options: { allowLegacyDerivation?: boolean } = {}
): { tier1: number; tier2: number; usedFallback: boolean } {
  const total = Number(totalPension || 0)
  let t1 = Number(tier1SnapshotSum || 0)
  let t2 = Number(tier2SnapshotSum || 0)

  if (total <= 0.01) {
    return { tier1: 0, tier2: 0, usedFallback: false }
  }

  const snapSum = t1 + t2
  const snapshotsUsable =
    t1 >= 0 &&
    t2 >= 0 &&
    snapSum > 0.01 &&
    tiersMatchTotalPension(t1, t2, total)

  if (snapshotsUsable) {
    return { tier1: Math.round(t1 * 100) / 100, tier2: Math.round(t2 * 100) / 100, usedFallback: false }
  }

  if (options.allowLegacyDerivation !== true) {
    throw new Error(
      `Pension tier snapshot totals (${t1} + ${t2}) do not reconcile to total pension (${total}) within ${TOLERANCE}`
    )
  }

  const tier1 = Math.round((total * (13.5 / 18.5)) * 100) / 100
  const tier2 = Math.round((total - tier1) * 100) / 100
  return { tier1, tier2, usedFallback: true }
}

/** Map liability account codes for pension obligations from journal shape. */
export function pensionObligationLiabilityCodes(journalHasTier2Credit: boolean): {
  tier1: string
  tier2: string
} {
  if (journalHasTier2Credit) {
    return { tier1: "2231", tier2: "2232" }
  }
  return { tier1: "2231", tier2: "2231" }
}
