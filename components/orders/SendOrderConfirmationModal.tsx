"use client"

import { useState } from "react"
import SendMethodDropdown, { SendMethod } from "../invoices/SendMethodDropdown"

type Order = {
  id: string
  public_token?: string | null
  customers?: {
    email?: string
    phone?: string
    whatsapp_phone?: string
  } | null
}

export default function SendOrderConfirmationModal({
  order,
  orderId,
  onClose,
  onSuccess,
  defaultMethod = "whatsapp",
}: {
  order: Order
  orderId: string
  onClose: () => void
  onSuccess: () => void
  defaultMethod?: SendMethod
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [email, setEmail] = useState(order.customers?.email || "")
  const [sendMethod, setSendMethod] = useState<SendMethod>(defaultMethod)

  const publicOrderUrl = order.public_token
    ? `${window.location.origin}/order-public/${order.public_token}`
    : ""

  const handleSendWhatsApp = async () => {
    try {
      setLoading(true)
      setError("")

      const customer = order.customers
      const phone = customer?.whatsapp_phone || customer?.phone

      if (!phone) {
        setError("Customer phone number is not available. Please add a phone number to the customer profile.")
        setLoading(false)
        return
      }

      let response: Response
      try {
        response = await fetch(`/api/orders/${orderId}/send`, {
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
        const friendlyError = errorData.error || "We couldn't send the order confirmation. Please check the customer's phone number and try again."
        throw new Error(friendlyError)
      }

      const data = await response.json()

      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank", "noopener,noreferrer")
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      const friendlyError = err.message || "We couldn't send the order confirmation. Please check the customer's phone number and try again."
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
        response = await fetch(`/api/orders/${orderId}/send`, {
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
        const friendlyError = errorData.error || "We couldn't send the email. Please check the email address and try again."
        throw new Error(friendlyError)
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      const friendlyError = err.message || "We couldn't send the email. Please check the email address and try again."
      setError(friendlyError)
      setLoading(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      // First, try to get or generate the public URL
      let urlToCopy = publicOrderUrl

      if (!urlToCopy) {
        // Generate public token if it doesn't exist
        try {
          const response = await fetch(`/api/orders/${orderId}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              copyLink: true,
              sendMethod: sendMethod,
            }),
          })

          if (response.ok) {
            const data = await response.json()
            urlToCopy = data.publicUrl || publicOrderUrl
          }
        } catch (fetchError) {
          console.log("Could not generate public URL, using fallback")
        }
      }

      if (urlToCopy) {
        await navigator.clipboard.writeText(urlToCopy)
      } else {
        // Fallback if no URL available
        const textArea = document.createElement("textarea")
        textArea.value = urlToCopy || ""
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand("copy")
        document.body.removeChild(textArea)
      }

      onSuccess()
      onClose()
    } catch (err) {
      // Fallback if clipboard API fails
      const textArea = document.createElement("textarea")
      textArea.value = publicOrderUrl || ""
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand("copy")
      document.body.removeChild(textArea)
      onSuccess()
      onClose()
    }
  }

  const handleSendOrderConfirmation = async () => {
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
        case "download":
          // Not offered in order UI; fallback for type safety
          await handleSendWhatsApp()
          break
        default:
          await handleSendWhatsApp()
      }
    } catch (err: any) {
      setError(err.message || "Failed to send order confirmation")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Send Order Confirmation</h2>
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
            />
            <button
              onClick={handleSendOrderConfirmation}
              disabled={loading}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? "Sending..." : "Send"}
            </button>
          </div>

          {/* Email Input (shown when email or both is selected) */}
          {(sendMethod === "email" || sendMethod === "both") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {order.customers?.email && (
                <p className="text-xs text-gray-500 mt-1">
                  Customer email: {order.customers.email}
                </p>
              )}
            </div>
          )}

          {/* Info Message */}
          <div className="bg-blue-50 border-l-4 border-blue-400 text-blue-700 px-4 py-3 rounded text-sm">
            <p className="font-medium mb-1">Order Confirmation</p>
            <p>This sends a non-financial confirmation to the customer. An invoice will be sent separately when ready.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
