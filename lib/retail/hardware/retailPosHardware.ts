"use client"

import {
  buildSegmentedAmountBytes,
  shouldWriteCustomerDisplay,
  SEGMENTED_AMOUNT_SERIAL,
  type CustomerDisplayConnectionStatus,
} from "@/lib/retail/hardware/customerDisplayProtocol"
import {
  appendCustomerDisplayDiagnosticLog,
  buildCandidateClearThenAmountPreview,
  buildCustomerDisplayDiagnosticBytes,
  bytesToHexPreview,
  getCustomerDisplayDiagnosticTest,
  getCustomerDisplaySerialProfile,
  parseDiagnosticAmountAscii,
  readCustomerDisplayDiagnosticLogFromStorage,
  writeCustomerDisplayDiagnosticLogToStorage,
  type CustomerDisplayDiagnosticLogEntry,
  type CustomerDisplayDiagnosticTestId,
  type CustomerDisplaySerialProfile,
} from "@/lib/retail/hardware/customerDisplayDiagnostic"
import {
  closeSerialPort,
  listGrantedSerialPorts,
  openSerialPort,
  requestSerialPort,
  writeSerialBytes,
  type BrowserSerialPortLike,
  type SerialPortOpenOptions,
} from "@/lib/retail/hardware/webSerialPort"

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

export function getCustomerDisplayDiagnosticWriteCount(): number {
  return diagnosticWriteCount
}

/** Test helper — resets module session between unit tests. */
export function __resetCustomerDisplaySessionForTests(): void {
  displaySession = null
  writeQueue = Promise.resolve()
  diagnosticWriteCount = 0
  diagnosticModeEnabled = false
  automaticSaleWritesEnabled = false
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

async function pickDisplayPort(): Promise<BrowserSerialPortLike> {
  const granted = await listGrantedSerialPorts()
  if (granted.length === 1) {
    return granted[0]
  }
  return requestSerialPort()
}

function resolveOpenOptions(profile?: CustomerDisplaySerialProfile | null): SerialPortOpenOptions {
  if (!profile) return { ...SEGMENTED_AMOUNT_SERIAL }
  return {
    baudRate: profile.baudRate,
    dataBits: profile.dataBits,
    stopBits: profile.stopBits,
    parity: profile.parity,
    flowControl: profile.flowControl,
  }
}

/**
 * Connect to the cashier-selected COM port.
 * Does not write any bytes on connect — sales auto-updates or diagnostic buttons write later.
 */
export async function connectCustomerDisplay(opts?: {
  profile?: CustomerDisplaySerialProfile | null
  diagnosticMode?: boolean
}): Promise<void> {
  const profile = opts?.profile ?? null
  const openOpts = resolveOpenOptions(profile)
  const port = await pickDisplayPort()
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
export async function writeCustomerDisplayAmount(amount: number): Promise<void> {
  try {
    if (!displaySession || !shouldWriteCustomerDisplay(displaySession.status)) return
    if (diagnosticModeEnabled || displaySession.diagnosticMode) return
    // Second gate: even if a caller skips intent resolution, unverified tills must not write.
    if (!automaticSaleWritesEnabled) return
    await enqueueWrite(buildSegmentedAmountBytes(amount))
  } catch {
    /* ignore */
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
