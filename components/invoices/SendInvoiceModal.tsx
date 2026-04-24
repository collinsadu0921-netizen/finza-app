"use client"

import { useState, useEffect } from "react"
import SendMethodDropdown, { SendMethod } from "./SendMethodDropdown"
import { normalizePhoneForWaMe } from "@/lib/communication/whatsappLink"
import {
  convertWaMeToApiSendUrl,
  openWhatsAppUrlInBrowser,
} from "@/lib/communication/openWhatsAppClient"
import { downloadInvoicePdfDocument } from "@/lib/invoices/downloadInvoicePdfClient"

type Invoice = {
  id: string
  business_id?: string | null
  public_token?: string | null
  customers?: {
    email?: string
    phone?: string
    whatsapp_phone?: string
  } | null
}

function sendPayload(
  businessId: string | null | undefined,
  extra: Record<string, unknown>,
  resendOnly: boolean
): string {
  const bid =
    typeof businessId === "string" && businessId.trim().length > 0 ? businessId.trim() : ""
  return JSON.stringify({
    ...extra,
    ...(resendOnly ? { resend_only: true } : {}),
    ...(bid ? { business_id: bid } : {}),
  })
}

export default function SendInvoiceModal({
  invoice,
  invoiceId,
  businessId,
  onClose,
  onSuccess,
  defaultMethod = "whatsapp",
  variant = "send",
}: {
  invoice: Invoice
  invoiceId: string
  /** Workspace that owns the invoice — required on server (no localStorage). Omit only for legacy single-tenant. */
  businessId?: string | null
  onClose: () => void
  onSuccess: (opts?: { issuedViaDownload?: boolean }) => void
  defaultMethod?: SendMethod
  /** `resend` — communication only; same invoice and public link, no draft→sent transition. */
  variant?: "send" | "resend"
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [email, setEmail] = useState(invoice.customers?.email || "")
  const [sendMethod, setSendMethod] = useState<SendMethod>(defaultMethod)
  /** When pop-ups are blocked, we keep the modal open with a real &lt;a href&gt; to wa.me (user click always works). */
  const [waOpenLinkUrl, setWaOpenLinkUrl] = useState<string | null>(null)

  const resolvedBusinessId = businessId ?? invoice.business_id ?? null
  const resendOnly = variant === "resend"

  useEffect(() => {
    setWaOpenLinkUrl(null)
  }, [sendMethod])

  useEffect(() => {
    if (variant === "resend") {
      setSendMethod((m) => (m === "download" ? "whatsapp" : m))
    }
  }, [variant])

  const publicInvoiceUrl = invoice.public_token
    ? `${window.location.origin}/invoice-public/${invoice.public_token}`
    : ""

  /**
   * @param waPrepWindow - Tab opened synchronously on user click (before any await) so the
   *   browser does not block navigation to https://wa.me/... after the send API returns.
   */
  const handleSendWhatsApp = async (waPrepWindow: Window | null = null) => {
    const closePrep = () => {
      try {
        if (waPrepWindow && !waPrepWindow.closed) waPrepWindow.close()
      } catch {
        /* ignore */
      }
    }

    try {
      setError("")

      const customer = invoice.customers
      const phone = customer?.whatsapp_phone || customer?.phone

      if (!phone) {
        setError("Customer phone number is not available. Please add a phone number to the customer profile.")
        setLoading(false)
        closePrep()
        return
      }

      const phoneCheck = normalizePhoneForWaMe(phone)
      if (!phoneCheck.ok) {
        setError(phoneCheck.error)
        setLoading(false)
        closePrep()
        return
      }

      let response: Response
      try {
        response = await fetch(`/api/invoices/${invoiceId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: sendPayload(
            resolvedBusinessId,
            {
              sendWhatsApp: true,
              sendMethod: sendMethod,
            },
            resendOnly
          ),
        })
      } catch (fetchError: any) {
        console.error("Fetch error:", fetchError)
        closePrep()
        throw new Error("Network error. Please check your connection and try again.")
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        closePrep()
        const friendlyError =
          errorData.error || "We couldn't send the invoice. Please check the customer's phone number and try again."
        throw new Error(friendlyError)
      }

      const data = await response.json()

      if (data.whatsappUrl && /^https:\/\/wa\.me\//i.test(String(data.whatsappUrl))) {
        const url = String(data.whatsappUrl)
        const result = openWhatsAppUrlInBrowser(url, waPrepWindow, {
          preferSameTabOnMobile: true,
          onBeforeSameTabNavigate: () => onSuccess(),
        })
        if (result === "same-tab") {
          // onSuccess already ran; tab is navigating to WhatsApp
        } else if (result === true) {
          onSuccess()
        } else {
          closePrep()
          setError("")
          setWaOpenLinkUrl(convertWaMeToApiSendUrl(url))
        }
      } else {
        closePrep()
        throw new Error("No WhatsApp link returned from server. Try again or use Copy link.")
      }
    } catch (err: any) {
      const friendlyError = err.message || "We couldn't send the invoice. Please check the customer's phone number and try again."
      setError(friendlyError)
      setLoading(false)
    }
  }

  /** @param skipOnSuccess - when sending Email+WhatsApp, defer onSuccess until WhatsApp step finishes */
  const handleSendEmail = async (skipOnSuccess = false) => {
    if (!email) {
      setError("Please enter an email address")
      return
    }

    try {
      setLoading(true)
      setError("")

      let response: Response
      try {
        response = await fetch(`/api/invoices/${invoiceId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: sendPayload(
            resolvedBusinessId,
            {
              sendEmail: true,
              email: email,
              sendMethod: sendMethod,
            },
            resendOnly
          ),
        })
      } catch (fetchError: any) {
        console.error("Fetch error:", fetchError)
        throw new Error("Network error. Please check your connection and try again.")
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const friendlyError =
          errorData.message ||
          errorData.error ||
          "We couldn't send the email. Please check the email address and try again."
        const detail = errorData.error && errorData.error !== friendlyError ? ` ${errorData.error}` : ""
        throw new Error(friendlyError + (detail ? detail : ""))
      }

      if (!skipOnSuccess) onSuccess()
    } catch (err: any) {
      setError(err.message || "We couldn't send the email. Please check the email address and try again.")
      setLoading(false)
      throw err
    }
  }

  /** Marks invoice sent (number + ledger), then downloads the PDF — draft-only on server. */
  const handleIssueAndDownload = async () => {
    setError("")
    setLoading(true)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: sendPayload(
          resolvedBusinessId,
          {
            issueAndDownload: true,
            sendMethod: "download",
          },
          false
        ),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          data.error || data.message || "Could not issue the invoice. Check accounting setup and try again."
        )
      }
      const inv = data.invoice
      await downloadInvoicePdfDocument(
        invoiceId,
        inv?.invoice_number ?? null,
        resolvedBusinessId
      )
      onSuccess({ issuedViaDownload: true })
    } catch (err: any) {
      setError(err.message || "Could not issue and download the invoice.")
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicInvoiceUrl)
      
      try {
        const response = await fetch(`/api/invoices/${invoiceId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: sendPayload(
            resolvedBusinessId,
            {
              copyLink: true,
              sendMethod: sendMethod,
            },
            resendOnly
          ),
        })

        if (!response.ok) {
          // Don't show error for copy link, just copy
          console.log("Link copied but API update failed (non-critical)")
        }
      } catch (fetchError) {
        // Don't show error for copy link API call failure
        console.log("Link copied but API call failed (non-critical):", fetchError)
      }

      onSuccess()
      onClose()
    } catch (err) {
      // Fallback if clipboard API fails
      const textArea = document.createElement("textarea")
      textArea.value = publicInvoiceUrl
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand("copy")
      document.body.removeChild(textArea)
      onSuccess()
      onClose()
    }
  }

  const handleSendInvoice = async () => {
    setError("")

    try {
      setLoading(true)

      if (resendOnly && sendMethod === "download") {
        setError("Issue & download is not available when resending. Choose email, WhatsApp, link, or both.")
        setLoading(false)
        return
      }

      if (sendMethod === "link") {
        await handleCopyLink()
        return
      }

      if (sendMethod === "download") {
        await handleIssueAndDownload()
        return
      }

      // No "noopener" — we need a real Window to assign .location.href after the API returns.
      // (Chromium returns null from window.open when noopener is set.)
      const openWaPrepTab = (): Window | null => window.open("about:blank", "_blank")

      switch (sendMethod) {
        case "whatsapp": {
          const customer = invoice.customers
          const phone = customer?.whatsapp_phone || customer?.phone
          if (!phone) {
            setError("Customer phone number is not available. Please add a phone number to the customer profile.")
            return
          }
          const waCheck = normalizePhoneForWaMe(phone)
          if (!waCheck.ok) {
            setError(waCheck.error)
            return
          }
          const waPrep = openWaPrepTab()
          await handleSendWhatsApp(waPrep)
          break
        }
        case "email":
          if (!email) {
            setError("Please enter an email address")
            return
          }
          await handleSendEmail()
          break
        case "both":
          if (!email) {
            setError("Please enter an email address for email sending")
            return
          }
          {
            const customer = invoice.customers
            const phone = customer?.whatsapp_phone || customer?.phone
            const phoneOk = phone ? normalizePhoneForWaMe(phone).ok : false
            const waPrep = phoneOk ? openWaPrepTab() : null
            await handleSendEmail(true)
            await new Promise((resolve) => setTimeout(resolve, 500))
            if (phoneOk) await handleSendWhatsApp(waPrep)
            else onSuccess()
          }
          break
        default: {
          const customer = invoice.customers
          const phone = customer?.whatsapp_phone || customer?.phone
          if (!phone) {
            setError("Customer phone number is not available. Please add a phone number to the customer profile.")
            return
          }
          const waCheck = normalizePhoneForWaMe(phone)
          if (!waCheck.ok) {
            setError(waCheck.error)
            return
          }
          const waPrep = openWaPrepTab()
          await handleSendWhatsApp(waPrep)
          break
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to send invoice")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            {resendOnly ? "Resend invoice" : "Send Invoice"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {waOpenLinkUrl && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 space-y-3">
            <p className="text-sm font-semibold text-emerald-900">
              Invoice updated. Your browser blocked an automatic window — use the button below (opens WhatsApp in a new tab).
            </p>
            <a
              href={waOpenLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full justify-center items-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition-colors"
            >
              Open WhatsApp
            </a>
            <button
              type="button"
              onClick={() => {
                setWaOpenLinkUrl(null)
                onSuccess()
              }}
              className="w-full text-sm text-emerald-800 font-medium py-2 rounded-lg hover:bg-emerald-100/80"
            >
              Done — I opened WhatsApp or will send later
            </button>
          </div>
        )}

        <div className="space-y-4">
          {/* Send Method Dropdown + Send Button */}
          <div className="flex items-center gap-2">
            <SendMethodDropdown
              value={sendMethod}
              onChange={setSendMethod}
              className="flex-1"
              showIssueAndDownloadOption={!resendOnly}
            />
            <button
              onClick={handleSendInvoice}
              disabled={
                !!waOpenLinkUrl ||
                loading ||
                (sendMethod !== "link" &&
                  sendMethod !== "whatsapp" &&
                  sendMethod !== "download" &&
                  !email)
              }
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 font-medium shadow-lg transition-all"
            >
              {loading
                ? sendMethod === "download"
                  ? "Issuing…"
                  : "Sending..."
                : sendMethod === "download"
                  ? "Issue & download"
                  : resendOnly
                    ? "Resend"
                    : "Send Invoice"}
            </button>
          </div>

          {/* Email Input (shown when email or both is selected) */}
          {(sendMethod === "email" || sendMethod === "both") && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500">
                Without a verified domain, send only to your Resend account email or use{" "}
                <code className="bg-gray-100 px-1 rounded">delivered@resend.dev</code> for testing.
              </p>
            </div>
          )}

          {/* Info for WhatsApp - No Phone */}
          {sendMethod === "whatsapp" && !invoice.customers?.phone && !invoice.customers?.whatsapp_phone && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700 px-4 py-3 rounded text-sm">
              Customer phone number is not available. Please add a phone number to the customer profile.
            </div>
          )}

          {/* Info for Both */}
          {sendMethod === "both" && !invoice.customers?.phone && !invoice.customers?.whatsapp_phone && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700 px-4 py-3 rounded text-sm">
              Customer phone number is not available for WhatsApp. Email will still be sent.
            </div>
          )}

          {sendMethod === "download" && (
            <div className="bg-slate-50 border border-slate-200 text-slate-700 px-4 py-3 rounded-lg text-sm">
              This will <strong>issue the invoice</strong> (assign an invoice number, mark as sent, and post to your
              books like other send methods), then download the document to share with your client.
            </div>
          )}

          {publicInvoiceUrl && (
            <div className="pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center">
                Public link: {publicInvoiceUrl.substring(0, 50)}...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

