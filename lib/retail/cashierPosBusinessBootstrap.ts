/**
 * PIN-only POS uses the browser Supabase anon client without a JWT, so `businesses` rows are
 * often invisible (RLS: `TO authenticated`). PIN login already validated `businessId` server-side.
 * Do not redirect back to the PIN screen when the client-side business row is missing.
 */
export function cashierPosBusinessBootstrap(
  cashierSession: { businessId: string },
  business: {
    id: string
    address_country?: string | null
    default_currency?: string | null
  } | null
): {
  businessId: string
  address_country: string | null
  default_currency: string | null
} {
  if (business) {
    return {
      businessId: business.id,
      address_country: business.address_country ?? null,
      default_currency: business.default_currency ?? null,
    }
  }
  return {
    businessId: cashierSession.businessId,
    address_country: null,
    default_currency: null,
  }
}
