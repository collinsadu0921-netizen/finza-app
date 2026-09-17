/**
 * Web Serial helpers for the Retail customer amount display.
 * Baud/profile is chosen by the cashier/admin — never hardcode a COM port name.
 */

import { SEGMENTED_AMOUNT_SERIAL } from "@/lib/retail/hardware/customerDisplayProtocol"

export type SerialPortOpenOptions = {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: "none" | "even" | "odd"
  flowControl?: "none" | "hardware"
}

export type BrowserSerialPortLike = {
  open: (opts: SerialPortOpenOptions) => Promise<void>
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
  return "This browser cannot talk to the customer amount display over serial. Use Chrome or Edge on the Windows POS terminal, then tap Connect customer display and choose the display COM port."
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

/**
 * Open a serial port with the given 8N1 profile (default: sales profile 9600).
 * Chrome does not expose the Windows COM number; the cashier selects the port in the picker.
 */
export async function openSerialPort(
  port: BrowserSerialPortLike,
  options: SerialPortOpenOptions = SEGMENTED_AMOUNT_SERIAL
): Promise<void> {
  try {
    await port.open({
      baudRate: options.baudRate,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? "none",
      flowControl: options.flowControl ?? "none",
    })
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string }
    if (err?.name === "InvalidStateError") {
      // Port already open in this page — treat as success for reuse.
      return
    }
    if (err?.name === "NotFoundError") {
      throw new Error("No serial device selected.")
    }
    if (err?.name === "SecurityError") {
      throw new Error("Serial permission was not granted.")
    }
    if (err?.name === "NetworkError" || /already|in use|failed to open/i.test(err?.message || "")) {
      throw new Error("This serial port is already in use.")
    }
    throw e instanceof Error ? e : new Error("The selected port could not be opened.")
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
