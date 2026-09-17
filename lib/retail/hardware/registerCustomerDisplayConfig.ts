/**
 * Server-side per-register customer display configuration (Retail).
 * COM ports are never stored — only serial profile + write protocol + verification.
 * Unconfigured registers have null baud/protocol; no universal 2400/0C default.
 */

import {
  getCustomerDisplaySerialProfile,
  type CustomerDisplaySerialProfile,
} from "@/lib/retail/hardware/customerDisplayDiagnostic"
import type { CustomerDisplayAmountWriteMode } from "@/lib/retail/hardware/customerDisplayTerminalConfig"
import {
  canSelectClearThenAmountWriteMode,
  resolveCustomerDisplayAmountWriteMode,
} from "@/lib/retail/hardware/customerDisplayTerminalConfig"

export type RegisterCustomerDisplayProfileId = CustomerDisplaySerialProfile["id"]

export type RegisterCustomerDisplayRow = {
  id: string
  business_id: string | null
  store_id: string | null
  customer_display_enabled?: boolean | null
  customer_display_profile_id?: string | null
  customer_display_baud_rate?: number | null
  customer_display_data_bits?: number | null
  customer_display_stop_bits?: number | null
  customer_display_parity?: string | null
  customer_display_flow_control?: string | null
  customer_display_amount_write_mode?: string | null
  customer_display_physically_verified?: boolean | null
  customer_display_verified_at?: string | null
  customer_display_verified_by?: string | null
  customer_display_verified_note?: string | null
  customer_display_config_version?: number | null
  customer_display_updated_at?: string | null
}

export type RegisterCustomerDisplayConfig = {
  registerId: string
  businessId: string
  storeId: string | null
  enabled: boolean
  configured: boolean
  profileId: RegisterCustomerDisplayProfileId | null
  baudRate: number | null
  dataBits: 7 | 8 | null
  stopBits: 1 | 2 | null
  parity: "none" | "even" | "odd" | null
  flowControl: "none" | "hardware" | null
  amountWriteMode: CustomerDisplayAmountWriteMode | null
  physicallyVerified: boolean
  verifiedAt: string | null
  verifiedBy: string | null
  verifiedNote: string | null
  configVersion: number
  updatedAt: string | null
}

/** Safe fields cashiers need to open the local serial port after verification. */
export type CashierRegisterCustomerDisplayView = {
  registerId: string
  setupStatus: "not_configured" | "unverified" | "ready"
  message: string | null
  /** Present only when setupStatus === "ready". */
  connectProfile: {
    profileId: RegisterCustomerDisplayProfileId
    baudRate: number
    dataBits: 7 | 8
    stopBits: 1 | 2
    parity: "none" | "even" | "odd"
    flowControl: "none" | "hardware"
    amountWriteMode: CustomerDisplayAmountWriteMode
  } | null
}

export const REGISTER_CUSTOMER_DISPLAY_SELECT =
  "id, business_id, store_id, customer_display_enabled, customer_display_profile_id, customer_display_baud_rate, customer_display_data_bits, customer_display_stop_bits, customer_display_parity, customer_display_flow_control, customer_display_amount_write_mode, customer_display_physically_verified, customer_display_verified_at, customer_display_verified_by, customer_display_verified_note, customer_display_config_version, customer_display_updated_at"

const OWNER_SETUP_REQUIRED =
  "Customer display requires owner/admin setup. Sales can continue without it."

function isProfileId(value: unknown): value is RegisterCustomerDisplayProfileId {
  return value === "2400" || value === "4800" || value === "9600" || value === "19200"
}

function isAmountWriteMode(value: unknown): value is CustomerDisplayAmountWriteMode {
  return value === "ascii_only" || value === "clear_then_amount"
}

function isParity(value: unknown): value is "none" | "even" | "odd" {
  return value === "none" || value === "even" || value === "odd"
}

function isFlowControl(value: unknown): value is "none" | "hardware" {
  return value === "none" || value === "hardware"
}

export function isRegisterCustomerDisplayConfigured(
  config: Pick<
    RegisterCustomerDisplayConfig,
    "profileId" | "baudRate" | "dataBits" | "stopBits" | "parity" | "flowControl" | "amountWriteMode"
  >
): boolean {
  return (
    config.profileId != null &&
    config.baudRate != null &&
    config.dataBits != null &&
    config.stopBits != null &&
    config.parity != null &&
    config.flowControl != null &&
    config.amountWriteMode != null
  )
}

export function mapRegisterRowToCustomerDisplayConfig(
  row: RegisterCustomerDisplayRow
): RegisterCustomerDisplayConfig {
  const profileId = isProfileId(row.customer_display_profile_id)
    ? row.customer_display_profile_id
    : null
  const amountWriteMode = isAmountWriteMode(row.customer_display_amount_write_mode)
    ? row.customer_display_amount_write_mode
    : null
  const dataBits =
    row.customer_display_data_bits === 7 || row.customer_display_data_bits === 8
      ? row.customer_display_data_bits
      : null
  const stopBits =
    row.customer_display_stop_bits === 1 || row.customer_display_stop_bits === 2
      ? row.customer_display_stop_bits
      : null
  const parity = isParity(row.customer_display_parity) ? row.customer_display_parity : null
  const flowControl = isFlowControl(row.customer_display_flow_control)
    ? row.customer_display_flow_control
    : null
  const baudRate =
    typeof row.customer_display_baud_rate === "number" ? row.customer_display_baud_rate : null

  const config: RegisterCustomerDisplayConfig = {
    registerId: row.id,
    businessId: row.business_id ?? "",
    storeId: row.store_id,
    enabled: row.customer_display_enabled === true,
    configured: false,
    profileId,
    baudRate,
    dataBits,
    stopBits,
    parity,
    flowControl,
    amountWriteMode,
    physicallyVerified: row.customer_display_physically_verified === true,
    verifiedAt: typeof row.customer_display_verified_at === "string" ? row.customer_display_verified_at : null,
    verifiedBy: typeof row.customer_display_verified_by === "string" ? row.customer_display_verified_by : null,
    verifiedNote:
      typeof row.customer_display_verified_note === "string" ? row.customer_display_verified_note : null,
    configVersion:
      typeof row.customer_display_config_version === "number" ? row.customer_display_config_version : 0,
    updatedAt:
      typeof row.customer_display_updated_at === "string" ? row.customer_display_updated_at : null,
  }
  config.configured = isRegisterCustomerDisplayConfigured(config)
  return config
}

export function toCashierCustomerDisplayView(
  config: RegisterCustomerDisplayConfig
): CashierRegisterCustomerDisplayView {
  if (!config.configured || !config.enabled) {
    return {
      registerId: config.registerId,
      setupStatus: "not_configured",
      message: OWNER_SETUP_REQUIRED,
      connectProfile: null,
    }
  }
  if (!config.physicallyVerified) {
    return {
      registerId: config.registerId,
      setupStatus: "unverified",
      message: OWNER_SETUP_REQUIRED,
      connectProfile: null,
    }
  }
  if (
    !config.profileId ||
    config.baudRate == null ||
    config.dataBits == null ||
    config.stopBits == null ||
    !config.parity ||
    !config.flowControl ||
    !config.amountWriteMode
  ) {
    return {
      registerId: config.registerId,
      setupStatus: "not_configured",
      message: OWNER_SETUP_REQUIRED,
      connectProfile: null,
    }
  }
  return {
    registerId: config.registerId,
    setupStatus: "ready",
    message: null,
    connectProfile: {
      profileId: config.profileId,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      stopBits: config.stopBits,
      parity: config.parity,
      flowControl: config.flowControl,
      amountWriteMode: resolveCustomerDisplayAmountWriteMode({
        profileId: config.profileId,
        physicallyVerified: true,
        verifiedAt: config.verifiedAt,
        verifiedNote: config.verifiedNote,
        amountWriteMode: config.amountWriteMode,
        updatedAt: config.updatedAt ?? new Date(0).toISOString(),
      }),
    },
  }
}

export function shouldAllowAutomaticUpdatesFromRegisterConfig(
  config: RegisterCustomerDisplayConfig | null | undefined
): boolean {
  if (!config) return false
  const view = toCashierCustomerDisplayView(config)
  return view.setupStatus === "ready"
}

/**
 * Cashier PIN sessions receive the read-safe `view` only (no full `config`).
 * Automatic basket writes must key off that verified connect profile — not an
 * owner-only local/serverConfig latch that cashiers never receive.
 */
export function shouldAllowAutomaticUpdatesFromServerSources(opts: {
  serverConfig: RegisterCustomerDisplayConfig | null | undefined
  serverView: CashierRegisterCustomerDisplayView | null | undefined
}): boolean {
  if (
    opts.serverView?.setupStatus === "ready" &&
    opts.serverView.connectProfile != null &&
    opts.serverView.connectProfile.amountWriteMode != null
  ) {
    return true
  }
  return shouldAllowAutomaticUpdatesFromRegisterConfig(opts.serverConfig)
}

export function resolveAmountWriteModeFromServerSources(opts: {
  serverConfig: RegisterCustomerDisplayConfig | null | undefined
  serverView: CashierRegisterCustomerDisplayView | null | undefined
  fallbackProfileId: RegisterCustomerDisplayProfileId
  fallbackMode: CustomerDisplayAmountWriteMode
}): CustomerDisplayAmountWriteMode {
  if (opts.serverView?.setupStatus === "ready" && opts.serverView.connectProfile) {
    return opts.serverView.connectProfile.amountWriteMode
  }
  if (opts.serverConfig?.amountWriteMode && opts.serverConfig.profileId) {
    return resolveCustomerDisplayAmountWriteMode({
      profileId: opts.serverConfig.profileId,
      physicallyVerified: opts.serverConfig.physicallyVerified,
      verifiedAt: opts.serverConfig.verifiedAt,
      verifiedNote: opts.serverConfig.verifiedNote,
      amountWriteMode: opts.serverConfig.amountWriteMode,
      updatedAt: opts.serverConfig.updatedAt ?? new Date(0).toISOString(),
    })
  }
  return resolveCustomerDisplayAmountWriteMode({
    profileId: opts.fallbackProfileId,
    physicallyVerified: false,
    verifiedAt: null,
    verifiedNote: null,
    amountWriteMode: opts.fallbackMode,
    updatedAt: new Date(0).toISOString(),
  })
}

export function serialProfileFromRegisterConfig(
  config: RegisterCustomerDisplayConfig | CashierRegisterCustomerDisplayView["connectProfile"]
): CustomerDisplaySerialProfile | null {
  if (!config) return null
  if ("connectProfile" in (config as object)) return null
  const profileId =
    "profileId" in config && isProfileId(config.profileId) ? config.profileId : null
  if (!profileId) return null
  const known = getCustomerDisplaySerialProfile(profileId)
  if ("baudRate" in config && typeof config.baudRate === "number" && config.baudRate !== known.baudRate) {
    // Server row must match a known selectable profile — never invent baud.
    return null
  }
  return known
}

export type RegisterCustomerDisplayWriteInput = {
  profileId: RegisterCustomerDisplayProfileId
  amountWriteMode: CustomerDisplayAmountWriteMode
  /** Mark physically verified after owner confirmation. Requires configured profile. */
  markVerified?: boolean
  verifiedNote?: string | null
  /** Explicit clear of verification (also happens automatically on profile/protocol change). */
  clearVerification?: boolean
  enabled?: boolean
}

/**
 * Build DB patch. Changing baud/profile/protocol clears verification and disables auto totals.
 * Does not invent defaults for missing fields.
 */
export function buildRegisterCustomerDisplayWritePatch(
  current: RegisterCustomerDisplayConfig,
  input: RegisterCustomerDisplayWriteInput,
  actorUserId: string,
  nowIso: string
): { ok: true; patch: Record<string, unknown>; clearsVerification: boolean } | { ok: false; error: string } {
  if (!isProfileId(input.profileId)) {
    return { ok: false, error: "Invalid serial profile." }
  }
  if (!isAmountWriteMode(input.amountWriteMode)) {
    return { ok: false, error: "Invalid amount write mode." }
  }
  if (
    input.amountWriteMode === "clear_then_amount" &&
    !canSelectClearThenAmountWriteMode(input.profileId)
  ) {
    return {
      ok: false,
      error: "clear_then_amount is only allowed with the 2400 profile on tills that choose it.",
    }
  }

  const profile = getCustomerDisplaySerialProfile(input.profileId)
  const commChanged =
    current.profileId !== input.profileId ||
    current.amountWriteMode !== input.amountWriteMode ||
    current.baudRate !== profile.baudRate

  let physicallyVerified = current.physicallyVerified
  let verifiedAt = current.verifiedAt
  let verifiedBy = current.verifiedBy
  let verifiedNote = current.verifiedNote

  // Any communication/protocol change clears physical verification (fail-closed).
  if (commChanged || input.clearVerification === true) {
    physicallyVerified = false
    verifiedAt = null
    verifiedBy = null
    verifiedNote = null
  }

  // Same request may save profile and mark verified (explicit owner confirmation / import).
  if (input.markVerified === true) {
    physicallyVerified = true
    verifiedAt = nowIso
    verifiedBy = actorUserId
    verifiedNote =
      typeof input.verifiedNote === "string" && input.verifiedNote.trim()
        ? input.verifiedNote.trim()
        : `${profile.baudRate} baud · 8N1 · ${
            input.amountWriteMode === "clear_then_amount"
              ? "clear(0C) then ASCII"
              : "plain ASCII"
          } (this register only)`
  }

  const enabled = input.enabled === false ? false : true

  const patch: Record<string, unknown> = {
    customer_display_enabled: enabled,
    customer_display_profile_id: profile.id,
    customer_display_baud_rate: profile.baudRate,
    customer_display_data_bits: profile.dataBits,
    customer_display_stop_bits: profile.stopBits,
    customer_display_parity: profile.parity,
    customer_display_flow_control: profile.flowControl,
    customer_display_amount_write_mode: input.amountWriteMode,
    customer_display_physically_verified: physicallyVerified,
    customer_display_verified_at: verifiedAt,
    customer_display_verified_by: verifiedBy,
    customer_display_verified_note: verifiedNote,
    customer_display_config_version: (current.configVersion || 0) + 1,
    customer_display_updated_at: nowIso,
  }

  return {
    ok: true,
    patch,
    clearsVerification:
      (commChanged || input.clearVerification === true) && input.markVerified !== true,
  }
}

/**
 * Explicit owner confirmation of a browser-local verified profile.
 * Never auto-upload: caller must pass confirmLocalImport: true with the local values.
 */
export function buildConfirmLocalImportPatch(
  current: RegisterCustomerDisplayConfig,
  local: {
    profileId: RegisterCustomerDisplayProfileId
    amountWriteMode: CustomerDisplayAmountWriteMode
    verifiedNote?: string | null
  },
  actorUserId: string,
  nowIso: string,
  confirmLocalImport: boolean
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (!confirmLocalImport) {
    return {
      ok: false,
      error: "Local browser configuration is not uploaded unless an owner/admin confirms.",
    }
  }
  return buildRegisterCustomerDisplayWritePatch(
    current,
    {
      profileId: local.profileId,
      amountWriteMode: local.amountWriteMode,
      markVerified: true,
      verifiedNote:
        local.verifiedNote ||
        "Confirmed from this till’s previously verified browser profile (staging migration).",
      enabled: true,
    },
    actorUserId,
    nowIso
  )
}

export function assertNoComPortInConfigPayload(body: Record<string, unknown>): string | null {
  const banned = ["comPort", "com_port", "portName", "port_name", "serialPort", "serial_port", "path"]
  for (const key of banned) {
    if (key in body && body[key] != null && String(body[key]).trim() !== "") {
      return "COM/port names must not be stored. Chrome keeps serial permission on this computer."
    }
  }
  return null
}

export function cashierStatusLabelFromState(opts: {
  setupStatus: CashierRegisterCustomerDisplayView["setupStatus"] | "loading" | "error_load"
  connectionStatus: "disconnected" | "connected" | "error"
}): string {
  if (opts.setupStatus === "loading") return "Customer display: …"
  if (opts.setupStatus === "not_configured" || opts.setupStatus === "unverified") {
    return "Customer display: Not configured"
  }
  if (opts.setupStatus === "error_load") return "Customer display: Error"
  if (opts.connectionStatus === "connected") return "Customer display: Connected"
  if (opts.connectionStatus === "error") return "Customer display: Error"
  if (opts.connectionStatus === "disconnected") return "Customer display: Disconnected"
  return "Customer display: Ready to connect"
}

/**
 * Serial session lifecycle for the physical till.
 * Role changes (owner/admin ↔ cashier) must RETAIN the open port.
 * Only a bound-register identity change closes the shared session.
 */
export function shouldCloseCustomerDisplayOnLifecycleChange(opts: {
  previousIdentityKey: string | null
  nextIdentityKey: string | null
}): "retain" | "close_identity_changed" | "clear_unbound" {
  if (opts.nextIdentityKey == null) {
    return opts.previousIdentityKey != null ? "clear_unbound" : "retain"
  }
  if (opts.previousIdentityKey != null && opts.previousIdentityKey !== opts.nextIdentityKey) {
    return "close_identity_changed"
  }
  return "retain"
}

/**
 * Map Web Serial open failures to stable, operator-safe messages.
 * Never includes COM port names invented by Finza.
 */
export function formatCustomerDisplayOpenError(error: unknown): string {
  const err = error as { name?: string; message?: string }
  const name = err?.name || ""
  const message = typeof err?.message === "string" ? err.message : ""
  if (name === "NotFoundError") return "No serial device selected."
  if (name === "SecurityError") return "Serial permission was not granted."
  if (name === "NetworkError" || /already|in use|access denied|failed to open/i.test(message)) {
    return "This serial port is already in use."
  }
  if (name === "InvalidStateError") return "The selected port could not be opened."
  if (message.trim()) {
    if (/permission/i.test(message)) return "Serial permission was not granted."
    if (/already|in use/i.test(message)) return "This serial port is already in use."
    if (/not found|select/i.test(message)) return "No serial device selected."
    return "The selected port could not be opened."
  }
  return "The selected port could not be opened."
}

export function resolveCashierReadyLabel(opts: {
  setupStatus: CashierRegisterCustomerDisplayView["setupStatus"]
  connectionStatus: "disconnected" | "connected" | "error"
}): string {
  if (opts.setupStatus !== "ready") {
    return cashierStatusLabelFromState({
      setupStatus: opts.setupStatus,
      connectionStatus: opts.connectionStatus,
    })
  }
  if (opts.connectionStatus === "connected") return "Customer display: Connected"
  if (opts.connectionStatus === "error") return "Customer display: Error"
  // Ready but not connected yet — distinguish first connect vs after disconnect.
  return opts.connectionStatus === "disconnected"
    ? "Customer display: Ready to connect"
    : "Customer display: Ready to connect"
}

/** Stable string key — never depend on object identity for fetch effects. */
export function customerDisplayIdentityKey(
  identity: { businessId: string; storeId: string; registerId: string } | null | undefined
): string | null {
  if (!identity?.businessId || !identity.storeId || !identity.registerId) return null
  return `${identity.businessId}:${identity.storeId}:${identity.registerId}`
}

/**
 * Config GET should run only when the bound register identity key changes (or first bind).
 * Prevents refetch loops when parents recreate terminalIdentity objects each render.
 */
export function shouldFetchRegisterCustomerDisplayConfig(
  previousKey: string | null,
  nextKey: string | null
): boolean {
  if (nextKey == null) return false
  return previousKey !== nextKey
}

/**
 * After the first successful load, background reloads must not flip UI into a loading/disabled state.
 */
export function nextCustomerDisplayLoadState(opts: {
  previous: "idle" | "loading" | "ready" | "error"
  phase: "start" | "success" | "failure"
}): "idle" | "loading" | "ready" | "error" {
  if (opts.phase === "start") {
    // Keep prior resolved UI stable during silent refresh.
    if (opts.previous === "ready" || opts.previous === "error") return opts.previous
    return "loading"
  }
  if (opts.phase === "success") return "ready"
  return "error"
}

/**
 * Prefer server row once loaded. Local storage is only an import candidate — never alternate
 * terminalConfig between local and server on every effect tick.
 */
export function resolveOwnerTerminalDraft(opts: {
  serverConfig: RegisterCustomerDisplayConfig | null
  local: {
    profileId: RegisterCustomerDisplayProfileId
    physicallyVerified: boolean
    verifiedAt: string | null
    verifiedNote: string | null
    amountWriteMode: CustomerDisplayAmountWriteMode
    updatedAt: string
  } | null
  serverLoadState: "idle" | "loading" | "ready" | "error"
}): {
  terminalConfig: {
    profileId: RegisterCustomerDisplayProfileId
    physicallyVerified: boolean
    verifiedAt: string | null
    verifiedNote: string | null
    amountWriteMode: CustomerDisplayAmountWriteMode
    updatedAt: string
  }
  source: "server" | "local_draft" | "default"
} {
  if (opts.serverLoadState === "ready" && opts.serverConfig) {
    if (opts.serverConfig.profileId) {
      return {
        source: "server",
        terminalConfig: {
          profileId: opts.serverConfig.profileId,
          physicallyVerified: opts.serverConfig.physicallyVerified,
          verifiedAt: opts.serverConfig.verifiedAt,
          verifiedNote: opts.serverConfig.verifiedNote,
          amountWriteMode: opts.serverConfig.amountWriteMode ?? "ascii_only",
          updatedAt: opts.serverConfig.updatedAt ?? new Date(0).toISOString(),
        },
      }
    }
    // Server loaded but unconfigured: keep local as draft only (does not enable auto writes).
    if (opts.local) {
      return { source: "local_draft", terminalConfig: opts.local }
    }
  }
  if (opts.local) {
    return { source: "local_draft", terminalConfig: opts.local }
  }
  return {
    source: "default",
    terminalConfig: {
      profileId: "2400",
      physicallyVerified: false,
      verifiedAt: null,
      verifiedNote: null,
      amountWriteMode: "ascii_only",
      updatedAt: new Date(0).toISOString(),
    },
  }
}

export type ConnectAvailability = {
  canConnect: boolean
  reason: string | null
}

/**
 * Connect enablement. Background config revalidation must not disable Connect once resolved.
 * Cashiers require verified server profile; owners/admins may connect for setup/diagnostics.
 */
export function resolveCustomerDisplayConnectAvailability(opts: {
  canUseDiagnostics: boolean
  hasTerminalBinding: boolean
  configLoadState: "idle" | "loading" | "ready" | "error"
  setupStatus: CashierRegisterCustomerDisplayView["setupStatus"] | null
  webSerialSupported: boolean
}): ConnectAvailability {
  if (!opts.webSerialSupported) {
    return { canConnect: false, reason: "This browser does not support Web Serial." }
  }
  if (!opts.hasTerminalBinding) {
    return { canConnect: false, reason: "No register is bound to this terminal." }
  }
  if (opts.configLoadState === "loading" || opts.configLoadState === "idle") {
    return { canConnect: false, reason: "Configuration is still loading." }
  }
  if (opts.canUseDiagnostics) {
    // Owner/admin: may connect to test even when unverified (auto writes stay fail-closed).
    return { canConnect: true, reason: null }
  }
  if (opts.setupStatus === "not_configured" || opts.setupStatus == null) {
    return {
      canConnect: false,
      reason: "Customer display has not been configured for this register.",
    }
  }
  if (opts.setupStatus === "unverified") {
    return {
      canConnect: false,
      reason: "Customer display has not been configured for this register.",
    }
  }
  return { canConnect: true, reason: null }
}

