/**
 * Firm Client Session — Wave 13: Cookie/session client context removed.
 * Accounting context is URL-only (resolveAccountingContext). This file remains only
 * so that firmSession.clearActiveClient() can be called on firm change (no-op).
 */

/** No-op: client context is URL-only; nothing to clear. */
export function clearActiveClient(): void {
  // Wave 13: No session/cookie client; no-op.
}
