/**
 * Client Context Guard
 * Provides hard guards for client-scoped operations (Wave 5: URL-only; no cookie).
 * Callers must pass explicit clientId (e.g. from URL business_id).
 */

export type ClientContextGuardResult = {
  hasClient: boolean
  clientId: string | null
  redirectTo?: string
}

/**
 * Check if client context is available. Uses only the provided clientId (no cookie/session).
 *
 * @param requireClient - Whether client context is required (default: true)
 * @param redirectTo - Where to redirect if client missing (default: /accounting/firm)
 * @param clientId - Explicit client business id (e.g. from URL searchParams)
 */
export function checkClientContext(
  requireClient: boolean = true,
  redirectTo: string = "/accounting/firm",
  clientId: string | null = null
): ClientContextGuardResult {
  if (!requireClient) {
    return { hasClient: true, clientId: null }
  }
  if (!clientId?.trim()) {
    return { hasClient: false, clientId: null, redirectTo }
  }
  return { hasClient: true, clientId: clientId.trim() }
}

/**
 * Client-side guard hook result
 */
export type UseClientContextResult = {
  hasClient: boolean
  clientId: string | null
  isLoading: boolean
  error: string | null
}

/**
 * React hook for client context. Caller must pass clientId (e.g. from useAccountingBusiness().businessId).
 * No cookie/session read.
 */
export function useClientContext(
  requireClient: boolean = true,
  clientId: string | null = null
): UseClientContextResult {
  const hasClient = !!clientId?.trim()
  if (requireClient && !hasClient) {
    return {
      hasClient: false,
      clientId: null,
      isLoading: false,
      error: "No client selected. Please select a client to continue.",
    }
  }
  return {
    hasClient: true,
    clientId: clientId?.trim() ?? null,
    isLoading: false,
    error: null,
  }
}
