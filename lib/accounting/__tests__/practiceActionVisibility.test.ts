import {
  journalReviewRoutesExist,
  partnerOnlyRestrictionLabel,
  practiceMutationAffordances,
  shouldShowJournalSubmitApproveReject,
} from "@/lib/accounting/practiceActionVisibility"
import {
  classifyPracticeShellFetch,
  isStaleClientAuthorityResponse,
  shouldReloadPracticeShellOnPathnameChange,
} from "@/lib/accounting/practiceShellSession"

describe("Practice UX truth", () => {
  it("hides missing-route submit/approve/reject", () => {
    expect(journalReviewRoutesExist()).toBe(false)
    expect(shouldShowJournalSubmitApproveReject()).toBe(false)
  })

  it("READ does not see mutation controls", () => {
    const a = practiceMutationAffordances({
      accessLevel: "read",
      authoritySource: "accountant",
      isPartner: true,
    })
    expect(a.createAdjustment).toBe(false)
    expect(a.editManualDraft).toBe(false)
    expect(a.reverseJournal).toBe(false)
    expect(a.submitJournalDraft).toBe(false)
    expect(a.approveJournalDraft).toBe(false)
  })

  it("WRITE sees write controls and not approve controls", () => {
    const a = practiceMutationAffordances({
      accessLevel: "write",
      authoritySource: "accountant",
      isPartner: true,
    })
    expect(a.createAdjustment).toBe(true)
    expect(a.editManualDraft).toBe(true)
    expect(a.reverseJournal).toBe(false)
    expect(a.postJournalDraft).toBe(false)
  })

  it("APPROVE sees approve controls", () => {
    const a = practiceMutationAffordances({
      accessLevel: "approve",
      authoritySource: "accountant",
      isPartner: true,
    })
    expect(a.createAdjustment).toBe(true)
    expect(a.reverseJournal).toBe(true)
    expect(a.postJournalDraft).toBe(true)
  })

  it("partner-only actions require partner even with APPROVE", () => {
    const a = practiceMutationAffordances({
      accessLevel: "approve",
      authoritySource: "accountant",
      isPartner: false,
    })
    expect(a.postJournalDraft).toBe(false)
    expect(a.approveOpeningBalance).toBe(false)
    expect(partnerOnlyRestrictionLabel("post this journal")).toBe(
      "Partner role required to post this journal."
    )
  })
})

describe("Practice shell session", () => {
  it("does not reload workspace state on report navigation", () => {
    expect(shouldReloadPracticeShellOnPathnameChange()).toBe(false)
  })

  it("drops Client A authority responses after switching to Client B", () => {
    expect(isStaleClientAuthorityResponse("client-a", "client-b")).toBe(true)
    expect(isStaleClientAuthorityResponse("client-b", "client-b")).toBe(false)
  })

  it("classifies work/requests as unrelated once a client is selected", () => {
    expect(
      classifyPracticeShellFetch("work", { hasClientSelected: true, isNoClientDashboard: false })
    ).toBe("UNRELATED")
    expect(
      classifyPracticeShellFetch("firms", { hasClientSelected: true, isNoClientDashboard: false })
    ).toBe("REQUIRED_ONCE_PER_PRACTICE_SESSION")
  })
})
