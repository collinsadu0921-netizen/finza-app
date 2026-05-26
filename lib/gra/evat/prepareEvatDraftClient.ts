/**
 * Client-safe parsing of POST /api/gra/evat/invoices/[id]/draft responses.
 * Only exposes fields intended for UI; ignores payload blobs and extra rows.
 */

export type EvatDraftPrepareTotals = {
  mappedTotalTax: number
  storedTotalTax: number
  taxDifference: number
}

export type EvatDraftPrepareSuccess = {
  kind: "success"
  submissionId: string
  submittable: boolean
  totals: EvatDraftPrepareTotals
  warnings: string[]
}

export type EvatDraftPrepareBlocked = {
  kind: "blocked"
  blockingIssues: string[]
  warnings: string[]
  totals: EvatDraftPrepareTotals | null
}

export type EvatDraftPrepareHttpError = {
  kind: "http_error"
}

export type EvatDraftPrepareParsed =
  | EvatDraftPrepareSuccess
  | EvatDraftPrepareBlocked
  | EvatDraftPrepareHttpError

function readTotals(draft: unknown): EvatDraftPrepareTotals | null {
  if (!draft || typeof draft !== "object") return null
  const t = (draft as Record<string, unknown>).totals
  if (!t || typeof t !== "object") return null
  const o = t as Record<string, unknown>
  const mapped = Number(o.mappedTotalTax)
  const stored = Number(o.storedTotalTax)
  const diff = Number(o.taxDifference)
  if (![mapped, stored, diff].every((n) => Number.isFinite(n))) return null
  return { mappedTotalTax: mapped, storedTotalTax: stored, taxDifference: diff }
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string")
}

function readSubmissionId(submission: unknown): string | null {
  if (!submission || typeof submission !== "object") return null
  const id = (submission as Record<string, unknown>).id
  return typeof id === "string" && id.trim() !== "" ? id : null
}

/**
 * @param httpOk — `Response.ok` from fetch
 * @param json — parsed JSON body, or null if parse failed
 */
export function normalizeEvatDraftPrepareResponse(
  httpOk: boolean,
  json: unknown | null
): EvatDraftPrepareParsed {
  if (!httpOk || json === null) {
    return { kind: "http_error" }
  }
  if (typeof json !== "object" || json === null) {
    return { kind: "http_error" }
  }
  const o = json as Record<string, unknown>

  if (o.ok === true) {
    const draft = o.draft
    const totals = readTotals(draft)
    const warnings =
      draft && typeof draft === "object"
        ? readStringArray((draft as Record<string, unknown>).warnings)
        : []
    const submittable =
      typeof (draft as Record<string, unknown> | null)?.submittable === "boolean"
        ? ((draft as Record<string, unknown>).submittable as boolean)
        : false
    const submissionId = readSubmissionId(o.submission)
    if (!submissionId || !totals) {
      return { kind: "http_error" }
    }
    return {
      kind: "success",
      submissionId,
      submittable,
      totals,
      warnings,
    }
  }

  if (o.ok === false) {
    const draft = o.draft
    return {
      kind: "blocked",
      blockingIssues: readStringArray(o.blockingIssues),
      warnings: readStringArray(o.warnings),
      totals: readTotals(draft),
    }
  }

  return { kind: "http_error" }
}
