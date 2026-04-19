"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getCurrencySymbol } from "@/lib/currency"
import { generateReceiptHTML, type ReceiptData, type PrinterWidth, type ReceiptMode } from "@/lib/escpos"
import ReceiptPrinter from "@/components/ReceiptPrinter"
import {
  mapRetailReceiptApiToEscpos,
  type RetailReceiptApiBody,
} from "@/app/retail/lib/mapRetailReceiptApiToEscpos"
import Button from "@/components/ui/Button"
import { retailPaths } from "@/lib/retail/routes"
import { retailReceiptQrDataUrl } from "@/lib/receipt/retailReceiptQrDataUrl"

const DEFAULT_RECEIPT_SETTINGS = {
  printer_type: "browser_print" as const,
  printer_width: "58mm" as PrinterWidth,
  auto_cut: false,
  drawer_kick: false,
  show_logo: true,
  receipt_mode: "full" as ReceiptMode,
  footer_text: "",
  show_qr_code: false,
  qr_code_content: "",
}

type ReceiptPrinterSettings = {
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

const POS_HREF = "/retail/pos"

export function RetailSaleReceiptView() {
  const params = useParams()
  const searchParams = useSearchParams()
  const saleId = params.id as string
  const fromPos = searchParams.get("from") === "pos"

  const printTriggerRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [printerSettings, setPrinterSettings] =
    useState<ReceiptPrinterSettings>(DEFAULT_RECEIPT_SETTINGS)
  const [qrImageDataUrl, setQrImageDataUrl] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setReceiptData(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Please sign in to view this receipt.")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business?.id) {
        setError("Select a business workspace to view receipts.")
        setLoading(false)
        return
      }

      const currencyCode = (business.default_currency as string | null)?.trim() || "GHS"
      const currencySymbol = getCurrencySymbol(currencyCode) || currencyCode

      let settings: ReceiptPrinterSettings = { ...DEFAULT_RECEIPT_SETTINGS }
      const { data: rs, error: rsErr } = await supabase
        .from("receipt_settings")
        .select("*")
        .eq("business_id", business.id)
        .maybeSingle()

      if (!rsErr && rs) {
        settings = {
          printer_type: (rs.printer_type as ReceiptPrinterSettings["printer_type"]) || "browser_print",
          printer_width: (rs.printer_width as PrinterWidth) || "58mm",
          auto_cut: !!rs.auto_cut,
          drawer_kick: !!rs.drawer_kick,
          show_logo: rs.show_logo !== undefined ? !!rs.show_logo : true,
          receipt_mode: (rs.receipt_mode as ReceiptMode) || "full",
          footer_text: rs.footer_text || "",
          show_qr_code: !!rs.show_qr_code,
          qr_code_content: rs.qr_code_content || "",
        }
      }

      const url = `/api/sales-history/${encodeURIComponent(saleId)}/receipt?user_id=${encodeURIComponent(user.id)}&business_id=${encodeURIComponent(business.id)}`
      const res = await fetch(url)
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
      } & Partial<RetailReceiptApiBody>

      if (!res.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : `Could not load receipt (${res.status}).`
        )
        setLoading(false)
        return
      }

      if (!payload.sale || !payload.business) {
        setError("Invalid receipt response.")
        setLoading(false)
        return
      }

      const data = mapRetailReceiptApiToEscpos(
        payload as RetailReceiptApiBody,
        currencyCode,
        currencySymbol
      )
      setReceiptData(data)
      setPrinterSettings(settings)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load receipt.")
    } finally {
      setLoading(false)
    }
  }, [saleId])

  useEffect(() => {
    if (saleId) load()
  }, [saleId, load])

  /** Retail default when receipt_settings.footer_text is empty */
  const printerSettingsEffective = useMemo(
    () => ({
      ...printerSettings,
      footer_text:
        (printerSettings.footer_text || "").trim() ||
        "Thank you for your purchase.",
    }),
    [printerSettings]
  )

  useEffect(() => {
    if (!receiptData) {
      setQrImageDataUrl(undefined)
      return
    }
    const qrMerged =
      (receiptData.qrCodeContent && receiptData.qrCodeContent.trim()) ||
      (printerSettings.qr_code_content && printerSettings.qr_code_content.trim()) ||
      ""
    const showQrEffective = !!printerSettings.show_qr_code || !!qrMerged
    if (!showQrEffective || !qrMerged) {
      setQrImageDataUrl(undefined)
      return
    }
    let cancelled = false
    void retailReceiptQrDataUrl(qrMerged, printerSettings.printer_width)
      .then((url) => {
        if (!cancelled) setQrImageDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrImageDataUrl(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [receiptData, printerSettings])

  const previewHtml = useMemo(() => {
    if (!receiptData) return null
    try {
      const qrMerged =
        (receiptData.qrCodeContent && receiptData.qrCodeContent.trim()) ||
        (printerSettingsEffective.qr_code_content && printerSettingsEffective.qr_code_content.trim()) ||
        ""
      const showQrEffective = !!printerSettingsEffective.show_qr_code || !!qrMerged
      return generateReceiptHTML(
        { ...receiptData, qrCodeContent: qrMerged || undefined },
        {
          width: printerSettingsEffective.printer_width,
          mode: printerSettingsEffective.receipt_mode,
          showLogo: printerSettingsEffective.show_logo,
          showQR: showQrEffective,
          footerText: printerSettingsEffective.footer_text,
          qrImageDataUrl,
        }
      )
    } catch {
      return null
    }
  }, [receiptData, printerSettingsEffective, qrImageDataUrl])

  const triggerPrint = useCallback(() => {
    const btn = printTriggerRef.current?.querySelector("button")
    btn?.click()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6">
        <p className="text-muted-foreground">Loading receipt…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <p className="text-destructive mb-4">{error}</p>
        <Link
          href="/retail/sales-history"
          className="text-primary text-sm underline"
        >
          Back to sales history
        </Link>
      </div>
    )
  }

  if (!receiptData) {
    return null
  }

  const posLinkClass =
    "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-all sm:w-auto " +
    (fromPos
      ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      : "border-2 border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800")

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
        <Link href={POS_HREF} className={posLinkClass} prefetch>
          Back to POS
        </Link>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
          onClick={triggerPrint}
        >
          Print Receipt
        </Button>
        <Link
          href={POS_HREF}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-gray-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:w-auto"
          prefetch
        >
          {fromPos ? "Sell another item" : "New sale"}
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href="/retail/sales-history"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Sales history
        </Link>
      </div>

      <h1 className="mb-4 text-lg font-semibold">Sale receipt</h1>

      <p className="text-muted-foreground mb-4 text-sm">
        Find this sale in{" "}
        <Link href={retailPaths.salesHistoryLookup(saleId)} className="font-medium text-slate-900 underline underline-offset-2">
          Sales history
        </Link>
        {" · "}
        <Link href={retailPaths.salesHistoryRefund(saleId)} className="font-medium text-amber-900 underline underline-offset-2">
          Start refund
        </Link>
      </p>

      {previewHtml ? (
        <div className="mb-6 overflow-hidden rounded-md border bg-white">
          <iframe
            title="Receipt preview"
            className="h-[min(70vh,520px)] w-full border-0"
            srcDoc={previewHtml}
          />
        </div>
      ) : (
        <p className="text-muted-foreground mb-4 text-sm">
          Preview unavailable. Use Print above — ensure business currency is set in Business Profile if printing fails.
        </p>
      )}

      <div ref={printTriggerRef} className="sr-only" aria-hidden>
        <ReceiptPrinter
          receiptData={receiptData}
          settings={printerSettingsEffective}
        />
      </div>
    </div>
  )
}
