/**
 * List + summary helpers for incoming documents (Stage 3 workspace).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

const DOC_STATUSES = new Set([
  "uploaded",
  "extracting",
  "extracted",
  "needs_review",
  "reviewed",
  "failed",
  "linked",
])

const REVIEW_STATUSES = new Set(["none", "draft", "accepted"])

const DOC_KINDS = new Set(["expense_receipt", "supplier_bill_attachment", "unknown"])

export type IncomingDocumentListSummary = {
  id: string
  display_name: string
  document_kind: string
  source_type: string
  source_email_sender: string | null
  source_email_subject: string | null
  status: string
  review_status: string
  created_at: string
  linked_entity_type: string | null
  linked_entity_id: string | null
  latest_extraction: {
    extraction_mode: string | null
    page_count: number | null
    extraction_status: string | null
    extraction_failed: boolean
    has_warnings: boolean
    error_snippet: string | null
  } | null
}

export type ListIncomingDocumentsParams = {
  businessId: string
  limit: number
  offset: number
  /** Exact status values (AND with other filters) */
  statusIn: string[] | null
  reviewStatusIn: string[] | null
  documentKind: string | null
  linked: "all" | "linked" | "unlinked"
  search: string | null
  /** Failed, needs_review, or extracted+unlinked+not accepted */
  attentionOnly: boolean
  /** Accepted review or lifecycle status reviewed */
  reviewedOnly: boolean
  sort: "newest" | "oldest" | "attention"
}

export type ParsedListQuery = { ok: true; params: ListIncomingDocumentsParams } | { ok: false; error: string }

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function parseCsvEnums<T extends string>(raw: string | null, allowed: Set<string>, label: string): T[] | null {
  if (!raw?.trim()) return null
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const bad = parts.filter((p) => !allowed.has(p))
  if (bad.length) return null
  return parts as T[]
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseIncomingDocumentsListQuery(searchParams: URLSearchParams): ParsedListQuery {
  const businessId = searchParams.get("business_id")?.trim() ?? ""
  if (!businessId) {
    return { ok: false, error: "business_id is required" }
  }

  const limit = clampInt(Number(searchParams.get("limit") ?? DEFAULT_LIMIT), 1, MAX_LIMIT)
  const offset = Math.max(0, clampInt(Number(searchParams.get("offset") ?? 0), 0, 1_000_000))

  const statusIn = parseCsvEnums(searchParams.get("status"), DOC_STATUSES, "status")
  if (searchParams.get("status")?.trim() && !statusIn) {
    return { ok: false, error: "Invalid status filter" }
  }

  const reviewStatusIn = parseCsvEnums(searchParams.get("review_status"), REVIEW_STATUSES, "review_status")
  if (searchParams.get("review_status")?.trim() && !reviewStatusIn) {
    return { ok: false, error: "Invalid review_status filter" }
  }

  const kindRaw = searchParams.get("document_kind")?.trim() ?? ""
  const documentKind = kindRaw ? (DOC_KINDS.has(kindRaw) ? kindRaw : null) : null
  if (kindRaw && !documentKind) {
    return { ok: false, error: "Invalid document_kind" }
  }

  const linkedRaw = (searchParams.get("linked") ?? "all").trim().toLowerCase()
  const linked: "all" | "linked" | "unlinked" =
    linkedRaw === "linked" ? "linked" : linkedRaw === "unlinked" ? "unlinked" : "all"
  if (linkedRaw && linkedRaw !== "all" && linkedRaw !== "linked" && linkedRaw !== "unlinked") {
    return { ok: false, error: "linked must be all, linked, or unlinked" }
  }

  const search = searchParams.get("q")?.trim().slice(0, 200) || null

  const attentionRaw = (searchParams.get("attention") ?? "").trim().toLowerCase()
  const attentionOnly = attentionRaw === "1" || attentionRaw === "true" || attentionRaw === "yes"
  if (attentionRaw && !attentionOnly) {
    return { ok: false, error: "attention must be 1, true, or yes when set" }
  }

  const reviewedRaw = (searchParams.get("reviewed") ?? "").trim().toLowerCase()
  const reviewedOnly = reviewedRaw === "1" || reviewedRaw === "true" || reviewedRaw === "yes"
  if (reviewedRaw && !reviewedOnly) {
    return { ok: false, error: "reviewed must be 1, true, or yes when set" }
  }

  const sortRaw = (searchParams.get("sort") ?? "newest").trim().toLowerCase()
  const sort: "newest" | "oldest" | "attention" =
    sortRaw === "oldest" ? "oldest" : sortRaw === "attention" ? "attention" : "newest"
  if (sortRaw && sortRaw !== "newest" && sortRaw !== "oldest" && sortRaw !== "attention") {
    return { ok: false, error: "sort must be newest, oldest, or attention" }
  }

  if (attentionOnly && reviewedOnly) {
    return { ok: false, error: "attention and reviewed filters cannot both be set" }
  }

  return {
    ok: true,
    params: {
      businessId,
      limit,
      offset,
      statusIn,
      reviewStatusIn,
      documentKind,
      linked,
      search,
      attentionOnly,
      reviewedOnly,
      sort,
    },
  }
}

function displayName(row: {
  id: string
  file_name: string | null
  storage_path: string | null
}): string {
  const fn = row.file_name?.trim()
  if (fn) return fn
  const p = row.storage_path?.trim()
  if (p) {
    const seg = p.split("/").filter(Boolean).pop()
    if (seg) return seg
  }
  return `Document ${row.id.slice(0, 8)}…`
}

function attentionRank(status: string): number {
  if (status === "failed") return 0
  if (status === "needs_review") return 1
  if (status === "extracting" || status === "uploaded") return 2
  return 3
}

export async function listIncomingDocumentSummaries(
  supabase: SupabaseClient,
  params: ListIncomingDocumentsParams
): Promise<{ summaries: IncomingDocumentListSummary[]; total: number }> {
  let q = supabase
    .from("incoming_documents")
    .select(
      "id, file_name, document_kind, status, review_status, source_type, source_email_sender, source_email_subject, storage_path, linked_entity_type, linked_entity_id, latest_extraction_id, created_at, mime_type",
      { count: "exact" }
    )
    .eq("business_id", params.businessId)

  if (params.attentionOnly) {
    q = q.or(
      "status.eq.failed,status.eq.needs_review,and(status.eq.extracted,review_status.neq.accepted,linked_entity_id.is.null)"
    )
  }

  if (params.reviewedOnly) {
    q = q.or("review_status.eq.accepted,status.eq.reviewed")
  }

  if (params.statusIn?.length) {
    q = q.in("status", params.statusIn)
  }

  if (params.reviewStatusIn?.length) {
    q = q.in("review_status", params.reviewStatusIn)
  }

  if (params.documentKind) {
    q = q.eq("document_kind", params.documentKind)
  }

  if (params.linked === "linked") {
    q = q.not("linked_entity_id", "is", null)
  } else if (params.linked === "unlinked") {
    q = q.is("linked_entity_id", null)
  }

  if (params.search) {
    const safe = params.search.replace(/%/g, "").replace(/_/g, "").replace(/,/g, "").trim()
    if (safe.length > 0) {
      const pattern = `%${safe}%`
      if (UUID_RE.test(safe)) {
        q = q.or(
          `file_name.ilike.${pattern},storage_path.ilike.${pattern},source_email_subject.ilike.${pattern},source_email_sender.ilike.${pattern},id.eq.${safe}`
        )
      } else {
        q = q.or(
          `file_name.ilike.${pattern},storage_path.ilike.${pattern},source_email_subject.ilike.${pattern},source_email_sender.ilike.${pattern}`
        )
      }
    }
  }

  const ascending = params.sort === "oldest"
  q = q.order("created_at", { ascending })

  const from = params.offset
  const to = params.offset + params.limit - 1
  const { data: rows, error, count } = await q.range(from, to)

  if (error) {
    throw new Error(error.message || "Failed to list incoming documents")
  }

  const docRows = (rows ?? []) as Array<{
    id: string
    file_name: string | null
    document_kind: string
    status: string
    review_status: string | null
    source_type: string
    source_email_sender: string | null
    source_email_subject: string | null
    storage_path: string | null
    linked_entity_type: string | null
    linked_entity_id: string | null
    latest_extraction_id: string | null
    created_at: string
    mime_type: string | null
  }>

  const extIds = [...new Set(docRows.map((r) => r.latest_extraction_id).filter(Boolean))] as string[]
  const extMap = new Map<
    string,
    {
      extraction_mode: string | null
      page_count: number | null
      extraction_warnings: unknown
      status: string
      error_message: string | null
    }
  >()

  if (extIds.length > 0) {
    const { data: exts, error: extErr } = await supabase
      .from("incoming_document_extractions")
      .select("id, extraction_mode, page_count, extraction_warnings, status, error_message")
      .in("id", extIds)

    if (extErr) {
      throw new Error(extErr.message || "Failed to load extractions")
    }
    for (const e of exts ?? []) {
      extMap.set(e.id as string, e as never)
    }
  }

  let summaries: IncomingDocumentListSummary[] = docRows.map((row) => {
    const ext = row.latest_extraction_id ? extMap.get(row.latest_extraction_id) : undefined
    const warnings = ext?.extraction_warnings
    const hasWarnings = Array.isArray(warnings) && warnings.length > 0
    const extractionFailed = ext?.status === "failed" || row.status === "failed"

    return {
      id: row.id,
      display_name: displayName(row),
      document_kind: row.document_kind,
      source_type: row.source_type,
      source_email_sender: row.source_email_sender ?? null,
      source_email_subject: row.source_email_subject ?? null,
      status: row.status,
      review_status: row.review_status ?? "none",
      created_at: row.created_at,
      linked_entity_type: row.linked_entity_type,
      linked_entity_id: row.linked_entity_id,
      latest_extraction: ext
        ? {
            extraction_mode: ext.extraction_mode ?? null,
            page_count: ext.page_count ?? null,
            extraction_status: ext.status ?? null,
            extraction_failed: ext.status === "failed",
            has_warnings: hasWarnings,
            error_snippet: ext.error_message ? String(ext.error_message).slice(0, 200) : null,
          }
        : null,
    }
  })

  if (params.sort === "attention") {
    summaries = [...summaries].sort((a, b) => {
      const d = attentionRank(a.status) - attentionRank(b.status)
      if (d !== 0) return d
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }

  return { summaries, total: count ?? summaries.length }
}
