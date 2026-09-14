"use client"

import {
  buildCashDrawerKickBytes,
  buildCustomerDisplayBytes,
  formatCustomerDisplayLines,
  type CustomerDisplayView,
} from "@/lib/retail/hardware/customerDisplayProtocol"
import {
  closeSerialPort,
  openSerialPort,
  requestSerialPort,
  writeSerialBytes,
  type BrowserSerialPortLike,
} from "@/lib/retail/hardware/webSerialPort"

const IDLE_KEY = "finza.retail.customerDisplay.idleMessage"
const BAUD_KEY = "finza.retail.customerDisplay.baudRate"
const DRAWER_LOG_KEY = "finza.retail.cashDrawer.openLog"

export type RetailHardwareStatus = "disconnected" | "connected" | "error"

export type CashDrawerOpenLogEntry = {
  at: string
  cashier: string
  source: "manual" | "cash-sale"
}

type DisplaySession = {
  port: BrowserSerialPortLike
  status: RetailHardwareStatus
  lastError: string
}

let displaySession: DisplaySession | null = null
let writeQueue: Promise<void> = Promise.resolve()

function readIdleMessage(): string {
  if (typeof window === "undefined") return ""
  try {
    return (window.localStorage.getItem(IDLE_KEY) || "").trim()
  } catch {
    return ""
  }
}

export function getCustomerDisplayIdleMessage(): string {
  return readIdleMessage()
}

export function setCustomerDisplayIdleMessage(message: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(IDLE_KEY, message.trim())
  } catch {
    /* ignore quota */
  }
}

function readBaud(): number {
  if (typeof window === "undefined") return 9600
  try {
    const n = Number(window.localStorage.getItem(BAUD_KEY) || "9600")
    return n === 2400 || n === 4800 || n === 19200 ? n : 9600
  } catch {
    return 9600
  }
}

export function getCustomerDisplayStatus(): RetailHardwareStatus {
  return displaySession?.status ?? "disconnected"
}

export function getCustomerDisplayLastError(): string {
  return displaySession?.lastError ?? ""
}

export function readCashDrawerOpenLog(): CashDrawerOpenLogEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(DRAWER_LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CashDrawerOpenLogEntry[]
    return Array.isArray(parsed) ? parsed.slice(0, 20) : []
  } catch {
    return []
  }
}

function appendCashDrawerOpenLog(entry: CashDrawerOpenLogEntry): void {
  if (typeof window === "undefined") return
  try {
    const next = [entry, ...readCashDrawerOpenLog()].slice(0, 20)
    window.localStorage.setItem(DRAWER_LOG_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

async function enqueueWrite(bytes: Uint8Array): Promise<void> {
  const run = async () => {
    const session = displaySession
    if (!session || session.status !== "connected") return
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

export async function connectCustomerDisplay(): Promise<void> {
  const port = await requestSerialPort()
  await openSerialPort(port, readBaud())
  if (displaySession?.port && displaySession.port !== port) {
    await closeSerialPort(displaySession.port)
  }
  displaySession = { port, status: "connected", lastError: "" }
  const idle = formatCustomerDisplayLines({
    kind: "idle",
    idleMessage: readIdleMessage(),
  })
  await enqueueWrite(buildCustomerDisplayBytes(idle.line1, idle.line2))
}

export async function disconnectCustomerDisplay(): Promise<void> {
  const session = displaySession
  displaySession = null
  if (!session) return
  try {
    const idle = formatCustomerDisplayLines({ kind: "idle", idleMessage: readIdleMessage() })
    await writeSerialBytes(session.port, buildCustomerDisplayBytes(idle.line1, idle.line2))
  } catch {
    /* ignore */
  }
  await closeSerialPort(session.port)
}

export async function writeCustomerDisplayView(view: CustomerDisplayView): Promise<void> {
  if (!displaySession || displaySession.status !== "connected") return
  const lines = formatCustomerDisplayLines(view)
  await enqueueWrite(buildCustomerDisplayBytes(lines.line1, lines.line2))
}

/**
 * Pulse the cash drawer via ESC/POS on a serial printer port.
 * The drawer is wired to the BillPoint printer, not the pole display — never
 * send this command to the customer-display session.
 * Never throws to the sale path.
 */
export async function pulseCashDrawer(input: {
  cashier: string
  source: "manual" | "cash-sale"
}): Promise<{ ok: boolean; message?: string }> {
  const log = () =>
    appendCashDrawerOpenLog({
      at: new Date().toISOString(),
      cashier: input.cashier.trim() || "cashier",
      source: input.source,
    })

  try {
    const port = await requestSerialPort()
    await openSerialPort(port, 9600)
    try {
      await writeSerialBytes(port, buildCashDrawerKickBytes())
      log()
      return { ok: true }
    } finally {
      await closeSerialPort(port)
    }
  } catch (e: unknown) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "Could not send a cash-drawer pulse. If this till uses the XP-80 USB printer driver, configure the drawer in Windows printer properties instead.",
    }
  }
}
