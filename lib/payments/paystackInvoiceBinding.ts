/**
 * Binds a Paystack success payload to the invoice that was authorized.
 * A caller who knows one invoice token must not settle a different Paystack charge.
 */

export type PaystackChargeData = {
  status?: string
  reference?: string
  amount?: number
  metadata?: { invoice_id?: string; business_id?: string } | null
}

export type PaystackBindingResult = { ok: true } | { ok: false; error: string; statusCode: number }

export function assessPaystackInvoiceSettlement(input: {
  data: PaystackChargeData | null | undefined
  requestedReference: string
  invoiceId: string
  businessId: string
  expectedAmount: number
  /**
   * True only for the charge request that created this reference.
   * Verify and OTP are not same-request initiations: the caller supplies the reference.
   */
  sameRequestInitiation?: boolean
}): PaystackBindingResult {
  const data = input.data
  const requested = input.requestedReference.trim()
  const echoed = typeof data?.reference === "string" ? data.reference.trim() : ""
  if (echoed && echoed !== requested) {
    return { ok: false, error: "Paystack reference does not match this payment", statusCode: 409 }
  }

  const metadataInvoice = data?.metadata?.invoice_id?.trim() || ""
  const metadataBusiness = data?.metadata?.business_id?.trim() || ""
  if (metadataInvoice && metadataInvoice !== input.invoiceId) {
    return { ok: false, error: "Paystack charge belongs to a different invoice", statusCode: 409 }
  }
  if (metadataBusiness && metadataBusiness !== input.businessId) {
    return { ok: false, error: "Paystack charge belongs to a different business", statusCode: 409 }
  }

  if (!input.sameRequestInitiation && !metadataInvoice) {
    return {
      ok: false,
      error: "Paystack charge is not bound to this invoice",
      statusCode: 409,
    }
  }

  if (typeof data?.amount === "number") {
    const verifiedAmount = data.amount / 100
    if (Math.abs(verifiedAmount - input.expectedAmount) > 0.01) {
      return { ok: false, error: "Verified amount does not match the invoice balance", statusCode: 409 }
    }
  } else if (!input.sameRequestInitiation) {
    return { ok: false, error: "Paystack did not return a verified amount", statusCode: 409 }
  }

  return { ok: true }
}
