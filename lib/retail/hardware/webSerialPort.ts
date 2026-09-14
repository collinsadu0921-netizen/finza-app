/**
 * Retail POS hardware helpers that talk to Web Serial (Chrome/Edge).
 * Used by the customer-facing VFD and optional ESC/POS cash-drawer pulse.
 */

export type BrowserSerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>
  writable: WritableStream<Uint8Array> | null
  close: () => Promise<void>
  getInfo?: () => { usbVendorId?: number; usbProductId?: number }
}

export type NavigatorWithWebSerial = Navigator & {
  serial?: {
    requestPort: (opts?: { filters?: Array<{ usbVendorId?: number }> }) => Promise<BrowserSerialPortLike>
    getPorts?: () => Promise<BrowserSerialPortLike[]>
  }
}

export function getWebSerial(): NavigatorWithWebSerial["serial"] | null {
  if (typeof navigator === "undefined") return null
  const serial = (navigator as NavigatorWithWebSerial).serial
  return serial?.requestPort ? serial : null
}

export function webSerialUnsupportedMessage(): string {
  return "This browser cannot talk to the pole display or cash drawer over serial. Use Chrome or Edge on the Windows POS terminal, then connect from the POS hardware panel."
}

export async function requestSerialPort(): Promise<BrowserSerialPortLike> {
  const serial = getWebSerial()
  if (!serial) {
    throw new Error(webSerialUnsupportedMessage())
  }
  return serial.requestPort()
}

export async function listGrantedSerialPorts(): Promise<BrowserSerialPortLike[]> {
  const serial = getWebSerial()
  if (!serial?.getPorts) return []
  try {
    return await serial.getPorts()
  } catch {
    return []
  }
}

export async function openSerialPort(
  port: BrowserSerialPortLike,
  baudRate: number
): Promise<void> {
  try {
    await port.open({ baudRate })
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string }
    if (err?.name === "InvalidStateError") {
      return
    }
    if (err?.name === "NotFoundError") {
      throw new Error("No serial device selected.")
    }
    if (err?.name === "SecurityError") {
      throw new Error("Permission denied. Allow access to the serial device when Chrome prompts.")
    }
    throw e instanceof Error ? e : new Error("Could not open the serial port.")
  }
}

export async function writeSerialBytes(port: BrowserSerialPortLike, bytes: Uint8Array): Promise<void> {
  const writer = port.writable?.getWriter()
  if (!writer) {
    throw new Error("Serial port is not writable.")
  }
  try {
    await writer.write(bytes)
  } finally {
    writer.releaseLock()
  }
}

export async function closeSerialPort(port: BrowserSerialPortLike): Promise<void> {
  try {
    await port.close()
  } catch {
    /* already closed */
  }
}
