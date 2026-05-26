/**
 * GRA E-VAT submission row persistence helpers (Phase 3C).
 * No HTTP, no GRA/VSDC calls, no secrets written to submission rows.
 */

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { EvatEnvironment } from "./enrollment"
import type { EvatInvoiceDraft } from "./mapInvoiceToEvatDraft"

export type GraEvatSubmissionStatus =
  | "draft"
  | "queued"
  | "submitting"
  | "submitted"
  | "accepted"
  | "rejected"
  | "failed"
  | "cancelled"

export type GraEvatSubmissionType =
  | "invoice"
  | "refund"
  | "partial_refund"
  | "cancellation"
  | "credit_note"
  | "debit_note"

export type GraEvatSubmissionRow = {
  id: string
  business_id: string
  invoice_id: string
  enrollment_id: string | null
  environment: EvatEnvironment
  status: GraEvatSubmissionStatus
  submission_type: GraEvatSubmissionType
  idempotency_key: string
  request_hash: string | null
  draft_snapshot: Record<string, unknown>
  request_payload: Record<string, unknown> | null
  response_payload: Record<string, unknown> | null
  gra_reference: string | null
  ysdcid: string | null
  ysdcrecnum: string | null
  ysdcregsig: string | null
  ysdcintdata: string | null
  ysdcmrc: string | null
  qr_code: string | null
  authority_timestamp: string | null
  error_code: string | null
  error_message: string | null
  retry_count: number
  last_attempt_at: string | null
  next_retry_at: string | null
  submitted_at: string | null
  accepted_at: string | null
  rejected_at: string | null
  failed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type BuildEvatIdempotencyKeyInput = {
  businessId: string
  invoiceId: string
  environment: EvatEnvironment
  submissionType: GraEvatSubmissionType
}

export type CreateDraftEvatSubmissionInput = {
  businessId: string
  invoiceId: string
  enrollmentId?: string | null
  environment: EvatEnvironment
  submissionType?: GraEvatSubmissionType
  draft: EvatInvoiceDraft
  createdBy?: string | null
}

/** Deterministic idempotency token for a submission attempt scope. */
export function buildEvatIdempotencyKey(input: BuildEvatIdempotencyKeyInput): string {
  const { businessId, invoiceId, environment, submissionType } = input
  return `gra-evat:${environment}:${businessId}:${invoiceId}:${submissionType}`
}

/** Canonical JSON (sorted object keys at every depth) for stable hashing. */
export function stableStringifyForEvatHash(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyForEvatHash).join(",")}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringifyForEvatHash(obj[k])}`)
  return `{${entries.join(",")}}`
}

/** SHA-256 hex of the canonical JSON for `draft` (key order independent). */
export function hashEvatDraftSnapshot(draft: EvatInvoiceDraft): string {
  const normalized = JSON.parse(JSON.stringify(draft)) as unknown
  const canonical = stableStringifyForEvatHash(normalized)
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

/** Matches partial unique `gra_evat_submissions_open_invoice_env_type_unique`. */
const OPEN_PIPELINE_STATUSES: GraEvatSubmissionStatus[] = ["draft", "queued", "submitting", "submitted"]

async function selectSubmissionByIdempotencyKey(
  supabase: SupabaseClient,
  businessId: string,
  idempotencyKey: string
): Promise<{ data: GraEvatSubmissionRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("gra_evat_submissions")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .eq("business_id", businessId)
    .maybeSingle()

  if (error) {
    return { data: null, error: { message: error.message } }
  }
  return { data: data as GraEvatSubmissionRow | null, error: null }
}

async function selectOpenPipelineSubmission(
  supabase: SupabaseClient,
  input: {
    businessId: string
    invoiceId: string
    environment: EvatEnvironment
    submissionType: GraEvatSubmissionType
  }
): Promise<{ data: GraEvatSubmissionRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("gra_evat_submissions")
    .select("*")
    .eq("invoice_id", input.invoiceId)
    .eq("environment", input.environment)
    .eq("submission_type", input.submissionType)
    .eq("business_id", input.businessId)
    .in("status", OPEN_PIPELINE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { data: null, error: { message: error.message } }
  }
  return { data: data as GraEvatSubmissionRow | null, error: null }
}

/**
 * Ensures a `draft` submission row exists for this idempotency scope.
 * Idempotent: returns an existing row when `idempotency_key` or an open-pipeline row
 * for the same invoice + environment + submission_type already exists (no duplicate inserts).
 * On unique-violation races, recovers by re-selecting the winner row.
 */
export async function createDraftEvatSubmission(
  supabase: SupabaseClient,
  input: CreateDraftEvatSubmissionInput
): Promise<{ data: GraEvatSubmissionRow | null; error: { message: string } | null }> {
  const submissionType = input.submissionType ?? "invoice"
  const idempotencyKey = buildEvatIdempotencyKey({
    businessId: input.businessId,
    invoiceId: input.invoiceId,
    environment: input.environment,
    submissionType,
  })
  const requestHash = hashEvatDraftSnapshot(input.draft)
  const draftSnapshot = JSON.parse(JSON.stringify(input.draft)) as Record<string, unknown>

  const existingByKey = await selectSubmissionByIdempotencyKey(supabase, input.businessId, idempotencyKey)
  if (existingByKey.error) {
    return { data: null, error: existingByKey.error }
  }
  if (existingByKey.data) {
    return { data: existingByKey.data, error: null }
  }

  const existingOpen = await selectOpenPipelineSubmission(supabase, {
    businessId: input.businessId,
    invoiceId: input.invoiceId,
    environment: input.environment,
    submissionType,
  })
  if (existingOpen.error) {
    return { data: null, error: existingOpen.error }
  }
  if (existingOpen.data) {
    return { data: existingOpen.data, error: null }
  }

  const { data, error } = await supabase
    .from("gra_evat_submissions")
    .insert({
      business_id: input.businessId,
      invoice_id: input.invoiceId,
      enrollment_id: input.enrollmentId ?? null,
      environment: input.environment,
      submission_type: submissionType,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      draft_snapshot: draftSnapshot,
      status: "draft",
      created_by: input.createdBy ?? null,
    })
    .select()
    .single()

  if (!error) {
    return { data: data as GraEvatSubmissionRow, error: null }
  }

  const err = error as { message: string; code?: string }
  if (err.code === "23505") {
    const afterDup = await selectSubmissionByIdempotencyKey(supabase, input.businessId, idempotencyKey)
    if (afterDup.error) {
      return { data: null, error: afterDup.error }
    }
    if (afterDup.data) {
      return { data: afterDup.data, error: null }
    }
    const afterDupOpen = await selectOpenPipelineSubmission(supabase, {
      businessId: input.businessId,
      invoiceId: input.invoiceId,
      environment: input.environment,
      submissionType,
    })
    if (afterDupOpen.error) {
      return { data: null, error: afterDupOpen.error }
    }
    if (afterDupOpen.data) {
      return { data: afterDupOpen.data, error: null }
    }
  }

  return { data: null, error: { message: err.message } }
}

/** Strip outbound/inbound payload blobs from API responses (may contain PII). */
export function toPublicGraEvatSubmissionRow(
  row: GraEvatSubmissionRow
): Omit<GraEvatSubmissionRow, "request_payload" | "response_payload"> {
  const { request_payload: _rp, response_payload: _resp, ...rest } = row
  return rest
}
