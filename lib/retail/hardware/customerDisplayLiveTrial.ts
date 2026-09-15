/**
 * Session-only staging trial for live basket/checkout totals on one till.
 * Not persisted, not verification, not a protocol claim.
 */

import type { CustomerDisplaySerialProfile } from "@/lib/retail/hardware/customerDisplayDiagnostic"
import type { CustomerDisplayConnectionStatus } from "@/lib/retail/hardware/customerDisplayProtocol"

export const LIVE_TRIAL_REQUIRED_PROFILE_ID: CustomerDisplaySerialProfile["id"] = "2400"

export const LIVE_TRIAL_UI_WARNING =
  "Staging trial only — not customer-ready. While on, each basket/checkout total change sends one unverified 0C clear then one ASCII amount on this till (same sequence as the per-till clear-then-amount candidate). Off by default; turns off on reload, disconnect, or write failure. Separate from Mark physically verified. Does not enable the verified auto-sale gate."

export type LiveTrialStartGateInput = {
  canUseDiagnostics: boolean
  hasTerminalBinding: boolean
  status: CustomerDisplayConnectionStatus
  profileId: CustomerDisplaySerialProfile["id"]
  connectedBaudRate: number | null
  diagnosticMode: boolean
}

export function canStartCustomerDisplayLiveTrial(input: LiveTrialStartGateInput): {
  ok: boolean
  reason: string | null
} {
  if (!input.canUseDiagnostics) {
    return { ok: false, reason: "Owner/admin only." }
  }
  if (!input.hasTerminalBinding) {
    return { ok: false, reason: "Bind this browser to a register first." }
  }
  if (input.diagnosticMode) {
    return { ok: false, reason: "Exit diagnostic mode before starting the live trial." }
  }
  if (input.status !== "connected") {
    return { ok: false, reason: "Connect the customer display first." }
  }
  if (input.profileId !== LIVE_TRIAL_REQUIRED_PROFILE_ID) {
    return { ok: false, reason: "Select the 2400 baud profile for this till before starting." }
  }
  if (input.connectedBaudRate != null && input.connectedBaudRate !== 2400) {
    return { ok: false, reason: "Reconnect at 2400 baud before starting the live trial." }
  }
  return { ok: true, reason: null }
}

/** Trial must not start from a saved physicallyVerified flag. */
export function liveTrialIgnoresPhysicalVerification(): boolean {
  return true
}
