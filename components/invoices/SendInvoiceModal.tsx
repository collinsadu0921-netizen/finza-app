"use client"

import { useState, useEffect } from "react"
import SendMethodDropdown, { SendMethod } from "./SendMethodDropdown"
import { normalizePhoneForWaMe } from "@/lib/communication/whatsappLink"

type Invoice = {
  id: string
  public_token?: string | null
  customers?: {
    email?: string
    phone?: string
    whatsapp_phone?: string
  } | null
}

export default function SendInvoiceModal({
  invoice,
  invoiceId,
  onClose,
  onSuccess,
  defaultMethod = "whatsapp",
}: {
  invoice: Invoice
  invoiceId: string
  onClose: () => void
  onSuccess: () => void
  defaultMethod?: SendMethod
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [email, setEmail] = useState(invoice.customers?.email || "")
  const [sendMethod, setSendMethod] = useState<SendMethod>(defaultMethod)
  const [whatsappConnected, setWhatsappConnected] = useState(false)
  const [checkingWhatsApp, setCheckingWhatsApp] = useState(true)

  useEffect(() => {
    // Check WhatsApp connection status
    const checkWhatsAppStatus = async () => {
      try {
        const response = await fetch("/api/whatsapp/status")
        if (response.ok) {
          const data = await response.json()
          setWhatsappConnected(data.connected || false)
        }
      } catch (error) {
        console.error("Error checking WhatsApp status:", error)
        // Default to false if check fails
        setWhatsappConnected(false)
      } finally {
        setCheckingWhatsApp(false)
      }
    }

    checkWhatsAppStatus()
  }, [])

  const publicInvoiceUrl = invoice.public_token
    ? `${window.location.origin}/invoice-public/${invoice.public_token}`
    : ""

  const handleSendWhatsApp = async () => {
    try {
      setLoading(true)
      setError("")

      const customer = invoice.customers
      const phone = customer?.whatsapp_phone || customer?.phone

      if (!phone) {
        setError("Customer phone number is not available. Please add a phone number to the customer profile.")
        setLoading(false)
        return
      }

      const phoneCheck = normalizePhoneForWaMe(phone)
      if (!phoneCheck.ok) {
        setError(phoneCheck.error)
        setLoading(false)
        return
      }

      let response: Response
      try {
        response = await fetch(`/api/invoices/${invoiceId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sendWhatsApp: true,
            sendMethod: sendMethod,
          }),
        })
      } catch (fetchError: any) {
        console.error("Fetch error:", fetchError)
        throw new Error("Network error. Please check your connection and try again.")
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const friendlyError = errorData.error || "We couldn't send the invoice. Please check the customer's phone number and try again."
        throw new Error(friendlyError)
      }

      const data = await response.json()

      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank", "noopener,noreferrer")
      }

      // INVARIANT 6: onSuccess triggers parent rehydration - no optimistic updates
      onSuccess()
    } catch (err: any) {
      const friendlyError = err.message || "We couldn't send the invoice. Please check the customer's phone number and try again."
      setError(friendlyError)
      setLoading(false)
    }
  }

  const handleSendEmail = async () => {
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
          body: JSON.stringify({
            sendEmail: true,
            email: email,
            sendMethod: sendMethod,
          }),
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

      onSuccess()
    } catch (err: any) {
      setError(err.message || "We couldn't send the email. Please check the email address and try again.")
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
          body: JSON.stringify({
            copyLink: true,
            sendMethod: sendMethod,
          }),
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

      switch (sendMethod) {
        case "whatsapp":
          await handleSendWhatsApp()
          break
        case "email":
          if (!email) {
            setError("Please enter an email address")
            setLoading(false)
            return
          }
          await handleSendEmail()
          break
        case "both":
          // Send email first, then WhatsApp
          if (!email) {
            setError("Please enter an email address for email sending")
            setLoading(false)
            return
          }
          await handleSendEmail()
          // Small delay to ensure email is sent
          await new Promise(resolve => setTimeout(resolve, 500))
          await handleSendWhatsApp()
          break
        case "link":
          await handleCopyLink()
          return // handleCopyLink already calls onSuccess/onClose
        default:
          await handleSendWhatsApp()
      }
    } catch (err: any) {
      setError(err.message || "Failed to send invoice")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Send Invoice</h2>
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

        <div className="space-y-4">
          {/* Send Method Dropdown + Send Button */}
          <div className="flex items-center gap-2">
            <SendMethodDropdown
              value={sendMethod}
              onChange={setSendMethod}
              className="flex-1"
              whatsappConnected={whatsappConnected}
            />
            <button
              onClick={handleSendInvoice}
              disabled={
                loading ||
                checkingWhatsApp ||
                (sendMethod !== "link" &&
                  sendMethod !== "whatsapp" &&
                  !email)
              }
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 font-medium shadow-lg transition-all"
            >
              {loading ? "Sending..." : "Send Invoice"}
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

          {/* Info for WhatsApp - Not Connected (link still opens for manual send) */}
          {!checkingWhatsApp && !whatsappConnected && (sendMethod === "whatsapp" || sendMethod === "both") && (
            <div className="bg-blue-50 border-l-4 border-blue-400 text-blue-700 px-4 py-3 rounded text-sm">
              <p className="font-medium mb-1">WhatsApp integration is not connected</p>
              <p className="text-xs">
                A WhatsApp link will open so you can send the invoice manually. To connect for automated sending, go to{" "}
                <a
                  href="/settings/integrations/whatsapp"
                  className="underline font-medium"
                  onClick={(e) => {
                    e.preventDefault()
                    window.open("/settings/integrations/whatsapp", "_blank")
                  }}
                >
                  Settings → Integrations → WhatsApp
                </a>
              </p>
            </div>
          )}

          {/* Info for WhatsApp - No Phone */}
          {whatsappConnected && sendMethod === "whatsapp" && !invoice.customers?.phone && !invoice.customers?.whatsapp_phone && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700 px-4 py-3 rounded text-sm">
              Customer phone number is not available. Please add a phone number to the customer profile.
            </div>
          )}

          {/* Info for Both */}
          {whatsappConnected && sendMethod === "both" && !invoice.customers?.phone && !invoice.customers?.whatsapp_phone && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700 px-4 py-3 rounded text-sm">
              Customer phone number is not available for WhatsApp. Email will still be sent.
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

