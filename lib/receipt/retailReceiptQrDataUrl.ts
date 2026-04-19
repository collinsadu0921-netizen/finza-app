import QRCode from "qrcode"
import type { PrinterWidth } from "@/lib/escpos"

export function receiptQrPixelSize(width: PrinterWidth): number {
  return width === "58mm" ? 128 : 168
}

/** PNG data URL for receipt preview / browser print (no CDN, works in iframe srcDoc). */
export async function retailReceiptQrDataUrl(
  lookupText: string,
  printerWidth: PrinterWidth
): Promise<string> {
  const text = lookupText.trim()
  if (!text) {
    throw new Error("Receipt QR text is empty")
  }
  const width = receiptQrPixelSize(printerWidth)
  return QRCode.toDataURL(text, {
    width,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  })
}
