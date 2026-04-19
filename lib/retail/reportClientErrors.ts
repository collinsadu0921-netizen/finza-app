/**
 * User-visible messages for failed fetches to `/api/retail/reports/*`.
 * Keeps retail pages free of accounting-specific error codes in copy.
 */
export function retailLedgerReportErrorMessage(
  status: number,
  body: Record<string, unknown>
): string {
  const code = body.error
  if (code === "RETAIL_BOOKS_NOT_READY" || code === "ACCOUNTING_NOT_READY") {
    if (typeof body.message === "string" && body.message.trim() !== "") {
      return body.message
    }
    return "Your store’s books are not ready yet. Complete setup or record some sales, then try again."
  }
  if (typeof code === "string" && code.trim() !== "") {
    return code
  }
  if (status === 401) {
    return "Sign in to view this report."
  }
  if (status === 404) {
    return "No store was found for your account."
  }
  return "Could not load this report. Try again in a moment."
}
