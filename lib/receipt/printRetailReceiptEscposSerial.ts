"use client"

import { ESCPOSGenerator, type ReceiptData, type PrinterWidth, type ReceiptMode } from "@/lib/escpos"

/** Web Serial port shape used after `requestPort()` — avoids relying on DOM `SerialPort` in `lib` TS config. */
type BrowserSerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>
  writable: WritableStream<Uint8Array> | null
  close: () => Promise<void>
}

type NavigatorWithWebSerial = Navigator & {
  serial?: {
    requestPort: () => Promise<BrowserSerialPortLike>
  }
}

/** Subset of receipt_settings used for raw thermal output (matches ReceiptPrinter ESC/POS path). */
export type RetailReceiptEscposSerialSettings = {
  printer_width: PrinterWidth
  receipt_mode: ReceiptMode
  auto_cut: boolean
  drawer_kick: boolean
  show_logo: boolean
  show_qr_code: boolean
  qr_code_content?: string
  footer_text?: string
}

/**
 * Sends a retail receipt as ESC/POS bytes over Web Serial (thermal printer).
 * When `drawer_kick` is true, standard drawer-open pulses are appended after the receipt (see `ESCPOSGenerator`).
 */
export async function printRetailReceiptEscposSerial(
  receiptData: ReceiptData,
  settings: RetailReceiptEscposSerialSettings
): Promise<void> {
  if (!("serial" in navigator)) {
    throw new Error("Web Serial API not supported. Please use Chrome/Edge browser.")
  }

  const navSerial = (navigator as NavigatorWithWebSerial).serial
  if (!navSerial?.requestPort) {
    throw new Error("Web Serial API not available in this browser.")
  }

  const port: BrowserSerialPortLike = await navSerial.requestPort()

  try {
    await port.open({ baudRate: 9600 })
  } catch (e: unknown) {
    const err = e as { name?: string }
    if (err?.name === "NotFoundError") {
      throw new Error("No printer selected or printer not found.")
    }
    if (err?.name === "SecurityError") {
      throw new Error("Permission denied. Please allow access to the printer.")
    }
    throw e instanceof Error ? e : new Error("Could not open the serial port.")
  }

  try {
    const qrMerged =
      (receiptData.qrCodeContent && receiptData.qrCodeContent.trim()) ||
      (settings.qr_code_content && settings.qr_code_content.trim()) ||
      ""

    const showQrEffective = !!settings.show_qr_code || !!receiptData.qrCodeContent

    const generator = new ESCPOSGenerator(
      settings.printer_width,
      settings.receipt_mode,
      settings.auto_cut,
      settings.drawer_kick,
      settings.show_logo,
      showQrEffective
    )

    const commands = generator.generate({
      ...receiptData,
      footerText: settings.footer_text,
      qrCodeContent: qrMerged || undefined,
    })

    const writer = port.writable?.getWriter()
    if (!writer) {
      throw new Error("Printer port is not writable.")
    }
    await writer.write(commands)
    writer.releaseLock()
  } finally {
    try {
      await port.close()
    } catch {
      /* ignore */
    }
  }
}
