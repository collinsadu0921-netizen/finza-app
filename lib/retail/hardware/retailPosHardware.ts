"use client"

import {
  asciiToDiagnosticBytes,
  appendCustomerDisplayDiagnosticLog,
  buildCandidateClearThenAmountPreview,
  buildCustomerDisplayDiagnosticBytes,
  bytesToHexPreview,
  CANDIDATE_CLEAR_BYTE,
  getCustomerDisplayDiagnosticTest,
  getCustomerDisplaySerialProfile,
  readCustomerDisplayDiagnosticLogFromStorage,
  writeCustomerDisplayDiagnosticLogToStorage,
  type CustomerDisplayDiagnosticLogEntry,
  type CustomerDisplayDiagnosticTestId,
  type CustomerDisplaySerialProfile,
} from "@/lib/retail/hardware/customerDisplayDiagnostic"
import {
  buildSegmentedAmountBytes,
  formatSegmentedAmount,
  shouldWriteCustomerDisplay,
  type CustomerDisplayConnectionStatus,
} from "@/lib/retail/hardware/customerDisplayProtocol"
import {
  closeSerialPort,
  listGrantedSerialPorts,
  openSerialPort,
  requestSerialPort,
  writeSerialBytes,
  type BrowserSerialPortLike,
  type SerialPortOpenOptions,
} from "@/lib/retail/hardware/webSerialPort"
import type { CustomerDisplayAmountWriteMode } from "@/lib/retail/hardware/customerDisplayTerminalConfig"

export type RetailHardwareStatus = CustomerDisplayConnectionStatus

type DisplaySession = {
  port: BrowserSerialPortLike
  status: RetailHardwareStatus
  lastError: string
  baudRate: number
  diagnosticMode: boolean
}

let displaySession: DisplaySession | null = null
let writeQueue: Promise<void> = Promise.resolve()
/** Counts controlled diagnostic writes only (one per button press). */
let diagnosticWriteCount = 0
/**
 * Diagnostic preference survives without an open COM session so admins can
 * Enter diagnostic → choose 2400 → Connect. Session.diagnosticMode mirrors this
 * while connected.
 */
let diagnosticModeEnabled = false
/**
 * Fail-closed latch for automatic sale amounts. Defaults off; the POS hook enables
 * it only after this till’s profile is physicallyVerified.
 */
let automaticSaleWritesEnabled = false
/**
 * Session-only staging live trial (0C then amount). Not persisted; not verification.
 */
let liveTrialWritesEnabled = false
/**
 * How automatic sale writes encode amounts. Defaults ascii_only; hook syncs from per-till config.
 * clear_then_amount matches the staging live-trial sequence verified on one Windows 7 till.
 */
let amountWriteMode: CustomerDisplayAmountWriteMode = "ascii_only"
/** Shared sequence for clear-then-amount writes (sale path + live trial). */
let clearThenAmountSequence = 0
let clearThenAmountQueue: Promise<void> = Promise.resolve()

export function getCustomerDisplayStatus(): RetailHardwareStatus {
  return displaySession?.status ?? "disconnected"
}

export function getCustomerDisplayLastError(): string {
  return displaySession?.lastError ?? ""
}

export function getCustomerDisplayBaudRate(): number | null {
  return displaySession?.baudRate ?? null
}

export function isCustomerDisplayDiagnosticMode(): boolean {
  return diagnosticModeEnabled === true
}

export function areAutomaticCustomerDisplaySaleWritesEnabled(): boolean {
  return automaticSaleWritesEnabled === true
}

export function setAutomaticCustomerDisplaySaleWritesEnabled(enabled: boolean): void {
  automaticSaleWritesEnabled = enabled === true
}

export function isCustomerDisplayLiveTrialWritesEnabled(): boolean {
  return liveTrialWritesEnabled === true
}

export function setCustomerDisplayLiveTrialWritesEnabled(enabled: boolean): void {
  liveTrialWritesEnabled = enabled === true
  // Invalidate in-flight clear-then-amount sequences when turning off.
  clearThenAmountSequence += 1
}

export function getCustomerDisplayAmountWriteMode(): CustomerDisplayAmountWriteMode {
  return amountWriteMode
}

export function setCustomerDisplayAmountWriteMode(mode: CustomerDisplayAmountWriteMode): void {
  amountWriteMode = mode === "clear_then_amount" ? "clear_then_amount" : "ascii_only"
  clearThenAmountSequence += 1
}

export function getCustomerDisplayDiagnosticWriteCount(): number {
  return diagnosticWriteCount
}

export function getCustomerDisplayClearThenAmountSequenceForTests(): number {
  return clearThenAmountSequence
}

/** @deprecated Use getCustomerDisplayClearThenAmountSequenceForTests */
export function getCustomerDisplayLiveTrialSequenceForTests(): number {
  return clearThenAmountSequence
}

/** Test helper — resets module session between unit tests. */
export function __resetCustomerDisplaySessionForTests(): void {
  displaySession = null
  writeQueue = Promise.resolve()
  diagnosticWriteCount = 0
  diagnosticModeEnabled = false
  automaticSaleWritesEnabled = false
  liveTrialWritesEnabled = false
  amountWriteMode = "ascii_only"
  clearThenAmountSequence = 0
  clearThenAmountQueue = Promise.resolve()
}

async function enqueueWrite(bytes: Uint8Array, opts?: { allowWhileDiagnostic?: boolean }): Promise<void> {
  const run = async () => {
    const session = displaySession
    if (!session || !shouldWriteCustomerDisplay(session.status)) return
    if ((diagnosticModeEnabled || session.diagnosticMode) && !opts?.allowWhileDiagnostic) return
    try {
      await writeSerialBytes(session.port, bytes)
    } catch (e: unknown) {
      session.status = "error"
      session.lastError = e instanceof Error ? e.message : "Customer display write failed."
      try {
        await closeSerialPort(session.port)
      } catch {
        /* ignore */
      }
      displaySession = session
    }
  }
  writeQueue = writeQueue.then(run, run)
  await writeQueue
}

async function pickDisplayPort(forcePortPicker?: boolean): Promise<BrowserSerialPortLike> {
  if (forcePortPicker === true) {
    return requestSerialPort()
  }
  const granted = await listGrantedSerialPorts()
  if (granted.length === 1) {
    return granted[0]
  }
  return requestSerialPort()
}

function resolveOpenOptions(profile: CustomerDisplaySerialProfile): SerialPortOpenOptions {
  return {
    baudRate: profile.baudRate,
    dataBits: profile.dataBits,
    stopBits: profile.stopBits,
    parity: profile.parity,
    flowControl: profile.flowControl,
  }
}

/**
 * Connect to the cashier-selected COM port using an explicit serial profile.
 * Does not write any bytes on connect — sales auto-updates or diagnostic buttons write later.
 * Never invents baud/protocol: callers must supply a register-verified or diagnostic profile.
 */
export async function connectCustomerDisplay(opts: {
  profile: CustomerDisplaySerialProfile
  diagnosticMode?: boolean
  /** Force Chrome’s serial picker (e.g. “Choose customer display” on a new PC). */
  forcePortPicker?: boolean
}): Promise<void> {
  if (!opts?.profile) {
    throw new Error(
      "Customer display requires owner/admin setup. Sales can continue without it."
    )
  }
  const openOpts = resolveOpenOptions(opts.profile)
  const port = await pickDisplayPort(opts.forcePortPicker === true)
  await openSerialPort(port, openOpts)
  if (displaySession?.port && displaySession.port !== port) {
    await closeSerialPort(displaySession.port)
  }
  const diagnosticMode = opts?.diagnosticMode === true || diagnosticModeEnabled
  diagnosticModeEnabled = diagnosticMode
  displaySession = {
    port,
    status: "connected",
    lastError: "",
    baudRate: openOpts.baudRate,
    diagnosticMode,
  }
}

export async function setCustomerDisplayDiagnosticMode(enabled: boolean): Promise<void> {
  diagnosticModeEnabled = enabled === true
  if (displaySession) {
    displaySession = { ...displaySession, diagnosticMode: diagnosticModeEnabled }
  }
}

export async function reconnectCustomerDisplayWithProfile(
  profile: CustomerDisplaySerialProfile,
  opts?: { diagnosticMode?: boolean }
): Promise<void> {
  const previousPort = displaySession?.port ?? null
  const diagnosticMode =
    opts?.diagnosticMode === true || diagnosticModeEnabled || displaySession?.diagnosticMode === true
  diagnosticModeEnabled = diagnosticMode
  if (previousPort) {
    try {
      await closeSerialPort(previousPort)
    } catch {
      /* ignore */
    }
    displaySession = null
  }
  const port = previousPort ?? (await pickDisplayPort())
  await openSerialPort(port, resolveOpenOptions(profile))
  displaySession = {
    port,
    status: "connected",
    lastError: "",
    baudRate: profile.baudRate,
    diagnosticMode,
  }
}

export async function disconnectCustomerDisplay(): Promise<void> {
  const session = displaySession
  displaySession = null
  // Keep diagnosticModeEnabled so Enter diagnostic stays active after Disconnect.
  if (!session) return
  // Do not send bytes on disconnect during diagnostics; normal mode also skips
  // so we never race a competing write while troubleshooting.
  await closeSerialPort(session.port)
}

/** Never throws — sale flow must continue if the display is off or fails. */
export async function writeCustomerDisplayAmount(
  amount: number
): Promise<{ ok: boolean; error: string | null; skipped?: boolean }> {
  try {
    if (!displaySession || !shouldWriteCustomerDisplay(displaySession.status)) {
      return { ok: true, error: null, skipped: true }
    }
    if (diagnosticModeEnabled || displaySession.diagnosticMode) {
      return { ok: true, error: null, skipped: true }
    }
    // Second gate: even if a caller skips intent resolution, unverified tills must not write.
    if (!automaticSaleWritesEnabled) {
      return { ok: true, error: null, skipped: true }
    }
    if (amountWriteMode === "clear_then_amount") {
      const result = await writeClearThenAmountSequenced(amount, { gate: "sale" })
      if (result.superseded) {
        return { ok: true, error: null, skipped: true }
      }
      if (!result.ok) {
        automaticSaleWritesEnabled = false
        if (displaySession) {
          displaySession = {
            ...displaySession,
            status: "error",
            lastError: result.error || "Customer display write failed.",
          }
        }
        return { ok: false, error: result.error }
      }
      return { ok: true, error: null }
    }
    const before = displaySession
    await enqueueWrite(buildSegmentedAmountBytes(amount))
    if (getCustomerDisplayStatus() === "error") {
      automaticSaleWritesEnabled = false
      return {
        ok: false,
        error: getCustomerDisplayLastError() || "Customer display write failed.",
      }
    }
    if (!displaySession && before) {
      automaticSaleWritesEnabled = false
      return { ok: false, error: before.lastError || "Customer display write failed." }
    }
    return { ok: true, error: null }
  } catch (e: unknown) {
    automaticSaleWritesEnabled = false
    const error = e instanceof Error ? e.message : "Customer display write failed."
    if (displaySession) {
      displaySession = { ...displaySession, status: "error", lastError: error }
    }
    return { ok: false, error }
  }
}

/**
 * Shared clear-then-amount writer used by:
 * - verified / candidate auto-sale path (gate: sale + automaticSaleWritesEnabled)
 * - staging live trial (gate: liveTrial + liveTrialWritesEnabled)
 * Serialized by sequence so rapid basket changes only leave the latest amount.
 */
async function writeClearThenAmountSequenced(
  amount: number,
  opts: { gate: "sale" | "liveTrial" }
): Promise<{ ok: boolean; error: string | null; superseded?: boolean }> {
  const seq = ++clearThenAmountSequence
  const ascii = formatSegmentedAmount(amount)
  const clearBytes = new Uint8Array([CANDIDATE_CLEAR_BYTE])
  const amountBytes = asciiToDiagnosticBytes(ascii)

  const run = async (): Promise<{ ok: boolean; error: string | null; superseded?: boolean }> => {
    try {
      if (opts.gate === "liveTrial" && !liveTrialWritesEnabled) {
        return { ok: true, error: null, superseded: true }
      }
      if (opts.gate === "sale" && !automaticSaleWritesEnabled) {
        return { ok: true, error: null, superseded: true }
      }
      if (diagnosticModeEnabled || displaySession?.diagnosticMode) {
        return { ok: true, error: null, superseded: true }
      }
      if (seq !== clearThenAmountSequence) {
        return { ok: true, error: null, superseded: true }
      }
      if (!displaySession || !shouldWriteCustomerDisplay(displaySession.status)) {
        return { ok: false, error: "Customer display is not connected." }
      }

      await enqueueWrite(clearBytes)
      if (seq !== clearThenAmountSequence) {
        return { ok: true, error: null, superseded: true }
      }
      const afterClear = displaySession
      if (!afterClear || afterClear.status === "error") {
        return {
          ok: false,
          error: afterClear?.lastError || "Customer display clear write failed.",
        }
      }

      await enqueueWrite(amountBytes)
      if (seq !== clearThenAmountSequence) {
        return { ok: true, error: null, superseded: true }
      }
      const afterAmount = displaySession
      if (!afterAmount || afterAmount.status === "error") {
        return {
          ok: false,
          error: afterAmount?.lastError || "Customer display amount write failed.",
        }
      }
      return { ok: true, error: null }
    } catch (e: unknown) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Customer display clear-then-amount write failed.",
      }
    }
  }

  const resultPromise = clearThenAmountQueue.then(run, run)
  clearThenAmountQueue = resultPromise.then(
    () => undefined,
    () => undefined
  )
  return resultPromise
}

/**
 * Staging live-trial write: one 0C then one ASCII amount (validated formatter).
 * Shares the candidate clear-then-amount sequence with the normal sale path.
 * Does not enable the verified auto-sale latch. Never throws into the sale path.
 */
export async function writeCustomerDisplayLiveTrialAmount(
  amount: number
): Promise<{ ok: boolean; error: string | null; superseded?: boolean }> {
  try {
    return await writeClearThenAmountSequenced(amount, { gate: "liveTrial" })
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Customer display live-trial write failed.",
    }
  }
}

/**
 * One controlled diagnostic write. Never throws to the sale path.
 * Records baud, test name, hex bytes, timestamp, and result locally.
 */
export async function writeCustomerDisplayDiagnosticTest(
  testId: CustomerDisplayDiagnosticTestId,
  opts?: { storage?: Pick<Storage, "getItem" | "setItem"> | null }
): Promise<{ ok: boolean; bytesHex: string; error: string | null }> {
  const test = getCustomerDisplayDiagnosticTest(testId)
  const bytes = buildCustomerDisplayDiagnosticBytes(testId)
  return writeDiagnosticBytesLogged({
    testId,
    testName: test.name,
    bytes,
    storage: opts?.storage,
  })
}

/**
 * Unverified candidate sequence for tills where a prior 0C blanked the panel:
 * write 0C once, log it; if that write fails, stop; otherwise write amount ASCII once and log it.
 * Not used by connect, disconnect, basket, checkout, or sale flows.
 */
export async function writeCustomerDisplayDiagnosticClearThenAmount(
  amountInput: string,
  opts?: { storage?: Pick<Storage, "getItem" | "setItem"> | null }
): Promise<{
  clear: { ok: boolean; bytesHex: string; error: string | null }
  amount: { ok: boolean; bytesHex: string; error: string | null } | null
}> {
  const preview = buildCandidateClearThenAmountPreview(amountInput)
  if (!preview.valid || !preview.ascii || !preview.amountBytes) {
    const clear = {
      ok: false,
      bytesHex: preview.clearHex,
      error: preview.error || "Invalid amount.",
    }
    return { clear, amount: null }
  }

  const clear = await writeDiagnosticBytesLogged({
    testId: "candidate_clear_0c",
    testName: "Test candidate clear (0C)",
    bytes: preview.clearBytes,
    storage: opts?.storage,
  })
  if (!clear.ok) {
    return { clear, amount: null }
  }

  const amount = await writeDiagnosticBytesLogged({
    testId: "candidate_amount_ascii",
    testName: `Candidate clear-then-amount ASCII ${preview.ascii}`,
    bytes: preview.amountBytes,
    storage: opts?.storage,
  })
  return { clear, amount }
}

async function writeDiagnosticBytesLogged(opts: {
  testId: CustomerDisplayDiagnosticTestId
  testName: string
  bytes: Uint8Array
  storage?: Pick<Storage, "getItem" | "setItem"> | null
}): Promise<{ ok: boolean; bytesHex: string; error: string | null }> {
  const bytesHex = bytesToHexPreview(opts.bytes)
  const baudRate = displaySession?.baudRate ?? getCustomerDisplaySerialProfile("2400").baudRate
  const storage =
    opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : null)

  const record = (ok: boolean, error: string | null) => {
    const entry: CustomerDisplayDiagnosticLogEntry = {
      baudRate,
      testName: opts.testName,
      testId: opts.testId,
      bytesHex,
      timestamp: new Date().toISOString(),
      ok,
      error,
    }
    const existing = readCustomerDisplayDiagnosticLogFromStorage(storage)
    writeCustomerDisplayDiagnosticLogToStorage(
      storage,
      appendCustomerDisplayDiagnosticLog(existing, entry)
    )
    return { ok, bytesHex, error }
  }

  try {
    if (!displaySession || !shouldWriteCustomerDisplay(displaySession.status)) {
      return record(false, "Customer display is not connected.")
    }
    diagnosticWriteCount += 1
    await enqueueWrite(opts.bytes, { allowWhileDiagnostic: true })
    if (displaySession?.status === "error") {
      return record(false, displaySession.lastError || "Customer display write failed.")
    }
    return record(true, null)
  } catch (e: unknown) {
    return record(false, e instanceof Error ? e.message : "Customer display write failed.")
  }
}

export function listCustomerDisplayDiagnosticLog(
  storage?: Pick<Storage, "getItem"> | null
): CustomerDisplayDiagnosticLogEntry[] {
  const store =
    storage ?? (typeof localStorage !== "undefined" ? localStorage : null)
  return readCustomerDisplayDiagnosticLogFromStorage(store)
}
