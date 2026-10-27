/**
 * Service VAT route helpers. Keep business_id when moving between VAT filings
 * and the create screen so figures are never pulled for the wrong business.
 */

function appendBusinessId(path: string, businessId?: string | null): string {
  if (!businessId) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}business_id=${encodeURIComponent(businessId)}`
}

export function vatFilingsHref(businessId?: string | null): string {
  return appendBusinessId("/vat-returns", businessId)
}

export function vatFilingHref(
  filingId: string,
  businessId?: string | null
): string {
  return appendBusinessId(
    `/vat-returns/${encodeURIComponent(filingId)}`,
    businessId
  )
}

export function vatCreateHref(opts: {
  start?: string | null
  end?: string | null
  businessId?: string | null
}): string {
  const params = new URLSearchParams()
  if (opts.start) params.set("start", opts.start)
  if (opts.end) params.set("end", opts.end)
  if (opts.businessId) params.set("business_id", opts.businessId)
  const query = params.toString()
  return query ? `/vat-returns/create?${query}` : "/vat-returns/create"
}
