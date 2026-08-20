export type PracticeShellFetchKind = "firms" | "clients" | "work" | "requests"

export type PracticeShellFetchClass =
  | "REQUIRED_ONCE_PER_PRACTICE_SESSION"
  | "CAN_BE_DEFERRED"
  | "UNRELATED"
  | "REQUIRED_FOR_CLIENT_BOOKS"

export function shouldReloadPracticeShellOnPathnameChange(): boolean {
  return false
}

export function isStaleClientAuthorityResponse(
  requestedBusinessId: string,
  currentBusinessId: string | null
): boolean {
  return !currentBusinessId || requestedBusinessId !== currentBusinessId
}

export function classifyPracticeShellFetch(
  kind: PracticeShellFetchKind,
  opts: { hasClientSelected: boolean; isNoClientDashboard: boolean }
): PracticeShellFetchClass {
  if (kind === "firms") return "REQUIRED_ONCE_PER_PRACTICE_SESSION"
  if (opts.isNoClientDashboard && !opts.hasClientSelected) {
    return "CAN_BE_DEFERRED"
  }
  return "UNRELATED"
}
