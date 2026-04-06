import "server-only"

/**
 * Tenant MTN MoMo direct collection for **service invoices** (public pay flow).
 * Credentials: **`business_payment_providers` only** — never `businesses.momo_settings` (that column is retail legacy).
 *
 * Settlement authority: **GET MTN request-to-pay status** (verified server-side) via
 * `verifyTenantMtnInvoiceByReference`. Callbacks are hints only — see `mtnCallbackHint.ts`.
 *
 * Pending payment lifecycle (Phase 5):
 * - No `payments` row is created at initiate/RTP-accept time. Pending state lives on
 *   `payment_provider_transactions` (`status` pending / initiated / requires_action).
 * - A `payments` row is inserted only after MTN status is SUCCESSFUL (verify path), so DB triggers
 *   that post to the ledger and recalc invoice status do not run until the collection is confirmed.
 * - Failed/rejected MTN verification updates the provider txn; there is no orphan pending payment row
 *   for the deferred model. Legacy rows (payment created at initiate) may still exist in DB; verify
 *   still updates notes on failure when `payment_id` is set.
 */

import { randomUUID } from "crypto"
import type { PostgrestError } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { normalizeCountry, assertProviderAllowed } from "@/lib/payments/eligibility"
import {
  fetchMtnCollectionAccessToken,
  getRequestToPayStatus,
  normalizeGhanaMsisdnForMtn,
  requestToPayCollection,
  type MtnMomoDirectTenantCredentials,
} from "./providers/mtnMomoDirect"
import { normalizeBusinessPaymentProviderRow } from "./providerConfig"
import { getDefaultBusinessPaymentProvider } from "./resolveProvider"

const PROVIDER_TYPE = "mtn_momo_direct" as const
const ENV = "live" as const
const WORKSPACE = "service" as const

/** Reuse in-flight RTP for the same invoice instead of starting duplicate collections. */
const MTN_INVOICE_REUSE_WINDOW_MS = 15 * 60 * 1000

const OPEN_TXN_STATUSES = ["initiated", "pending", "requires_action"] as const

function tenantCredsFromResolved(resolved: {
  kind: string
  public: { target_environment?: string }
  secrets: { api_user: string; api_key: string; primary_subscription_key: string }
}): MtnMomoDirectTenantCredentials {
  if (resolved.kind !== "mtn_momo_direct") {
    throw new Error("Not an MTN MoMo direct configuration")
  }
  const env = resolved.public.target_environment?.trim() || "mtnghana"
  return {
    apiUser: resolved.secrets.api_user,
    apiKey: resolved.secrets.api_key,
    primarySubscriptionKey: resolved.secrets.primary_subscription_key,
    targetEnvironment: env,
  }
}

/** Initiation: default provider must be enabled MTN direct (product rule). */
async function loadDefaultTenantMtnConfigForInitiate(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ creds: MtnMomoDirectTenantCredentials }> {
  const defaultRow = await getDefaultBusinessPaymentProvider(supabase, businessId, ENV)
  if (!defaultRow || defaultRow.provider_type !== PROVIDER_TYPE) {
    throw new Error("Default payment provider is not MTN MoMo direct")
  }
  if (!defaultRow.is_enabled) {
    throw new Error("MTN MoMo direct provider is disabled")
  }
  const resolved = normalizeBusinessPaymentProviderRow(defaultRow)
  return { creds: tenantCredsFromResolved(resolved) }
}

/**
 * Verification: use the business MTN direct row (not “default only”) so a session can still be
 * confirmed if staff change the default provider before settlement.
 */
async function loadMtnDirectCredentialsForBusiness(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ creds: MtnMomoDirectTenantCredentials }> {
  const { data: row, error } = await supabase
    .from("business_payment_providers")
    .select("*")
    .eq("business_id", businessId)
    .eq("provider_type", PROVIDER_TYPE)
    .eq("environment", ENV)
    .maybeSingle()

  if (error || !row) {
    throw new Error("MTN MoMo direct is not configured for this business")
  }
  if (!row.is_enabled) {
    throw new Error("MTN MoMo direct provider is disabled")
  }
  const resolved = normalizeBusinessPaymentProviderRow(row)
  return { creds: tenantCredsFromResolved(resolved) }
}

async function recalculateInvoicePaymentStatus(supabase: SupabaseClient, invoiceId: string): Promise<void> {
  const { data: allPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId)
    .is("deleted_at", null)

  const totalPaid = allPayments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) ?? 0
  const { data: invoice } = await supabase.from("invoices").select("total").eq("id", invoiceId).single()
  const invoiceTotal = Number(invoice?.total || 0)
  const remainingBalance = invoiceTotal - totalPaid

  let newStatus = "sent"
  if (remainingBalance <= 0) newStatus = "paid"
  else if (totalPaid > 0) newStatus = "partially_paid"

  await supabase
    .from("invoices")
    .update({
      status: newStatus,
      paid_at: newStatus === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", invoiceId)
}

function isUniqueViolation(err: PostgrestError | null): boolean {
  return err?.code === "23505"
}

type OpenMtnTxnRow = {
  id: string
  reference: string
  status: string
  payment_id: string | null
  provider_transaction_id: string | null
  created_at: string
}

async function resolveRepeatedInitiateForInvoice(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<
  | { action: "reuse"; row: OpenMtnTxnRow }
  | { action: "proceed" }
  | { action: "conflict"; message: string }
> {
  const { data: rows, error } = await supabase
    .from("payment_provider_transactions")
    .select("id, reference, status, payment_id, provider_transaction_id, created_at")
    .eq("invoice_id", invoiceId)
    .eq("provider_type", PROVIDER_TYPE)
    .eq("workspace", WORKSPACE)
    .in("status", [...OPEN_TXN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(5)

  if (error || !rows?.length) {
    return { action: "proceed" }
  }

  const newest = rows[0] as OpenMtnTxnRow
  const ageMs = Date.now() - new Date(newest.created_at).getTime()

  if (ageMs <= MTN_INVOICE_REUSE_WINDOW_MS) {
    return { action: "reuse", row: newest }
  }

  if (newest.payment_id) {
    return {
      action: "conflict",
      message:
        "A mobile money payment is already in progress for this invoice. Please wait for it to complete or fail before starting another.",
    }
  }

  await supabase
    .from("payment_provider_transactions")
    .update({ status: "cancelled" })
    .eq("invoice_id", invoiceId)
    .eq("provider_type", PROVIDER_TYPE)
    .eq("workspace", WORKSPACE)
    .in("status", [...OPEN_TXN_STATUSES])
    .is("payment_id", null)

  return { action: "proceed" }
}

async function ensureMtnInvoicePaymentRow(
  supabase: SupabaseClient,
  txn: {
    id: string
    business_id: string
    invoice_id: string
    reference: string
    amount_minor: number | null
  },
  financialTransactionId: string | undefined
): Promise<{ paymentId: string; inserted: boolean }> {
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("reference", txn.reference)
    .is("deleted_at", null)
    .maybeSingle()

  if (existing?.id) {
    return { paymentId: existing.id, inserted: false }
  }

  const minor =
    typeof txn.amount_minor === "number" ? txn.amount_minor : Number(txn.amount_minor ?? 0)
  const amount = minor / 100
  if (amount <= 0) {
    throw new Error("Invalid MTN transaction amount")
  }

  const { data: created, error: insErr } = await supabase
    .from("payments")
    .insert({
      business_id: txn.business_id,
      invoice_id: txn.invoice_id,
      amount,
      date: new Date().toISOString().split("T")[0],
      method: "momo",
      reference: txn.reference,
      notes: `MTN MoMo direct — successful (tx ${financialTransactionId ?? "n/a"})`,
    })
    .select("id")
    .single()

  if (!insErr && created?.id) {
    return { paymentId: created.id, inserted: true }
  }

  if (isUniqueViolation(insErr)) {
    const { data: again } = await supabase
      .from("payments")
      .select("id")
      .eq("reference", txn.reference)
      .is("deleted_at", null)
      .maybeSingle()
    if (again?.id) {
      return { paymentId: again.id, inserted: false }
    }
  }

  console.error("[mtnInvoiceDirect] payment insert at verify", insErr)
  throw new Error("Failed to record payment")
}

export type InitiateTenantMtnInvoiceResult =
  | {
      ok: true
      reference: string
      /** Present only after MTN success (verify); deferred model keeps this null at initiate. */
      payment_id: string | null
      display_text: string
      status: "pending"
      reused_session?: boolean
    }
  | { ok: false; error: string; statusCode: number }

/**
 * Public invoice pay: validate invoice, use canonical tenant MTN credentials, create provider txn + pending payment, call MTN.
 * `invoice_id` is the capability — no `business_id` from client is trusted for scoping.
 */
export async function initiateTenantMtnInvoicePayment(
  supabase: SupabaseClient,
  input: { invoiceId: string; phone: string }
): Promise<InitiateTenantMtnInvoiceResult> {
  const phone = input.phone?.trim()
  if (!input.invoiceId || !phone) {
    return { ok: false, error: "invoice_id and phone are required", statusCode: 400 }
  }

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_number, total, business_id, status")
    .eq("id", input.invoiceId)
    .is("deleted_at", null)
    .single()

  if (invErr || !invoice?.business_id) {
    return { ok: false, error: "Invoice not found", statusCode: 404 }
  }
  if (invoice.status === "paid") {
    return { ok: false, error: "Invoice is already paid", statusCode: 400 }
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, address_country")
    .eq("id", invoice.business_id)
    .single()

  if (!business) {
    return { ok: false, error: "Business not found", statusCode: 404 }
  }

  const countryCode = normalizeCountry(business.address_country)
  try {
    assertProviderAllowed(countryCode, "mtn_momo")
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Payment not available for this region"
    return { ok: false, error: msg, statusCode: 403 }
  }

  const { data: existingPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoice.id)
    .is("deleted_at", null)

  const totalPaid = existingPayments?.reduce((s, p) => s + Number(p.amount || 0), 0) ?? 0
  const remaining = Number(invoice.total) - totalPaid
  if (remaining <= 0) {
    return { ok: false, error: "No balance remaining on this invoice", statusCode: 400 }
  }

  const repeat = await resolveRepeatedInitiateForInvoice(supabase, invoice.id)
  if (repeat.action === "conflict") {
    return { ok: false, error: repeat.message, statusCode: 409 }
  }
  if (repeat.action === "reuse") {
    const row = repeat.row
    return {
      ok: true,
      reference: row.reference,
      payment_id: row.payment_id,
      display_text:
        "Approve the MoMo prompt on your phone. We will confirm when MTN reports success.",
      status: "pending",
      reused_session: true,
    }
  }

  let creds: MtnMomoDirectTenantCredentials
  try {
    ;({ creds } = await loadDefaultTenantMtnConfigForInitiate(supabase, invoice.business_id))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "MTN direct is not configured"
    return { ok: false, error: msg, statusCode: 400 }
  }

  const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, invoice.business_id)
  if (bootstrapErr) {
    return {
      ok: false,
      error: "Accounting setup required before payment can be recorded.",
      statusCode: 500,
    }
  }

  const reference = `finza-mtn-${randomUUID()}`
  const xReferenceId = randomUUID()
  const amountStr = remaining.toFixed(2)
  const msisdn = normalizeGhanaMsisdnForMtn(phone)

  const { error: txnInsErr } = await supabase.from("payment_provider_transactions").insert({
    business_id: invoice.business_id,
    provider_type: PROVIDER_TYPE,
    workspace: WORKSPACE,
    invoice_id: invoice.id,
    sale_id: null,
    payment_id: null,
    reference,
    provider_transaction_id: xReferenceId,
    status: "initiated",
    amount_minor: Math.round(remaining * 100),
    currency: "GHS",
    idempotency_key: reference,
    request_payload: {
      invoice_id: invoice.id,
      amount: amountStr,
      externalId: reference,
      xReferenceId,
    } as unknown as Record<string, unknown>,
    response_payload: null,
    last_event_payload: null,
    last_event_at: null,
  })

  if (txnInsErr) {
    console.error("[mtnInvoiceDirect] txn insert", txnInsErr)
    return { ok: false, error: "Could not start payment session", statusCode: 500 }
  }

  const tokenRes = await fetchMtnCollectionAccessToken(creds)
  if (!tokenRes.ok) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        response_payload: { error: tokenRes.error } as unknown as Record<string, unknown>,
      })
      .eq("reference", reference)
      .eq("provider_type", PROVIDER_TYPE)
    return { ok: false, error: "Could not authenticate with MTN (check tenant MTN credentials)", statusCode: 502 }
  }

  const rtp = await requestToPayCollection({
    creds,
    accessToken: tokenRes.accessToken,
    xReferenceId,
    amount: amountStr,
    currency: "GHS",
    externalId: reference,
    payerMsisdn: msisdn,
    payerMessage: `Invoice ${invoice.invoice_number}`,
  })

  if (!rtp.ok || !rtp.accepted) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        response_payload: { error: rtp.ok ? null : rtp.error, detail: rtp.ok ? null : rtp.detail } as unknown as Record<
          string,
          unknown
        >,
      })
      .eq("reference", reference)
      .eq("provider_type", PROVIDER_TYPE)
    return {
      ok: false,
      error: rtp.ok ? "MTN did not accept the payment request" : rtp.error,
      statusCode: 502,
    }
  }

  await supabase
    .from("payment_provider_transactions")
    .update({
      status: "pending",
      payment_id: null,
      response_payload: { httpStatus: 202, accepted: true } as unknown as Record<string, unknown>,
    })
    .eq("reference", reference)
    .eq("provider_type", PROVIDER_TYPE)

  return {
    ok: true,
    reference,
    payment_id: null,
    display_text: "Approve the MoMo prompt on your phone. We will confirm when MTN reports success.",
    status: "pending",
  }
}

export type VerifyTenantMtnInvoiceResult =
  | { ok: true; status: "success" | "pending" | "failed"; applied: boolean; message?: string }
  | { ok: false; error: string; statusCode: number }

export type VerifyTenantMtnInvoiceOptions = {
  /**
   * When set, the provider txn must belong to this invoice.
   * **Public routes** (`tenant/invoice/status`, `momo/status` for `finza-mtn-*`) require this (Phase 6).
   * Omitted only for internal/unit callers that already scoped the session.
   */
  invoiceId?: string | null
}

/**
 * **Authoritative tenant MTN invoice settlement (only path that may insert `payments` / mark txn successful).**
 *
 * - Loads `payment_provider_transactions` by `(provider_type, reference)`.
 * - Optionally requires `invoice_id` binding when callers pass `options.invoiceId` (public routes require it).
 * - Calls MTN Collection **GET request-to-pay status** with tenant credentials — not callback body.
 * - Promotes txn with `.in('status', openStatuses)` so duplicate verify / callback races cannot double-apply.
 *
 * Non-authoritative: `POST /api/payments/momo/callback`, and any client-only “success” UI state.
 */
export async function verifyTenantMtnInvoiceByReference(
  supabase: SupabaseClient,
  reference: string,
  options?: VerifyTenantMtnInvoiceOptions
): Promise<VerifyTenantMtnInvoiceResult> {
  if (!reference?.trim()) {
    return { ok: false, error: "reference is required", statusCode: 400 }
  }

  const { data: txn, error: txnErr } = await supabase
    .from("payment_provider_transactions")
    .select(
      "id, business_id, invoice_id, payment_id, provider_transaction_id, status, amount_minor, reference"
    )
    .eq("provider_type", PROVIDER_TYPE)
    .eq("reference", reference.trim())
    .maybeSingle()

  if (txnErr || !txn) {
    return { ok: false, error: "Payment session not found", statusCode: 404 }
  }

  const boundInvoice = options?.invoiceId?.trim()
  if (boundInvoice && txn.invoice_id !== boundInvoice) {
    return { ok: false, error: "Payment session does not match this invoice", statusCode: 404 }
  }

  if (!txn.invoice_id || !txn.provider_transaction_id) {
    return { ok: false, error: "Incomplete payment session", statusCode: 400 }
  }

  if (txn.status === "successful") {
    await recalculateInvoicePaymentStatus(supabase, txn.invoice_id)
    return { ok: true, status: "success", applied: false, message: "Already confirmed" }
  }
  if (txn.status === "failed" || txn.status === "cancelled") {
    return { ok: true, status: "failed", applied: false }
  }

  let creds: MtnMomoDirectTenantCredentials
  try {
    ;({ creds } = await loadMtnDirectCredentialsForBusiness(supabase, txn.business_id))
  } catch {
    return { ok: false, error: "Tenant MTN configuration unavailable", statusCode: 500 }
  }

  const tokenRes = await fetchMtnCollectionAccessToken(creds)
  if (!tokenRes.ok) {
    return { ok: true, status: "pending", applied: false, message: "Could not reach MTN to verify" }
  }

  const st = await getRequestToPayStatus({
    creds,
    accessToken: tokenRes.accessToken,
    xReferenceId: txn.provider_transaction_id,
  })

  if (!st.ok) {
    return { ok: true, status: "pending", applied: false, message: "MTN status temporarily unavailable" }
  }

  const s = st.status.toUpperCase()
  if (s === "FAILED" || s === "REJECTED") {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        last_event_payload: { mtnStatus: st } as unknown as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
      .in("status", [...OPEN_TXN_STATUSES])

    if (txn.payment_id) {
      await supabase
        .from("payments")
        .update({
          notes: `MTN MoMo direct — failed (${st.reason ?? s})`,
        })
        .eq("id", txn.payment_id)
    }

    return { ok: true, status: "failed", applied: false }
  }

  if (s !== "SUCCESSFUL") {
    return { ok: true, status: "pending", applied: false }
  }

  let paymentId = txn.payment_id
  try {
    if (!paymentId) {
      const ensured = await ensureMtnInvoicePaymentRow(supabase, txn, st.financialTransactionId)
      paymentId = ensured.paymentId
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Payment recording failed"
    return { ok: false, error: msg, statusCode: 500 }
  }

  const { data: promoted, error: promoteErr } = await supabase
    .from("payment_provider_transactions")
    .update({
      status: "successful",
      payment_id: paymentId,
      last_event_payload: { mtnStatus: st } as unknown as Record<string, unknown>,
      last_event_at: new Date().toISOString(),
    })
    .eq("id", txn.id)
    .in("status", [...OPEN_TXN_STATUSES])
    .select("id")
    .maybeSingle()

  if (promoteErr) {
    console.error("[mtnInvoiceDirect] promote", promoteErr)
    return { ok: false, error: "Update failed", statusCode: 500 }
  }

  let applied = !!promoted
  if (!applied) {
    const { data: cur } = await supabase
      .from("payment_provider_transactions")
      .select("status, payment_id")
      .eq("id", txn.id)
      .maybeSingle()
    if (cur?.status === "successful") {
      await recalculateInvoicePaymentStatus(supabase, txn.invoice_id)
      return { ok: true, status: "success", applied: false, message: "Already confirmed" }
    }
    return { ok: true, status: "pending", applied: false, message: "Could not finalize status" }
  }

  await supabase
    .from("payments")
    .update({
      notes: `MTN MoMo direct — successful (tx ${st.financialTransactionId ?? "n/a"})`,
    })
    .eq("id", paymentId!)

  await recalculateInvoicePaymentStatus(supabase, txn.invoice_id)

  return { ok: true, status: "success", applied, message: applied ? "Confirmed" : "Already confirmed" }
}
