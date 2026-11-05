/**
 * Maps accounting-period posting errors to precise API responses.
 *
 * The posting RPCs use two distinct messages:
 *   - "No accounting period found..."  → the requested month has not been provisioned
 *   - "Cannot post to a locked period..." / "Accounting period is locked..." → the
 *     period exists but is locked
 *
 * Do not classify on the generic word "period": that turns a missing-period error
 * into a misleading locked-period response.
 */

export type AccountingPeriodErrorCode = "PERIOD_NOT_FOUND" | "PERIOD_LOCKED"

export type AccountingPeriodErrorMapping = {
  status: 400
  code: AccountingPeriodErrorCode
  error: string
}

export function mapAccountingPeriodError(
  message: string | null | undefined
): AccountingPeriodErrorMapping | null {
  const msg = String(message ?? "")

  if (msg.includes("No accounting period found")) {
    return {
      status: 400,
      code: "PERIOD_NOT_FOUND",
      error:
        "No accounting period exists for this date. Create the accounting period or choose a date within an open period.",
    }
  }

  if (
    msg.includes("Cannot post to a locked period") ||
    msg.includes("Accounting period is locked")
  ) {
    return {
      status: 400,
      code: "PERIOD_LOCKED",
      error: "Cannot post to a locked period. Choose another date.",
    }
  }

  return null
}
