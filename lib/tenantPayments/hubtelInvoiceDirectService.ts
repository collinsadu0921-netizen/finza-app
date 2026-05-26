import "server-only"

/**
 * Tenant Hubtel Online Checkout for **service invoices** (public pay flow).
 * Credentials: `business_payment_providers` encrypted secrets only — never `businesses.hubtel_settings`.
 *
 * Settlement authority: Hubtel Transaction Status Check API (server-side).
 * Callbacks are hints only — never insert `payments` from callback body alone.
 *
 * When status check fails (403/IP whitelist, timeout, network), txn stays `pending_verification`
 * and no payment row is created.
 */

import { createHash } from "crypto"
import type { PostgrestError } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ensureAccountingInitializedForServerJob } from "@/lib/accountingBootstrap"
import { fetchInvoiceBalanceDuePublic } from "@/lib/invoices/invoicePublicBalanceDue"
import { normalizeCountry, assertProviderAllowed } from "@/lib/payments/eligibility"
import { tenantInvoiceOnlinePaymentsEnabled } from "@/lib/payments/tenantInvoiceOnlinePayments"
import {
  checkHubtelTransactionStatus,
  createHubtelCheckout,
  hubtelAmountsMatch,
  isHubtelStatusCheckUnavailableError,
  type HubtelCredentials,
  type NormalizedHubtelStatusResponse,
} from "./hubtelClient"
import { generateHubtelClientReference } from "./hubtelReferences"
import { resolveTenantProviderConfig } from "./resolveProvider"
import type { ResolvedHubtelConfig } from "./types"

const PROVIDER_TYPE = "hubtel" as const
const ENV = "live" as const
const WORKSPACE = "service" as const

const OPEN_TXN_STATUSES = [
  "initiated",
  "pending",
  "requires_action",
  "pending_verification",
  "pending_accounting_setup",
] as const
const HUBTEL_CALLBACK_EVENT = "hubtel_callback" as const

function isUniqueViolation(err: PostgrestError | null): boolean {
  return err?.code === "23505"
}

function isNonPublicInvoiceStatus(status: string | null | undefined): boolean {
  const s = String(status || "")
    .trim()
    .toLowerCase()
  return s === "draft" || s === "cancelled" || s === "void"
}

function hubtelCredentialsFromResolved(resolved: ResolvedHubtelConfig): HubtelCredentials {
  const merchant =
    resolved.public.merchant_account_number?.trim() ||
    resolved.public.collection_account_number?.trim() ||
    ""
  if (!merchant) {
    throw new Error("Hubtel Collection Account Number is not configured")
  }
  const apiId = resolved.secrets.api_id?.trim() || resolved.secrets.pos_key?.trim() || ""
  const apiKey = resolved.secrets.api_key?.trim() || resolved.secrets.api_secret?.trim() || ""
  if (!apiId || !apiKey) {
    throw new Error("Hubtel API ID and API Key are required")
  }
  return {
    apiId,
    apiKey,
    merchantAccountNumber: merchant,
  }
}

async function loadHubtelConfigForBusiness(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ creds: HubtelCredentials; resolved: ResolvedHubtelConfig }> {
  const resolved = await resolveTenantProviderConfig(supabase, {
    businessId,
    providerType: PROVIDER_TYPE,
    environment: ENV,
    requireEnabled: true,
  })
  if (resolved.kind !== "hubtel") {
    throw new Error("Not a Hubtel configuration")
  }
  return { creds: hubtelCredentialsFromResolved(resolved), resolved }
}

export function resolveFinzaPublicBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, "")
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
  }
  return "http://localhost:3000"
}

function hubtelCallbackUrl(): string {
  return `${resolveFinzaPublicBaseUrl()}/api/payments/hubtel/tenant/invoice/callback`
}

function hubtelReturnUrl(invoiceId: string, publicToken: string): string {
  const base = resolveFinzaPublicBaseUrl()
  return `${base}/api/payments/hubtel/tenant/invoice/return?invoice_id=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(publicToken)}`
}

function hubtelCancelUrl(invoiceId: string, publicToken: string): string {
  const base = resolveFinzaPublicBaseUrl()
  return `${base}/api/payments/hubtel/tenant/invoice/cancel?invoice_id=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(publicToken)}`
}

export async function validateInvoicePublicToken(
  supabase: SupabaseClient,
  invoiceId: string,
  publicToken: string
): Promise<
  | {
      ok: true
      invoice: {
        id: string
        invoice_number: string
        total: number
        business_id: string
        status: string
        public_token: string
      }
    }
  | { ok: false; error: string; statusCode: number }
> {
  const token = publicToken?.trim()
  if (!invoiceId?.trim() || !token) {
    return { ok: false, error: "invoice_id and public_token are required", statusCode: 400 }
  }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, total, business_id, status, public_token")
    .eq("id", invoiceId.trim())
    .eq("public_token", token)
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !invoice) {
    return { ok: false, error: "Invoice not found", statusCode: 404 }
  }

  if (isNonPublicInvoiceStatus(invoice.status)) {
    return { ok: false, error: "Invoice not available for payment", statusCode: 404 }
  }

  return { ok: true, invoice: invoice as typeof invoice & { public_token: string } }
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

function stableStringifyForFingerprint(value: unknown): string {
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

export function extractHubtelClientReferenceFromCallback(body: Record<string, unknown>): string | null {
  const data = body.Data ?? body.data
  const candidates: unknown[] = [
    body.ClientReference,
    body.clientReference,
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>).ClientReference
      : null,
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>).clientReference
      : null,
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return null
}

export type InitiateTenantHubtelInvoiceResult =
  | { ok: true; clientReference: string; checkoutUrl: string; status: "pending" }
  | { ok: false; error: string; statusCode: number }

export async function initiateTenantHubtelInvoicePayment(
  supabase: SupabaseClient,
  input: { invoiceId: string; publicToken: string; payeeName?: string; payeeEmail?: string; payeePhone?: string }
): Promise<InitiateTenantHubtelInvoiceResult> {
  if (!tenantInvoiceOnlinePaymentsEnabled()) {
    return { ok: false, error: "Online invoice payment is not enabled", statusCode: 403 }
  }

  const validated = await validateInvoicePublicToken(supabase, input.invoiceId, input.publicToken)
  if (!validated.ok) {
    return { ok: false, error: validated.error, statusCode: validated.statusCode }
  }
  const invoice = validated.invoice

  if (invoice.status === "paid") {
    return { ok: false, error: "Invoice is already paid", statusCode: 400 }
  }

  const balanceDue = await fetchInvoiceBalanceDuePublic(supabase, invoice.id, Number(invoice.total))
  if (balanceDue <= 0) {
    return { ok: false, error: "No balance remaining on this invoice", statusCode: 400 }
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
    assertProviderAllowed(countryCode, "hubtel")
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Payment not available for this region"
    return { ok: false, error: msg, statusCode: 403 }
  }

  let creds: HubtelCredentials
  try {
    ;({ creds } = await loadHubtelConfigForBusiness(supabase, invoice.business_id))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Hubtel is not configured for this business"
    return { ok: false, error: msg, statusCode: 400 }
  }

  const clientReference = generateHubtelClientReference()
  const amountMinor = Math.round(balanceDue * 100)

  const { error: txnInsErr } = await supabase.from("payment_provider_transactions").insert({
    business_id: invoice.business_id,
    provider_type: PROVIDER_TYPE,
    workspace: WORKSPACE,
    invoice_id: invoice.id,
    sale_id: null,
    payment_id: null,
    reference: clientReference,
    provider_transaction_id: null,
    status: "initiated",
    amount_minor: amountMinor,
    currency: "GHS",
    idempotency_key: clientReference,
    request_payload: {
      invoice_id: invoice.id,
      amount: balanceDue,
      clientReference,
    } as unknown as Record<string, unknown>,
    response_payload: null,
    last_event_payload: null,
    last_event_at: null,
  })

  if (txnInsErr) {
    console.error("[hubtelInvoiceDirect] txn insert", txnInsErr)
    return { ok: false, error: "Could not start payment session", statusCode: 500 }
  }

  try {
    const checkout = await createHubtelCheckout({
      credentials: creds,
      totalAmount: balanceDue,
      description: `Invoice ${invoice.invoice_number}`,
      callbackUrl: hubtelCallbackUrl(),
      returnUrl: hubtelReturnUrl(invoice.id, input.publicToken.trim()),
      cancellationUrl: hubtelCancelUrl(invoice.id, input.publicToken.trim()),
      clientReference,
      payeeName: input.payeeName?.trim() || undefined,
      payeeEmail: input.payeeEmail?.trim() || undefined,
      payeeMobileNumber: input.payeePhone?.trim() || undefined,
    })

    if (!checkout.checkoutUrl) {
      await supabase
        .from("payment_provider_transactions")
        .update({
          status: "failed",
          response_payload: checkout.raw as unknown as Record<string, unknown>,
        })
        .eq("reference", clientReference)
        .eq("provider_type", PROVIDER_TYPE)
      return { ok: false, error: "Hubtel did not return a checkout URL", statusCode: 502 }
    }

    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "pending",
        provider_transaction_id: checkout.checkoutId,
        response_payload: {
          checkoutId: checkout.checkoutId,
          checkoutUrl: checkout.checkoutUrl,
          checkoutDirectUrl: checkout.checkoutDirectUrl,
          hubtelResponse: checkout.raw,
        } as unknown as Record<string, unknown>,
      })
      .eq("reference", clientReference)
      .eq("provider_type", PROVIDER_TYPE)

    return {
      ok: true,
      clientReference,
      checkoutUrl: checkout.checkoutUrl,
      status: "pending",
    }
  } catch (e: unknown) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        response_payload: {
          error: e instanceof Error ? e.message : "Hubtel checkout failed",
        } as unknown as Record<string, unknown>,
      })
      .eq("reference", clientReference)
      .eq("provider_type", PROVIDER_TYPE)

    const msg = e instanceof Error ? e.message : "Hubtel checkout initiation failed"
    return { ok: false, error: msg, statusCode: 502 }
  }
}

async function ensureHubtelInvoicePaymentRow(
  supabase: SupabaseClient,
  txn: {
    id: string
    business_id: string
    invoice_id: string
    reference: string
    amount_minor: number | null
  },
  statusData: NormalizedHubtelStatusResponse
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

  const gross =
    statusData.grossAmount != null && statusData.grossAmount > 0
      ? statusData.grossAmount
      : typeof txn.amount_minor === "number"
        ? txn.amount_minor / 100
        : 0

  if (gross <= 0) {
    throw new Error("Invalid Hubtel payment amount")
  }

  const { error: bootstrapErr } = await ensureAccountingInitializedForServerJob(
    supabase,
    txn.business_id
  )
  if (bootstrapErr) {
    const err = new Error("Accounting bootstrap failed before payment insert")
    ;(err as Error & { bootstrapError?: string; code?: string }).bootstrapError = bootstrapErr
    ;(err as Error & { code?: string }).code = "ACCOUNTING_BOOTSTRAP_FAILED"
    throw err
  }

  const { data: tokenData } = await supabase.rpc("generate_public_token")
  const publicToken =
    (typeof tokenData === "string" && tokenData) ||
    Buffer.from(`${txn.business_id}-${txn.invoice_id}-${Date.now()}`).toString("base64url")

  const metaNote = [
    `Hubtel Online Checkout — Paid`,
    statusData.transactionId ? `tx ${statusData.transactionId}` : null,
    statusData.charges != null ? `fee ${statusData.charges}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const { data: created, error: insErr } = await supabase
    .from("payments")
    .insert({
      business_id: txn.business_id,
      invoice_id: txn.invoice_id,
      amount: gross,
      date: new Date().toISOString().split("T")[0],
      method: "momo",
      reference: txn.reference,
      notes: metaNote,
      public_token: publicToken,
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

  console.error("[hubtelInvoiceDirect] payment insert", insErr)
  throw new Error("Failed to record payment")
}

export type HubtelPublicStatus =
  | "pending"
  | "pending_verification"
  | "paid"
  | "unpaid"
  | "failed"
  | "refunded"
  | "verification_unavailable"
  | "cancelled"

export type VerifyTenantHubtelInvoiceResult =
  | {
      ok: true
      status: HubtelPublicStatus
      applied: boolean
      message?: string
    }
  | { ok: false; error: string; statusCode: number }

export type VerifyTenantHubtelInvoiceOptions = {
  invoiceId?: string | null
  publicToken?: string | null
}

export async function reconcileVerifiedHubtelInvoicePayment(
  supabase: SupabaseClient,
  txn: {
    id: string
    business_id: string
    invoice_id: string
    reference: string
    amount_minor: number | null
    payment_id: string | null
    status: string
  },
  statusData: NormalizedHubtelStatusResponse
): Promise<{ applied: boolean; paymentId: string | null }> {
  if (txn.status === "successful" && txn.payment_id) {
    return { applied: false, paymentId: txn.payment_id }
  }

  const expectedAmount =
    typeof txn.amount_minor === "number" ? txn.amount_minor / 100 : Number(txn.amount_minor ?? 0) / 100

  if (statusData.status !== "Paid") {
    return { applied: false, paymentId: txn.payment_id }
  }

  if (statusData.grossAmount == null || !hubtelAmountsMatch(expectedAmount, statusData.grossAmount)) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        status: "failed",
        last_event_payload: {
          hubtelStatus: statusData.raw,
          verificationError: "amount_mismatch",
        } as unknown as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
    return { applied: false, paymentId: null }
  }

  const autoPost =
    (process.env.HUBTEL_AUTO_POST_VERIFIED_PAYMENTS ?? "true").trim().toLowerCase() !== "false"

  if (!autoPost) {
    return { applied: false, paymentId: txn.payment_id }
  }

  let paymentId = txn.payment_id
  if (!paymentId) {
    try {
      const ensured = await ensureHubtelInvoicePaymentRow(supabase, txn, statusData)
      paymentId = ensured.paymentId
    } catch (e: unknown) {
      const bootstrapFailed =
        e instanceof Error &&
        ((e as Error & { code?: string }).code === "ACCOUNTING_BOOTSTRAP_FAILED" ||
          (e.message && e.message.includes("Accounting bootstrap failed")))
      if (bootstrapFailed) {
        await supabase
          .from("payment_provider_transactions")
          .update({
            status: "pending_accounting_setup",
            last_event_payload: {
              hubtelStatus: statusData.raw,
              accountingBootstrapError:
                (e as Error & { bootstrapError?: string }).bootstrapError ?? e.message,
            } as unknown as Record<string, unknown>,
            last_event_at: new Date().toISOString(),
          })
          .eq("id", txn.id)
          .in("status", [...OPEN_TXN_STATUSES])
        return { applied: false, paymentId: null }
      }
      throw e
    }
  }

  const { data: promoted, error: promoteErr } = await supabase
    .from("payment_provider_transactions")
    .update({
      status: "successful",
      payment_id: paymentId,
      provider_transaction_id: statusData.transactionId ?? txn.reference,
      last_event_payload: {
        hubtelStatus: statusData.raw,
        charges: statusData.charges,
        amountAfterCharges: statusData.amountAfterCharges,
      } as unknown as Record<string, unknown>,
      last_event_at: new Date().toISOString(),
    })
    .eq("id", txn.id)
    .in("status", [...OPEN_TXN_STATUSES, "pending_verification"])
    .select("id")
    .maybeSingle()

  if (promoteErr) {
    console.error("[hubtelInvoiceDirect] promote", promoteErr)
    throw new Error("Update failed")
  }

  if (promoted && txn.invoice_id) {
    await recalculateInvoicePaymentStatus(supabase, txn.invoice_id)
    return { applied: true, paymentId }
  }

  const { data: cur } = await supabase
    .from("payment_provider_transactions")
    .select("status, payment_id")
    .eq("id", txn.id)
    .maybeSingle()

  if (cur?.status === "successful" && txn.invoice_id) {
    await recalculateInvoicePaymentStatus(supabase, txn.invoice_id)
    return { applied: false, paymentId: cur.payment_id ?? paymentId }
  }

  return { applied: false, paymentId }
}

export async function verifyTenantHubtelInvoiceByReference(
  supabase: SupabaseClient,
  clientReference: string,
  options?: VerifyTenantHubtelInvoiceOptions
): Promise<VerifyTenantHubtelInvoiceResult> {
  const reference = clientReference?.trim()
  if (!reference) {
    return { ok: false, error: "clientReference is required", statusCode: 400 }
  }

  if (options?.invoiceId && options?.publicToken) {
    const validated = await validateInvoicePublicToken(supabase, options.invoiceId, options.publicToken)
    if (!validated.ok) {
      return { ok: false, error: validated.error, statusCode: validated.statusCode }
    }
  }

  const { data: txn, error: txnErr } = await supabase
    .from("payment_provider_transactions")
    .select(
      "id, business_id, invoice_id, payment_id, provider_transaction_id, status, amount_minor, reference"
    )
    .eq("provider_type", PROVIDER_TYPE)
    .eq("reference", reference)
    .maybeSingle()

  if (txnErr || !txn) {
    return { ok: false, error: "Payment session not found", statusCode: 404 }
  }

  const boundInvoice = options?.invoiceId?.trim()
  if (boundInvoice && txn.invoice_id !== boundInvoice) {
    return { ok: false, error: "Payment session does not match this invoice", statusCode: 404 }
  }

  if (!txn.invoice_id) {
    return { ok: false, error: "Incomplete payment session", statusCode: 400 }
  }

  if (txn.status === "successful") {
    await recalculateInvoicePaymentStatus(supabase, txn.invoice_id)
    return { ok: true, status: "paid", applied: false, message: "Already confirmed" }
  }

  if (txn.status === "cancelled") {
    return { ok: true, status: "cancelled", applied: false }
  }

  if (txn.status === "failed") {
    return { ok: true, status: "failed", applied: false }
  }

  let creds: HubtelCredentials
  try {
    ;({ creds } = await loadHubtelConfigForBusiness(supabase, txn.business_id))
  } catch {
    return { ok: false, error: "Hubtel configuration unavailable", statusCode: 500 }
  }

  let statusData: NormalizedHubtelStatusResponse
  try {
    statusData = await checkHubtelTransactionStatus({ credentials: creds, clientReference: reference })
  } catch (e: unknown) {
    if (isHubtelStatusCheckUnavailableError(e)) {
      const verificationError = e instanceof Error ? e.message : "Status verification unavailable"
      await supabase
        .from("payment_provider_transactions")
        .update({
          status: "pending_verification",
          last_event_payload: {
            verificationError,
            verificationUnavailable: true,
          } as unknown as Record<string, unknown>,
          last_event_at: new Date().toISOString(),
        })
        .eq("id", txn.id)
        .in("status", [...OPEN_TXN_STATUSES])

      return {
        ok: true,
        status: "verification_unavailable",
        applied: false,
        message: "Your payment is being verified. We will update this invoice once confirmed.",
      }
    }
    return {
      ok: true,
      status: "pending",
      applied: false,
      message: "Could not verify payment status right now",
    }
  }

  if (statusData.status === "Refunded") {
    return { ok: true, status: "refunded", applied: false }
  }

  if (statusData.status === "Unpaid" || statusData.status === "Unknown") {
    return { ok: true, status: statusData.status === "Unpaid" ? "unpaid" : "pending", applied: false }
  }

  if (statusData.status === "Paid") {
    try {
      const { applied } = await reconcileVerifiedHubtelInvoicePayment(supabase, txn, statusData)
      return {
        ok: true,
        status: "paid",
        applied,
        message: applied ? "Payment confirmed" : "Already confirmed",
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Payment recording failed"
      return { ok: false, error: msg, statusCode: 500 }
    }
  }

  return { ok: true, status: "pending", applied: false }
}

export type RecordHubtelCallbackResult = {
  bound: boolean
  duplicate_hint: boolean
  clientReference?: string
  verify?: VerifyTenantHubtelInvoiceResult
}

export async function recordHubtelInvoiceCallbackAndVerify(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<RecordHubtelCallbackResult> {
  const clientReference = extractHubtelClientReferenceFromCallback(body)
  if (!clientReference) {
    return { bound: false, duplicate_hint: false }
  }

  const { data: txn, error: txnErr } = await supabase
    .from("payment_provider_transactions")
    .select("id, status")
    .eq("provider_type", PROVIDER_TYPE)
    .eq("workspace", WORKSPACE)
    .eq("reference", clientReference)
    .maybeSingle()

  if (txnErr || !txn?.id) {
    return { bound: false, duplicate_hint: false }
  }

  const fingerprint = callbackPayloadFingerprint(body)
  const { error: insErr } = await supabase.from("payment_provider_transaction_events").insert({
    payment_provider_transaction_id: txn.id,
    provider_type: PROVIDER_TYPE,
    event_type: HUBTEL_CALLBACK_EVENT,
    external_event_id: null,
    payload: body as unknown as Record<string, unknown>,
    payload_fingerprint: fingerprint,
  })

  const duplicate_hint = !!(insErr && isUniqueViolation(insErr))

  if (insErr && !duplicate_hint) {
    console.error("[hubtelInvoiceDirect] callback event insert", insErr)
  }

  if (!duplicate_hint) {
    await supabase
      .from("payment_provider_transactions")
      .update({
        last_event_payload: body as unknown as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
  }

  const verify = await verifyTenantHubtelInvoiceByReference(supabase, clientReference)

  return {
    bound: true,
    duplicate_hint,
    clientReference,
    verify,
  }
}

export async function cancelHubtelInvoiceSession(
  supabase: SupabaseClient,
  clientReference: string,
  options?: { invoiceId?: string; publicToken?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (options?.invoiceId && options?.publicToken) {
    const validated = await validateInvoicePublicToken(supabase, options.invoiceId, options.publicToken)
    if (!validated.ok) {
      return { ok: false, error: validated.error }
    }
  }

  const { error } = await supabase
    .from("payment_provider_transactions")
    .update({ status: "cancelled", last_event_at: new Date().toISOString() })
    .eq("provider_type", PROVIDER_TYPE)
    .eq("reference", clientReference.trim())
    .in("status", [...OPEN_TXN_STATUSES])

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Whether business has enabled Hubtel checkout for service invoices. */
export async function isHubtelInvoiceCheckoutConfigured(
  supabase: SupabaseClient,
  businessId: string
): Promise<boolean> {
  try {
    const resolved = await resolveTenantProviderConfig(supabase, {
      businessId,
      providerType: PROVIDER_TYPE,
      environment: ENV,
      requireEnabled: true,
    })
    if (resolved.kind !== "hubtel") return false
    hubtelCredentialsFromResolved(resolved)
    return true
  } catch {
    return false
  }
}
