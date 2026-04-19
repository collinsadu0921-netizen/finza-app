"use client"

import { useState } from "react"
import { ESCPOSGenerator, generateReceiptHTML, type ReceiptData, type PrinterWidth, type ReceiptMode } from "@/lib/escpos"
import { retailReceiptQrDataUrl } from "@/lib/receipt/retailReceiptQrDataUrl"

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
        await printESCPOS()
      } else {
        await printBrowser()
      }
      onPrintComplete?.()
    } catch (err: any) {
      setError(err.message || "Failed to print receipt")
      console.error("Print error:", err)
    } finally {
      setPrinting(false)
    }
  }

  const printESCPOS = async () => {
    // Check for Web Serial API support
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API not supported. Please use Chrome/Edge browser.")
    }

    try {
      // Request port access
      const port = await (navigator as any).serial.requestPort()

      // Open port with baud rate 9600 (common for thermal printers)
      await port.open({ baudRate: 9600 })

      // Generate ESC/POS commands
      const showQrEffective = !!settings.show_qr_code || !!receiptData.qrCodeContent
      const generator = new ESCPOSGenerator(
        settings.printer_width,
        settings.receipt_mode,
        settings.auto_cut,
        settings.drawer_kick,
        settings.show_logo,
        showQrEffective
      )

      const qrMerged =
        (receiptData.qrCodeContent && receiptData.qrCodeContent.trim()) ||
        (settings.qr_code_content && settings.qr_code_content.trim()) ||
        ""

      const commands = generator.generate({
        ...receiptData,
        footerText: settings.footer_text,
        qrCodeContent: qrMerged || undefined,
      })

      // Write to printer
      const writer = port.writable.getWriter()
      await writer.write(commands)
      writer.releaseLock()

      // Close port
      await port.close()
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        throw new Error("No printer selected or printer not found")
      } else if (err.name === "SecurityError") {
        throw new Error("Permission denied. Please allow access to the printer.")
      } else {
        throw err
      }
    }
  }

  const printBrowser = async () => {
    // Generate HTML receipt
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

    // Open print window
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      throw new Error("Popup blocked. Please allow popups for this site.")
    }

    printWindow.document.write(html)
    printWindow.document.close()

    // Wait for content to load, then print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print()
        // Close window after print dialog closes (user may cancel)
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
      {error && (
        <div className="mt-2 text-red-600 text-sm">{error}</div>
      )}
    </div>
  )
}







