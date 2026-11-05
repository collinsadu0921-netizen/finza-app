import type { SupabaseClient } from "@supabase/supabase-js"

export type LoanRepaymentAccountingPeriod = {
  id: string
  period_start: string
  period_end: string
  status: string
}

export type EnsureLoanRepaymentPeriodResult =
  | {
      ok: true
      period: LoanRepaymentAccountingPeriod | null
      created: boolean
      /** True when the caller is not the business owner, so provisioning is deferred to the posting RPC. */
      skipped: boolean
    }
  | {
      ok: false
      status: number
      code: string
      message: string
    }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

async function findPeriod(
  supabase: SupabaseClient,
  businessId: string,
  entryDate: string
) {
  return supabase
    .from("accounting_periods")
    .select("id, period_start, period_end, status")
    .eq("business_id", businessId)
    .lte("period_start", entryDate)
    .gte("period_end", entryDate)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle()
}

/**
 * Resolves the monthly accounting period for a loan repayment date, creating a
 * missing period with the existing `ensure_accounting_period` RPC.
 *
 * The RPC preserves the existing accounting rules:
 *   - existing locked periods are returned untouched and still reject posting
 *   - existing open/soft-closed periods are returned untouched
 *   - only a genuinely missing monthly period is created as `open`
 *
 * Provisioning is attempted only for the business owner because the service
 * intent posting RPC itself is owner-only. Non-owners fall through to the RPC so
 * its existing authorization error is preserved.
 */
export async function ensureLoanRepaymentAccountingPeriod(
  supabase: SupabaseClient,
  input: { businessId: string; userId: string; entryDate: string }
): Promise<EnsureLoanRepaymentPeriodResult> {
  const { businessId, userId, entryDate } = input

  if (!ISO_DATE.test(entryDate)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_ENTRY_DATE",
      message: "The repayment date must be YYYY-MM-DD.",
    }
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle()

  if (businessError) {
    return {
      ok: false,
      status: 500,
      code: "BUSINESS_LOOKUP_FAILED",
      message: "Unable to verify the business before creating the accounting period.",
    }
  }

  if (!business || business.owner_id !== userId) {
    return { ok: true, period: null, created: false, skipped: true }
  }

  const existing = await findPeriod(supabase, businessId, entryDate)
  if (existing.error) {
    return {
      ok: false,
      status: 500,
      code: "PERIOD_LOOKUP_FAILED",
      message: "Unable to check the accounting period for this repayment.",
    }
  }
  if (existing.data) {
    return {
      ok: true,
      period: existing.data as LoanRepaymentAccountingPeriod,
      created: false,
      skipped: false,
    }
  }

  // `ensure_accounting_period` is the existing monthly-period provisioning
  // mechanism used by the accounting reports. It creates only missing months as
  // 'open' and never reopens or changes an existing period.
  let lastError: { code?: string; message?: string } | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error: ensureError } = await supabase.rpc("ensure_accounting_period", {
      p_business_id: businessId,
      p_date: entryDate,
    })

    if (!ensureError) {
      lastError = null
      break
    }

    lastError = ensureError
    // A concurrent request may have created the same month first. The unique
    // (business_id, period_start) key makes that safe; re-read the winner.
    if (ensureError.code !== "23505") break
  }

  const provisioned = await findPeriod(supabase, businessId, entryDate)
  if (provisioned.error || !provisioned.data) {
    if (lastError?.code === "42501") {
      return {
        ok: false,
        status: 403,
        code: "PERIOD_CREATE_FORBIDDEN",
        message:
          "You do not have permission to create the accounting period for this repayment.",
      }
    }
    return {
      ok: false,
      status: 500,
      code: "PERIOD_CREATE_FAILED",
      message:
        "The accounting period for this repayment could not be created. Create it in Accounting → Periods and try again.",
    }
  }

  return {
    ok: true,
    period: provisioned.data as LoanRepaymentAccountingPeriod,
    created: true,
    skipped: false,
  }
}
