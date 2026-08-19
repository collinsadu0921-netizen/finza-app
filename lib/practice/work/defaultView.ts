import type { PracticeFirmRole } from "@/lib/practice/assignment/policy"
import type { PracticeWorkView } from "./types"

/**
 * Role-aware Work landing view when the URL does not specify `view`.
 * Partner sees the firm queue; restricted roles land on My work.
 */
export function defaultPracticeWorkView(role: PracticeFirmRole): PracticeWorkView {
  return role === "partner" ? "all" : "my"
}

/**
 * Precedence: explicit URL `view` wins; otherwise role default.
 */
export function resolvePracticeWorkView(opts: {
  role: PracticeFirmRole
  viewParam: string | null | undefined
}): PracticeWorkView {
  const raw = opts.viewParam?.trim() ?? ""
  if (raw === "my" || raw === "unassigned" || raw === "all") return raw
  return defaultPracticeWorkView(opts.role)
}
