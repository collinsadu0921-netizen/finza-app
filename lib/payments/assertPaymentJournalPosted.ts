import type { SupabaseClient } from "@supabase/supabase-js"

export type PaymentJournalAssertResult =
  | { ok: true; journalEntryId: string }
  | { ok: false; error: string; rolledBack: boolean }

const LEDGER_POSTING_USER_MESSAGE =
  "Payment could not be posted to the ledger. The payment was not recorded. " +
  "Check that the accounting period for this payment date is open and that cash, bank, and accounts receivable are set up."

/**
 * After a successful payments INSERT, confirm a payment journal exists.
 * If missing (legacy silent-trigger orphans), soft-delete the payment so invoice
 * status can be recalculated and return a user-visible error.
 */
export async function assertPaymentJournalPosted(
  supabase: SupabaseClient,
  paymentId: string,
  businessId: string
): Promise<PaymentJournalAssertResult> {
  const { data: journal, error: journalError } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("business_id", businessId)
    .eq("reference_type", "payment")
    .eq("reference_id", paymentId)
    .maybeSingle()

  if (journalError) {
    console.error("[assertPaymentJournalPosted] journal lookup failed:", journalError)
    return { ok: false, error: LEDGER_POSTING_USER_MESSAGE, rolledBack: false }
  }

  if (journal?.id) {
    return { ok: true, journalEntryId: journal.id }
  }

  console.error(
    "[assertPaymentJournalPosted] payment insert without journal — rolling back payment row",
    { paymentId, businessId }
  )

  const deletedAt = new Date().toISOString()
  const { error: rollbackError } = await supabase
    .from("payments")
    .update({ deleted_at: deletedAt })
    .eq("id", paymentId)
    .eq("business_id", businessId)

  if (rollbackError) {
    console.error("[assertPaymentJournalPosted] rollback failed:", rollbackError)
    return {
      ok: false,
      error:
        "Payment was saved but ledger posting did not complete. Please contact support before recording another payment for this invoice.",
      rolledBack: false,
    }
  }

  return { ok: false, error: LEDGER_POSTING_USER_MESSAGE, rolledBack: true }
}
