/**
 * Practice Client Books UI truth helpers.
 * Server capability remains authoritative; these only describe what the UI may show.
 */

export type PracticeAccessLevel = "read" | "write" | "approve" | null

export function journalReviewRoutesExist(): boolean {
  return false
}

export function shouldShowJournalSubmitApproveReject(): boolean {
  return journalReviewRoutesExist()
}

export function practiceMutationAffordances(opts: {
  accessLevel: PracticeAccessLevel
  authoritySource: "owner" | "employee" | "accountant" | null
  isPartner?: boolean
}) {
  const practice = opts.authoritySource === "accountant"
  const write = practice
    ? opts.accessLevel === "write" || opts.accessLevel === "approve"
    : opts.authoritySource === "owner" || opts.authoritySource === "employee"
  const approve = practice
    ? opts.accessLevel === "approve"
    : opts.authoritySource === "owner" || opts.authoritySource === "employee"

  return {
    createAdjustment: write,
    editManualDraft: write,
    reverseJournal: approve,
    submitJournalDraft: false,
    approveJournalDraft: false,
    rejectJournalDraft: false,
    postJournalDraft: approve && (practice ? Boolean(opts.isPartner) : true),
    approveOpeningBalance: approve && (practice ? Boolean(opts.isPartner) : true),
    postOpeningBalance: approve && (practice ? Boolean(opts.isPartner) : true),
  }
}

export function partnerOnlyRestrictionLabel(action: string): string {
  return `Partner role required to ${action}.`
}
