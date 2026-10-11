import { randomBytes } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { assertPaymentJournalPosted } from "@/lib/payments/assertPaymentJournalPosted"

/**
 * Records a Service invoice Paystack payment only after Paystack reports success.
 * A pending or OTP challenge must not insert `payments`, because that insert posts the ledger.
 * A second success for the same reference returns the existing row.
 */
export async function recordSuccessfulPaystackInvoicePayment(
  supabase: SupabaseClient,
  input: {
    invoiceId: string
    businessId: string
    reference: string
    amount: number
    providerLabel: string
  }
): Promise<
  | { ok: true; paymentId: string; publicToken: string | null; created: boolean }
  | { ok: false; error: string; statusCode: number }
> {
  const reference = input.reference.trim()
  if (!reference || !(input.amount > 0)) {
    return { ok: false, error: "No balance remaining on this invoice", statusCode: 400 }
  }

  const existing = await findPayment(supabase, reference, input.invoiceId, input.businessId)
  if (existing) {
    return { ok: true, paymentId: existing.id, publicToken: existing.public_token ?? null, created: false }
  }

  const { data: tokenData } = await supabase.rpc("generate_public_token")
  const receiptPublicToken =
    (typeof tokenData === "string" && tokenData.trim()) || randomBytes(32).toString("base64url")

  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      business_id: input.businessId,
      invoice_id: input.invoiceId,
      amount: input.amount,
      date: new Date().toISOString().split("T")[0],
      method: "momo",
      reference,
      notes: `Paystack MoMo — ${input.providerLabel} — success`,
      public_token: receiptPublicToken,
    })
    .select("id, public_token")
    .single()

  if (payErr) {
    const raced = await findPayment(supabase, reference, input.invoiceId, input.businessId)
    if (raced) {
      return { ok: true, paymentId: raced.id, publicToken: raced.public_token ?? null, created: false }
    }
    return { ok: false, error: payErr.message || "Failed to record payment", statusCode: 500 }
  }

  const journalAssert = await assertPaymentJournalPosted(supabase, payment.id, input.businessId)
  if (!journalAssert.ok) {
    return { ok: false, error: journalAssert.error, statusCode: 500 }
  }

  return {
    ok: true,
    paymentId: payment.id,
    publicToken: payment.public_token ?? null,
    created: true,
  }
}

async function findPayment(
  supabase: SupabaseClient,
  reference: string,
  invoiceId: string,
  businessId: string
): Promise<{ id: string; public_token: string | null } | null> {
  const { data } = await supabase
    .from("payments")
    .select("id, public_token")
    .eq("reference", reference)
    .eq("invoice_id", invoiceId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!data?.id) return null
  return { id: data.id, public_token: data.public_token ?? null }
}
