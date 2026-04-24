/**
 * Merge machine extraction with user-reviewed overlay for forms and review UI.
 */

export type ReviewStatus = "none" | "draft" | "accepted"

export function buildEffectiveParsedFields(args: {
  machineParsed: Record<string, unknown> | null | undefined
  reviewedFields: Record<string, unknown> | null | undefined
  reviewStatus: string | null | undefined
}): Record<string, unknown> {
  const machine = { ...(args.machineParsed ?? {}) }
  const reviewed = args.reviewedFields ?? {}
  const rs = (args.reviewStatus ?? "none") as ReviewStatus

  if (rs === "draft" || rs === "accepted") {
    return { ...machine, ...reviewed }
  }
  return machine
}

/** Prefer accepted review for downstream expense/bill helpers; else machine-only. */
export function preferAcceptedReview(args: {
  machineParsed: Record<string, unknown> | null | undefined
  reviewedFields: Record<string, unknown> | null | undefined
  reviewStatus: string | null | undefined
}): Record<string, unknown> {
  if (args.reviewStatus === "accepted" && args.reviewedFields && Object.keys(args.reviewedFields).length > 0) {
    return { ...(args.machineParsed ?? {}), ...args.reviewedFields }
  }
  return { ...(args.machineParsed ?? {}) }
}
