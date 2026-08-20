/**
 * Practice client discovery helpers (Add Client search).
 * Eligible targets are existing Finza Service workspace businesses.
 */

export const PRACTICE_CLIENT_SEARCH_MIN_QUERY = 2
export const PRACTICE_CLIENT_SEARCH_LIMIT = 20

/** Industries treated as Finza Service workspace client books. */
export const PRACTICE_CLIENT_ELIGIBLE_INDUSTRIES = ["service", "professional"] as const

export type PracticeClientSearchBusiness = {
  id: string
  name: string
  industry: string | null
}

export function isEligiblePracticeClientIndustry(
  industry: string | null | undefined
): boolean {
  if (!industry) return false
  return PRACTICE_CLIENT_ELIGIBLE_INDUSTRIES.includes(
    industry.toLowerCase() as (typeof PRACTICE_CLIENT_ELIGIBLE_INDUSTRIES)[number]
  )
}

/**
 * Clear selection when the user edits the search box away from the selected name.
 */
export function shouldClearPracticeClientSelection(params: {
  selectedName: string | null | undefined
  nextQuery: string
}): boolean {
  if (!params.selectedName) return false
  return params.nextQuery !== params.selectedName
}

/**
 * Whether to run a remote search for the current query/selection state.
 */
export function shouldRunPracticeClientSearch(params: {
  query: string
  selectedName: string | null | undefined
}): boolean {
  const q = params.query.trim()
  if (q.length < PRACTICE_CLIENT_SEARCH_MIN_QUERY) return false
  if (params.selectedName && q === params.selectedName) return false
  return true
}

export function isPracticeClientCreateRoles(role: string | null | undefined): boolean {
  return role === "partner" || role === "senior"
}
