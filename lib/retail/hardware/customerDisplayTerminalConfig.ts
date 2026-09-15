/**
 * Per-physical-terminal customer display configuration (browser localStorage).
 * Never Retail-wide: COM port stays Chrome-selected; baud/profile is per till binding.
 *
 * Keyed by business + store + register (same till identity as terminal register binding).
 * A profile must be explicitly marked physicallyVerified before automatic sale writes run.
 */

import {
  CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID,
  getCustomerDisplaySerialProfile,
  type CustomerDisplaySerialProfile,
} from "@/lib/retail/hardware/customerDisplayDiagnostic"

export const CUSTOMER_DISPLAY_TERMINAL_CONFIG_KEY_PREFIX =
  "finza.retail.customerDisplay.terminalConfig"

/**
 * How automatic sale amounts are written after this till is physically verified.
 * - ascii_only: one ASCII amount write (legacy default; no clear)
 * - clear_then_amount: one 0C then one ASCII amount (staging candidate matching this till’s live trial)
 */
export type CustomerDisplayAmountWriteMode = "ascii_only" | "clear_then_amount"

export const CLEAR_THEN_AMOUNT_REQUIRED_PROFILE_ID: CustomerDisplaySerialProfile["id"] = "2400"

export const CLEAR_THEN_AMOUNT_CANDIDATE_WARNING =
  "Staging candidate for this till only. After verification, automatic totals would send one 0C clear then one ASCII amount at the selected 2400 profile — matching the live trial that worked on this Windows 7 till. Other tills keep plain ASCII unless they select this candidate themselves. Not customer-ready; does not mark verified."

export type CustomerDisplayTerminalConfig = {
  profileId: CustomerDisplaySerialProfile["id"]
  /** True only after an admin marks successful physical verification on this till. */
  physicallyVerified: boolean
  verifiedAt: string | null
  /** Short note of what was verified (e.g. "2400 baud ASCII amounts"). */
  verifiedNote: string | null
  /**
   * Candidate / post-verify amount write sequence for this till.
   * Defaults to ascii_only. clear_then_amount is only effective with profile 2400.
   */
  amountWriteMode: CustomerDisplayAmountWriteMode
  updatedAt: string
}

export type CustomerDisplayTerminalIdentity = {
  businessId: string
  storeId: string
  registerId: string
}

export function customerDisplayTerminalConfigKey(
  identity: CustomerDisplayTerminalIdentity
): string {
  return `${CUSTOMER_DISPLAY_TERMINAL_CONFIG_KEY_PREFIX}:${identity.businessId}:${identity.storeId}:${identity.registerId}`
}

export function defaultCustomerDisplayTerminalConfig(): CustomerDisplayTerminalConfig {
  return {
    profileId: CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID,
    physicallyVerified: false,
    verifiedAt: null,
    verifiedNote: null,
    amountWriteMode: "ascii_only",
    updatedAt: new Date(0).toISOString(),
  }
}

function isProfileId(value: unknown): value is CustomerDisplaySerialProfile["id"] {
  return value === "2400" || value === "4800" || value === "9600" || value === "19200"
}

function isAmountWriteMode(value: unknown): value is CustomerDisplayAmountWriteMode {
  return value === "ascii_only" || value === "clear_then_amount"
}

export function parseCustomerDisplayTerminalConfig(
  raw: unknown
): CustomerDisplayTerminalConfig | null {
  if (!raw || typeof raw !== "object") return null
  const v = raw as Record<string, unknown>
  if (!isProfileId(v.profileId)) return null
  const amountWriteMode = isAmountWriteMode(v.amountWriteMode) ? v.amountWriteMode : "ascii_only"
  return {
    profileId: v.profileId,
    physicallyVerified: v.physicallyVerified === true,
    verifiedAt: typeof v.verifiedAt === "string" ? v.verifiedAt : null,
    verifiedNote: typeof v.verifiedNote === "string" ? v.verifiedNote : null,
    amountWriteMode,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
  }
}

export function readCustomerDisplayTerminalConfig(
  identity: CustomerDisplayTerminalIdentity | null | undefined,
  storage?: Pick<Storage, "getItem"> | null
): CustomerDisplayTerminalConfig | null {
  if (!identity?.businessId || !identity.storeId || !identity.registerId) return null
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null)
  if (!store) return null
  try {
    const raw = store.getItem(customerDisplayTerminalConfigKey(identity))
    if (!raw) return null
    return parseCustomerDisplayTerminalConfig(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function writeCustomerDisplayTerminalConfig(
  identity: CustomerDisplayTerminalIdentity | null | undefined,
  config: CustomerDisplayTerminalConfig,
  storage?: Pick<Storage, "setItem"> | null
): boolean {
  if (!identity?.businessId || !identity.storeId || !identity.registerId) return false
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null)
  if (!store) return false
  try {
    store.setItem(customerDisplayTerminalConfigKey(identity), JSON.stringify(config))
    return true
  } catch {
    return false
  }
}

/** Candidate baud may be saved; automatic sale writes require physical verification. */
export function shouldAllowAutomaticCustomerDisplayUpdates(
  config: CustomerDisplayTerminalConfig | null | undefined
): boolean {
  return config?.physicallyVerified === true
}

/**
 * Effective write mode for this till. clear_then_amount only applies with the 2400 profile.
 * Missing/legacy configs resolve to ascii_only.
 */
export function resolveCustomerDisplayAmountWriteMode(
  config: CustomerDisplayTerminalConfig | null | undefined
): CustomerDisplayAmountWriteMode {
  if (
    config?.amountWriteMode === "clear_then_amount" &&
    config.profileId === CLEAR_THEN_AMOUNT_REQUIRED_PROFILE_ID
  ) {
    return "clear_then_amount"
  }
  return "ascii_only"
}

export function canSelectClearThenAmountWriteMode(
  profileId: CustomerDisplaySerialProfile["id"]
): boolean {
  return profileId === CLEAR_THEN_AMOUNT_REQUIRED_PROFILE_ID
}

export function resolveConnectSerialProfile(
  config: CustomerDisplayTerminalConfig | null | undefined,
  opts?: { diagnosticMode?: boolean; diagnosticProfileId?: CustomerDisplaySerialProfile["id"] }
): CustomerDisplaySerialProfile | null {
  if (opts?.diagnosticMode && opts.diagnosticProfileId) {
    return getCustomerDisplaySerialProfile(opts.diagnosticProfileId)
  }
  if (config?.profileId) {
    return getCustomerDisplaySerialProfile(config.profileId)
  }
  return null
}

export function configsAreIsolatedByTerminal(
  a: CustomerDisplayTerminalIdentity,
  b: CustomerDisplayTerminalIdentity
): boolean {
  return customerDisplayTerminalConfigKey(a) !== customerDisplayTerminalConfigKey(b)
}

export function formatVerifiedDisplayNote(
  profileId: CustomerDisplaySerialProfile["id"],
  amountWriteMode: CustomerDisplayAmountWriteMode
): string {
  const baud = getCustomerDisplaySerialProfile(profileId).baudRate
  const mode =
    resolveCustomerDisplayAmountWriteMode({
      profileId,
      physicallyVerified: false,
      verifiedAt: null,
      verifiedNote: null,
      amountWriteMode,
      updatedAt: new Date(0).toISOString(),
    }) === "clear_then_amount"
      ? "clear(0C) then ASCII amounts"
      : "plain ASCII amounts"
  return `${baud} baud · 8N1 · ${mode} (this till only)`
}
