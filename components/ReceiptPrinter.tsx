"use client"

import { useState } from "react"
import { generateReceiptHTML, type ReceiptData, type PrinterWidth, type ReceiptMode } from "@/lib/escpos"
import { retailReceiptQrDataUrl } from "@/lib/receipt/retailReceiptQrDataUrl"
import { printRetailReceiptEscposSerial } from "@/lib/receipt/printRetailReceiptEscposSerial"

type ReceiptPrinterProps = {
  receiptData: ReceiptData
  settings: {
    printer_type: "escpos" | "browser_print"
    printer_width: PrinterWidth
    auto_cut: boolean
    drawer_kick: boolean
    show_logo: boolean
    receipt_mode: ReceiptMode
    footer_text?: string
    show_qr_code: boolean
    qr_code_content?: string
  }
  onPrintComplete?: () => void
}

export default function ReceiptPrinter({
  receiptData,
  settings,
  onPrintComplete,
}: ReceiptPrinterProps) {
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState("")

  const handlePrint = async () => {
    setPrinting(true)
    setError("")

    try {
      if (settings.printer_type === "escpos") {
        await printRetailReceiptEscposSerial(receiptData, {
          printer_width: settings.printer_width,
          receipt_mode: settings.receipt_mode,
          auto_cut: settings.auto_cut,
          drawer_kick: settings.drawer_kick,
          show_logo: settings.show_logo,
          show_qr_code: settings.show_qr_code,
          qr_code_content: settings.qr_code_content,
          footer_text: settings.footer_text,
        })
      } else {
        await printBrowser()
      }
      onPrintComplete?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to print receipt"
      setError(message)
      console.error("Print error:", err)
    } finally {
      setPrinting(false)
    }
  }

  const printBrowser = async () => {
    const qrMerged =
      (receiptData.qrCodeContent && receiptData.qrCodeContent.trim()) ||
      (settings.qr_code_content && settings.qr_code_content.trim()) ||
      ""
    const showQrEffective = !!settings.show_qr_code || !!qrMerged
    let qrImageDataUrl: string | undefined
    if (showQrEffective && qrMerged) {
      try {
        qrImageDataUrl = await retailReceiptQrDataUrl(qrMerged, settings.printer_width)
      } catch {
        qrImageDataUrl = undefined
      }
    }
    const html = generateReceiptHTML(
      { ...receiptData, qrCodeContent: qrMerged || undefined },
      {
        width: settings.printer_width,
        mode: settings.receipt_mode,
        showLogo: settings.show_logo,
        showQR: showQrEffective,
        footerText: settings.footer_text,
        qrImageDataUrl,
      }
    )

    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      throw new Error("Popup blocked. Please allow popups for this site.")
    }

    printWindow.document.write(html)
    printWindow.document.close()

    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print()
        setTimeout(() => {
          printWindow.close()
        }, 1000)
      }, 250)
    }
  }

  return (
    <div>
      <button
        onClick={handlePrint}
        disabled={printing}
        className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {printing ? "Printing..." : "Print Receipt"}
      </button>
      {error && <div className="mt-2 text-red-600 text-sm">{error}</div>}
    </div>
  )
}
