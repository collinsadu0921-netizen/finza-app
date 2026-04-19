/**

 * Browser print for a retail sale receipt (same HTML path as ReceiptPrinter browser mode).

 * Used from POS success modal without navigating away.

 */

"use client"



import { supabase } from "@/lib/supabaseClient"

import { getCurrentBusiness } from "@/lib/business"

import { getCashierPosToken } from "@/lib/cashierSession"

import { getCurrencySymbol } from "@/lib/currency"

import { generateReceiptHTML, type PrinterWidth, type ReceiptMode } from "@/lib/escpos"
import { retailReceiptQrDataUrl } from "@/lib/receipt/retailReceiptQrDataUrl"

import {

  mapRetailReceiptApiToEscpos,

  type RetailReceiptApiBody,

} from "@/app/retail/lib/mapRetailReceiptApiToEscpos"



export type PrintRetailReceiptResult =

  | { ok: true }

  | { ok: false; message: string }



type ReceiptApiExtras = {

  default_currency?: string | null

  receipt_settings?: Record<string, unknown> | null

}



function buildPrintWindow(html: string): PrintRetailReceiptResult {

  const printWindow = window.open("", "_blank")

  if (!printWindow) {

    return {

      ok: false,

      message: "Popup blocked. Allow popups for this site to print.",

    }

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



  return { ok: true }

}



export async function printRetailSaleReceiptInBrowser(

  saleId: string

): Promise<PrintRetailReceiptResult> {

  const posToken = getCashierPosToken()

  const {

    data: { user },

  } = await supabase.auth.getUser()



  if (user) {

    const business = await getCurrentBusiness(supabase, user.id)

    if (!business?.id) {

      return { ok: false, message: "Select a business to print receipts." }

    }



    const currencyCode = (business.default_currency as string | null)?.trim() || "GHS"

    const currencySymbol = getCurrencySymbol(currencyCode) || currencyCode



    const { data: rs } = await supabase

      .from("receipt_settings")

      .select("*")

      .eq("business_id", business.id)

      .maybeSingle()



    const footerText =

      (rs?.footer_text && String(rs.footer_text).trim()) ||

      "Thank you for your purchase."



    const res = await fetch(

      `/api/sales-history/${encodeURIComponent(saleId)}/receipt?user_id=${encodeURIComponent(user.id)}&business_id=${encodeURIComponent(business.id)}`

    )

    const payload = (await res.json().catch(() => ({}))) as {

      error?: string

    } & Partial<RetailReceiptApiBody>



    if (!res.ok) {

      return {

        ok: false,

        message:

          typeof payload.error === "string"

            ? payload.error

            : `Could not load receipt (${res.status}).`,

      }

    }

    if (!payload.sale || !payload.business) {

      return { ok: false, message: "Invalid receipt data." }

    }



    const receiptData = mapRetailReceiptApiToEscpos(

      payload as RetailReceiptApiBody,

      currencyCode,

      currencySymbol

    )

    const width = ((rs?.printer_width as PrinterWidth) || "58mm") as PrinterWidth
    const qrMerged =
      (receiptData.qrCodeContent && receiptData.qrCodeContent.trim()) ||
      (typeof rs?.qr_code_content === "string" && rs.qr_code_content.trim()) ||
      ""
    const showQR = !!rs?.show_qr_code || !!qrMerged
    let qrImageDataUrl: string | undefined
    if (showQR && qrMerged) {
      try {
        qrImageDataUrl = await retailReceiptQrDataUrl(qrMerged, width)
      } catch {
        qrImageDataUrl = undefined
      }
    }

    const html = generateReceiptHTML(
      { ...receiptData, qrCodeContent: qrMerged || undefined },
      {
        width,
        mode: ((rs?.receipt_mode as ReceiptMode) || "full") as ReceiptMode,
        showLogo: rs?.show_logo !== false,
        showQR,
        footerText,
        qrImageDataUrl,
      }
    )

    return buildPrintWindow(html)

  }



  if (posToken) {

    const res = await fetch(`/api/retail/pos/receipt/${encodeURIComponent(saleId)}`, {

      headers: { Authorization: `Bearer ${posToken}` },

    })

    const payload = (await res.json().catch(() => ({}))) as {

      error?: string

    } & Partial<RetailReceiptApiBody> &

      ReceiptApiExtras



    if (!res.ok) {

      return {

        ok: false,

        message:

          typeof payload.error === "string"

            ? payload.error

            : `Could not load receipt (${res.status}).`,

      }

    }

    if (!payload.sale || !payload.business) {

      return { ok: false, message: "Invalid receipt data." }

    }



    const currencyCode =

      (typeof payload.default_currency === "string" && payload.default_currency.trim()) ||

      "GHS"

    const currencySymbol = getCurrencySymbol(currencyCode) || currencyCode



    const rs = payload.receipt_settings

    const footerText =

      rs && typeof rs.footer_text === "string" && rs.footer_text.trim()

        ? rs.footer_text.trim()

        : "Thank you for your purchase."



    const receiptData = mapRetailReceiptApiToEscpos(

      payload as RetailReceiptApiBody,

      currencyCode,

      currencySymbol

    )

    const width = ((rs?.printer_width as PrinterWidth) || "58mm") as PrinterWidth
    const rsRow = rs as { qr_code_content?: string; show_qr_code?: boolean } | null
    const qrMerged =
      (receiptData.qrCodeContent && receiptData.qrCodeContent.trim()) ||
      (rsRow?.qr_code_content && String(rsRow.qr_code_content).trim()) ||
      ""
    const showQR = !!rsRow?.show_qr_code || !!qrMerged
    let qrImageDataUrl: string | undefined
    if (showQR && qrMerged) {
      try {
        qrImageDataUrl = await retailReceiptQrDataUrl(qrMerged, width)
      } catch {
        qrImageDataUrl = undefined
      }
    }

    const html = generateReceiptHTML(
      { ...receiptData, qrCodeContent: qrMerged || undefined },
      {
        width,
        mode: ((rs?.receipt_mode as ReceiptMode) || "full") as ReceiptMode,
        showLogo: rs?.show_logo !== false,
        showQR,
        footerText,
        qrImageDataUrl,
      }
    )

    return buildPrintWindow(html)

  }



  return { ok: false, message: "Please sign in to print, or use PIN login at the register." }

}


