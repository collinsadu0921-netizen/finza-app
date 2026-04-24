import { isLikelyUuid } from "@/lib/email/resendWebhookSafePayload"

/** Resend tag entry (same shape as `TransactionalEmailTag` in sendTransactionalEmail). */
export type FinzaResendTagEntry = { name: string; value: string }

/** Values for `finza_document_type` (ASCII, no spaces). */
export type FinzaDocumentTagType =
  | "invoice"
  | "quote"
  | "proposal"
  | "receipt"
  | "account"
  | "trial"
  | "proforma"
  | "credit_note"

export type FinzaWorkspaceTag = "service" | "retail" | "accounting"

export type BuildFinzaResendTagsInput = {
  businessId: string
  documentType: FinzaDocumentTagType
  /** Primary document row id (invoice, sale, payslip, …). Omitted from tags when unset. */
  documentId?: string | null
  workspace?: FinzaWorkspaceTag | null
}

const DOC_TYPE_RE = /^[a-z][a-z0-9_]{0,48}$/

function safeDocumentType(v: string): string | null {
  const s = v.trim().toLowerCase()
  return DOC_TYPE_RE.test(s) ? s : null
}

function safeWorkspace(v: FinzaWorkspaceTag): string {
  return v
}

/**
 * Map `businesses.industry` (and close variants) to a coarse Finza workspace tag.
 */
export function inferFinzaWorkspaceFromIndustry(industry: string | null | undefined): FinzaWorkspaceTag {
  const i = String(industry ?? "").trim().toLowerCase()
  if (i === "service") return "service"
  if (i === "retail") return "retail"
  if (i === "accounting" || i === "accounting_firm") return "accounting"
  return "retail"
}

/**
 * Build Resend tags for webhook correlation (`finza_business_id`, document, workspace).
 * Omits invalid UUIDs and undefined/null optional fields. Does not throw.
 */
export function buildFinzaResendTags(input: BuildFinzaResendTagsInput): FinzaResendTagEntry[] {
  const bid = String(input.businessId || "").trim()
  if (!isLikelyUuid(bid)) return []

  const docType = safeDocumentType(String(input.documentType || ""))
  if (!docType) return []

  const out: FinzaResendTagEntry[] = [
    { name: "finza_business_id", value: bid.toLowerCase() },
    { name: "finza_document_type", value: docType },
  ]

  const did = input.documentId != null ? String(input.documentId).trim() : ""
  if (did && isLikelyUuid(did)) {
    out.push({ name: "finza_document_id", value: did.toLowerCase() })
  }

  if (input.workspace != null) {
    out.push({ name: "finza_workspace", value: safeWorkspace(input.workspace) })
  }

  return out
}

/**
 * Finza tags first (authoritative), then others; dedupe by tag name; cap at `max`.
 */
export function mergeFinzaWithOtherTags(
  finza: FinzaResendTagEntry[],
  rest: FinzaResendTagEntry[] | undefined,
  max = 10
): FinzaResendTagEntry[] {
  const seen = new Set<string>()
  const out: FinzaResendTagEntry[] = []
  const push = (t: FinzaResendTagEntry) => {
    const name = t.name.trim()
    const value = t.value.trim()
    if (!name || !value || seen.has(name)) return
    seen.add(name)
    out.push({ name, value })
  }
  for (const t of finza) push(t)
  for (const t of rest ?? []) push(t)
  return out.slice(0, max)
}
