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

export type CustomerDisplayTerminalConfig = {
  profileId: CustomerDisplaySerialProfile["id"]
  /** True only after an admin marks successful physical verification on this till. */
  physicallyVerified: boolean
  verifiedAt: string | null
  /** Short note of what was verified (e.g. "2400 baud ASCII amounts"). */
  verifiedNote: string | null
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
    updatedAt: new Date(0).toISOString(),
  }
}

function isProfileId(value: unknown): value is CustomerDisplaySerialProfile["id"] {
  return value === "2400" || value === "4800" || value === "9600" || value === "19200"
}

export function parseCustomerDisplayTerminalConfig(
  raw: unknown
): CustomerDisplayTerminalConfig | null {
  if (!raw || typeof raw !== "object") return null
  const v = raw as Record<string, unknown>
  if (!isProfileId(v.profileId)) return null
  return {
    profileId: v.profileId,
    physicallyVerified: v.physicallyVerified === true,
    verifiedAt: typeof v.verifiedAt === "string" ? v.verifiedAt : null,
    verifiedNote: typeof v.verifiedNote === "string" ? v.verifiedNote : null,
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
