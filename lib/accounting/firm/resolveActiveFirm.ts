/**
 * Resolve Practice active firm from memberships + optional sessionStorage cache.
 * Membership is authoritative; sessionStorage is cache only.
 */

export type FirmMembershipOption = {
  firm_id: string
  firm_name: string
  role: string | null
}

export type ActiveFirmResolveReason =
  | "no_membership"
  | "single_auto"
  | "single_preserved"
  | "single_replaced_invalid"
  | "stored_valid"
  | "multi_needs_selection"
  | "stored_invalid_cleared"

export type ActiveFirmResolution = {
  firmId: string | null
  firmName: string | null
  role: string | null
  firms: FirmMembershipOption[]
  requiresSelection: boolean
  /** Persist via setActiveFirmId when true (including clearing invalid cache). */
  shouldPersist: boolean
  reason: ActiveFirmResolveReason
}

/**
 * Pure resolver — no I/O, no sessionStorage writes.
 */
export function resolveActiveFirmFromMemberships(opts: {
  firms: FirmMembershipOption[]
  storedFirmId: string | null | undefined
}): ActiveFirmResolution {
  const firms = (opts.firms ?? []).filter((f) => Boolean(f?.firm_id))
  const stored = (opts.storedFirmId ?? "").trim() || null

  if (firms.length === 0) {
    return {
      firmId: null,
      firmName: null,
      role: null,
      firms: [],
      requiresSelection: false,
      shouldPersist: Boolean(stored),
      reason: "no_membership",
    }
  }

  if (firms.length === 1) {
    const only = firms[0]
    if (!stored) {
      return {
        firmId: only.firm_id,
        firmName: only.firm_name,
        role: only.role,
        firms,
        requiresSelection: false,
        shouldPersist: true,
        reason: "single_auto",
      }
    }
    if (stored === only.firm_id) {
      return {
        firmId: only.firm_id,
        firmName: only.firm_name,
        role: only.role,
        firms,
        requiresSelection: false,
        shouldPersist: false,
        reason: "single_preserved",
      }
    }
    return {
      firmId: only.firm_id,
      firmName: only.firm_name,
      role: only.role,
      firms,
      requiresSelection: false,
      shouldPersist: true,
      reason: "single_replaced_invalid",
    }
  }

  // Multi-firm: never invent a selection from SQL order.
  if (stored) {
    const match = firms.find((f) => f.firm_id === stored)
    if (match) {
      return {
        firmId: match.firm_id,
        firmName: match.firm_name,
        role: match.role,
        firms,
        requiresSelection: false,
        shouldPersist: false,
        reason: "stored_valid",
      }
    }
    return {
      firmId: null,
      firmName: null,
      role: null,
      firms,
      requiresSelection: true,
      shouldPersist: true,
      reason: "stored_invalid_cleared",
    }
  }

  return {
    firmId: null,
    firmName: null,
    role: null,
    firms,
    requiresSelection: true,
    shouldPersist: false,
    reason: "multi_needs_selection",
  }
}
