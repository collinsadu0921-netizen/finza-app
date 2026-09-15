"use client"

import {
  buildSegmentedAmountBytes,
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
} from "@/lib/retail/hardware/webSerialPort"

export type RetailHardwareStatus = CustomerDisplayConnectionStatus

type DisplaySession = {
  port: BrowserSerialPortLike
  status: RetailHardwareStatus
  lastError: string
}

let displaySession: DisplaySession | null = null
let writeQueue: Promise<void> = Promise.resolve()

export function getCustomerDisplayStatus(): RetailHardwareStatus {
  return displaySession?.status ?? "disconnected"
}

export function getCustomerDisplayLastError(): string {
  return displaySession?.lastError ?? ""
}

async function enqueueWrite(bytes: Uint8Array): Promise<void> {
  const run = async () => {
    const session = displaySession
    if (!session || !shouldWriteCustomerDisplay(session.status)) return
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

export async function connectCustomerDisplay(): Promise<void> {
  const port = await pickDisplayPort()
  await openSerialPort(port)
  if (displaySession?.port && displaySession.port !== port) {
    await closeSerialPort(displaySession.port)
  }
  displaySession = { port, status: "connected", lastError: "" }
  await enqueueWrite(buildSegmentedAmountBytes(0))
}

export async function disconnectCustomerDisplay(): Promise<void> {
  const session = displaySession
  displaySession = null
  if (!session) return
  try {
    await writeSerialBytes(session.port, buildSegmentedAmountBytes(0))
  } catch {
    /* ignore */
  }
  await closeSerialPort(session.port)
}

/** Never throws — sale flow must continue if the display is off or fails. */
export async function writeCustomerDisplayAmount(amount: number): Promise<void> {
  try {
    if (!displaySession || !shouldWriteCustomerDisplay(displaySession.status)) return
    await enqueueWrite(buildSegmentedAmountBytes(amount))
  } catch {
    /* ignore */
  }
}
