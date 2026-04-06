import "server-only"

/**
 * MTN Collection **callback / webhook body** handling — **untrusted hint only**.
 *
 * - Does **not** verify cryptographic authenticity (not documented for this integration).
 * - Does **not** create `payments` rows, change invoice status, or mark `payment_provider_transactions` paid.
 * - Binds `externalId` → existing `payment_provider_transactions.reference` (service workspace, MTN direct).
 * - Persists an append-only event row (deduped by payload fingerprint) and refreshes `last_event_payload`
 *   on the parent txn for operators.
 *
 * **Authoritative settlement** remains `verifyTenantMtnInvoiceByReference` (MTN server status API).
 */

import { createHash } from "crypto"
import type { PostgrestError } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"

const PROVIDER_TYPE = "mtn_momo_direct" as const
const WORKSPACE = "service" as const
const EVENT_CALLBACK_HINT = "callback_hint" as const

function isUniqueViolation(err: PostgrestError | null): boolean {
  return err?.code === "23505"
}

/** Deterministic JSON for hashing (sorted object keys, recursively). */
export function stableStringifyForFingerprint(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringifyForFingerprint(v)).join(",")}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringifyForFingerprint(obj[k])}`).join(",")}}`
}

export function callbackPayloadFingerprint(body: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringifyForFingerprint(body), "utf8").digest("hex")
}

function extractExternalReference(body: Record<string, unknown>): string | null {
  const a = body.externalId
  const b = body.external_id
  if (typeof a === "string" && a.trim()) return a.trim()
  if (typeof b === "string" && b.trim()) return b.trim()
  return null
}

function extractExternalEventId(body: Record<string, unknown>): string | null {
  const keys = ["transactionId", "financialTransactionId", "referenceId", "reference_id", "id"] as const
  for (const k of keys) {
    const v = body[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

export type RecordTenantMtnCallbackHintResult = {
  /** Matched an existing `payment_provider_transactions` row (service MTN direct). */
  bound: boolean
  /** Same payload was already recorded for this txn (idempotent retry). */
  duplicate_hint: boolean
}

/**
 * Store callback as a hint. Safe for unknown references (no throw). Always idempotent on duplicate payload.
 */
export async function recordTenantMtnCallbackHint(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<RecordTenantMtnCallbackHintResult> {
  const externalRef = extractExternalReference(body)
  if (!externalRef) {
    return { bound: false, duplicate_hint: false }
  }

  const { data: txn, error: txnErr } = await supabase
    .from("payment_provider_transactions")
    .select("id, status")
    .eq("provider_type", PROVIDER_TYPE)
    .eq("workspace", WORKSPACE)
    .eq("reference", externalRef)
    .maybeSingle()

  if (txnErr || !txn?.id) {
    return { bound: false, duplicate_hint: false }
  }

  const fingerprint = callbackPayloadFingerprint(body)

  const { error: insErr } = await supabase.from("payment_provider_transaction_events").insert({
    payment_provider_transaction_id: txn.id,
    provider_type: PROVIDER_TYPE,
    event_type: EVENT_CALLBACK_HINT,
    external_event_id: extractExternalEventId(body),
    payload: body as unknown as Record<string, unknown>,
    payload_fingerprint: fingerprint,
  })

  if (insErr && isUniqueViolation(insErr)) {
    return { bound: true, duplicate_hint: true }
  }

  if (insErr) {
    console.error("[mtnCallbackHint] event insert", insErr)
    return { bound: true, duplicate_hint: false }
  }

  await supabase
    .from("payment_provider_transactions")
    .update({
      last_event_payload: body as unknown as Record<string, unknown>,
      last_event_at: new Date().toISOString(),
    })
    .eq("id", txn.id)
    .eq("provider_type", PROVIDER_TYPE)

  return { bound: true, duplicate_hint: false }
}
