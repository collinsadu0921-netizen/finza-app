/**
 * Canonical reason codes for accounting authority and engagement state.
 * All APIs and /accounting/open MUST use only these constants. No inline strings.
 */

export const NO_ENGAGEMENT = "NO_ENGAGEMENT"
export const ENGAGEMENT_PENDING = "ENGAGEMENT_PENDING"
export const ENGAGEMENT_SUSPENDED = "ENGAGEMENT_SUSPENDED"
export const ENGAGEMENT_TERMINATED = "ENGAGEMENT_TERMINATED"
export const ENGAGEMENT_NOT_EFFECTIVE = "ENGAGEMENT_NOT_EFFECTIVE"
export const CLIENT_REQUIRED = "CLIENT_REQUIRED"
export const ACCOUNTING_NOT_READY = "ACCOUNTING_NOT_READY"
/** Success state: engagement is active and effective */
export const ACTIVE = "ACTIVE"

export const ACCOUNTING_REASON_CODES = {
  NO_ENGAGEMENT,
  ENGAGEMENT_PENDING,
  ENGAGEMENT_SUSPENDED,
  ENGAGEMENT_TERMINATED,
  ENGAGEMENT_NOT_EFFECTIVE,
  CLIENT_REQUIRED,
  ACCOUNTING_NOT_READY,
  ACTIVE,
} as const

export type AccountingReasonCode = (typeof ACCOUNTING_REASON_CODES)[keyof typeof ACCOUNTING_REASON_CODES]
