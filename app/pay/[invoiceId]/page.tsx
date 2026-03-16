"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { normalizeCountry, getAllowedProviders } from "@/lib/payments/eligibility"
import { useToast } from "@/components/ui/ToastProvider"

type Invoice = {
  id: string
  invoice_number: string
  total: number
  currency_symbol: string
  status: string
  customers: {
    name: string
  } | null
  businesses?: {
    id: string
    address_country: string | null
  } | null
}

type PaymentStatus = "idle" | "initiating" | "pending" | "success" | "failed" | "cancelled"

export default function PayInvoicePage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = (params?.invoiceId as string) || ""
  const toast = useToast()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedProvider, setSelectedProvider] = useState<"mtn" | "vodafone" | "airteltigo" | null>(null)
  const [phoneNumber, setPhoneNumber] = useState("")
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("idle")
  const [paymentReference, setPaymentReference] = useState("")
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [payments, setPayments] = useState<any[]>([])
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)

  useEffect(() => {
    if (invoiceId) {
      loadInvoice()
    }
  }, [invoiceId])

  useEffect(() => {
    // Poll for payment status if payment is pending
    if (paymentStatus === "pending" && paymentReference) {
      const interval = setInterval(() => {
        checkPaymentStatus()
      }, 3000) // Check every 3 seconds

      return () => clearInterval(interval)
    }
  }, [paymentStatus, paymentReference])

  const loadInvoice = async () => {
    try {
      setLoading(true)
      setError("")

      const response = await fetch(`/api/invoices/${invoiceId}`)
      if (!response.ok) {
        throw new Error("Invoice not found")
      }

      const data = await response.json()
      if (!data.invoice) {
        throw new Error("Invoice data not available")
      }

      setInvoice(data.invoice)
      setPayments(data.payments || [])
      
      // Extract business country for payment provider gating
      const country = data.invoice.businesses?.address_country || null
      setBusinessCountry(country)
      console.log("[Public Payment] Business country:", country)

      // Generate QR code URL
      const payUrl = `${window.location.origin}/pay/${invoiceId}`
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payUrl)}`
      setQrCodeUrl(qrUrl)
    } catch (err: any) {
      setError(err.message || "Failed to load invoice")
    } finally {
      setLoading(false)
    }
  }

  const checkPaymentStatus = async () => {
    if (!paymentReference) return

    try {
      const response = await fetch(`/api/payments/momo/status?reference=${paymentReference}`)
      if (response.ok) {
        const data = await response.json()
        if (data.status === "SUCCESS" || data.status === "success") {
          setPaymentStatus("success")
          // Reload invoice to get updated status
          setTimeout(() => {
            loadInvoice()
          }, 1000)
        } else if (data.status === "FAILED" || data.status === "failed") {
          setPaymentStatus("failed")
        }
      }
    } catch (err) {
      console.error("Error checking payment status:", err)
    }
  }

  const handleInitiatePayment = async () => {
    if (!selectedProvider) {
      setError("Please select a Mobile Money provider")
      return
    }

    if (!phoneNumber || phoneNumber.length < 10) {
      setError("Please enter a valid phone number")
      return
    }

    try {
      setError("")
      setPaymentStatus("initiating")

      const response = await fetch("/api/payments/momo/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: invoiceId,
          provider: selectedProvider,
          phone_number: phoneNumber,
        }),
      })

      if (!response.ok) {
        // Try to parse JSON error response
        let errorData: any = {}
        let responseText = ""
        
        try {
          // Clone response to avoid consuming it
          const clonedResponse = response.clone()
          responseText = await clonedResponse.text()
          
          if (responseText) {
            try {
              errorData = JSON.parse(responseText)
            } catch (jsonError) {
              // Not JSON, use as plain text
              errorData = {
                message: responseText,
                error: "Invalid JSON response"
              }
            }
          } else {
            // Empty response
            errorData = {
              message: `HTTP ${response.status}: ${response.statusText}`,
              error: "Empty response from server"
            }
          }
        } catch (parseError: any) {
          // If reading fails completely
          console.error("Failed to read error response:", parseError)
          errorData = {
            message: `HTTP ${response.status}: ${response.statusText}`,
            error: "Failed to read error response",
            parseError: parseError.message
          }
        }
        
        // Build detailed error message with better formatting
        let errorMessage = errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`
        
        // Add additional info on new lines for better readability
        const additionalInfo: string[] = []
        
        if (errorData.details) {
          additionalInfo.push(`Details: ${errorData.details}`)
        }
        
        if (errorData.hint) {
          additionalInfo.push(`Hint: ${errorData.hint}`)
        }
        
        if (errorData.code) {
          additionalInfo.push(`Error Code: ${errorData.code}`)
        }
        
        // Combine main error with additional info
        if (additionalInfo.length > 0) {
          errorMessage += "\n\n" + additionalInfo.join("\n")
        }
        
        // Always log detailed error info for debugging - CRITICAL DEBUG INFO
        const errorLog = {
          status: response.status,
          statusText: response.statusText,
          url: response.url || "/api/payments/momo/initiate",
          error: errorData.error,
          message: errorData.message,
          details: errorData.details,
          hint: errorData.hint,
          code: errorData.code,
          fullError: errorData.fullError || errorData,
          rawResponse: responseText || "(no response text)",
          allErrorData: errorData
        }
        
        console.error("🔴 Payment initiation error:", errorLog)
        console.error("🔴 Response status:", response.status, response.statusText)
        console.error("🔴 Full error object:", JSON.stringify(errorData, null, 2))
        console.error("🔴 Raw response text:", responseText || "(empty)")
        
        // In development, show full error in console
        if (process.env.NODE_ENV === "development") {
          if (errorData.fullError) {
            console.error("Full payment error:", errorData.fullError)
          }
          console.error("Complete error data:", errorData)
          errorMessage += `\n\n(Check browser console for full error details)`
        }
        
        throw new Error(errorMessage)
      }

      const data = await response.json()
      if (data.success) {
        setPaymentReference(data.reference || "")
        setPaymentStatus("pending")
      } else {
        // Build detailed error message for success=false case
        let errorMessage = data.error || data.message || "Failed to initiate payment"
        if (data.details) errorMessage += `\nDetails: ${data.details}`
        if (data.hint) errorMessage += `\nHint: ${data.hint}`
        
        console.error("Payment initiation failed:", data)
        throw new Error(errorMessage)
      }
    } catch (err: any) {
      setError(err.message || "Failed to initiate payment")
      setPaymentStatus("idle")
      console.error("Payment initiation exception:", err)
    }
  }

  const formatPhoneNumber = (value: string) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, "")
    // Format as 0XX XXX XXXX
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`
    if (digits.length <= 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (error && !invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Invoice Not Found</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    )
  }

  if (!invoice) return null

  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const remainingBalance = Number(invoice.total) - totalPaid

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Pay Invoice</h1>
          <p className="text-gray-600">Invoice #{invoice.invoice_number}</p>
        </div>

        {/* Invoice Summary Card */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
            <div>
              <p className="text-sm text-gray-600">Customer</p>
              <p className="font-semibold text-gray-900">{invoice.customers?.name || "No Customer"}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Total Amount</p>
              <p className="text-2xl font-bold text-gray-900">
                {invoice.currency_symbol}{Number(invoice.total).toFixed(2)}
              </p>
            </div>
          </div>

          {remainingBalance > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-sm text-orange-800">
                <strong>Remaining Balance:</strong> {invoice.currency_symbol}{remainingBalance.toFixed(2)}
              </p>
            </div>
          )}

          {invoice.status === "paid" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800 font-medium">✓ This invoice has been paid</p>
            </div>
          )}
        </div>

        {/* Payment Status Messages */}
        {paymentStatus === "success" && (
          <div className="bg-green-50 border-l-4 border-green-400 text-green-700 p-4 rounded mb-6">
            <div className="flex items-center">
              <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-semibold">Payment Successful!</p>
                <p className="text-sm">Your payment has been processed. You will receive a confirmation shortly.</p>
              </div>
            </div>
          </div>
        )}

        {paymentStatus === "failed" && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 p-4 rounded mb-6">
            <div className="flex items-center">
              <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-semibold">Payment Failed</p>
                <p className="text-sm">Please try again or contact support if the problem persists.</p>
              </div>
            </div>
          </div>
        )}

        {paymentStatus === "pending" && (
          <div className="bg-blue-50 border-l-4 border-blue-400 text-blue-700 p-4 rounded mb-6">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-2"></div>
              <div>
                <p className="font-semibold">Processing Payment...</p>
                <p className="text-sm">Please approve the payment request on your phone. This page will update automatically.</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 p-4 rounded mb-6">
            <div className="flex items-start">
              <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="font-semibold mb-1">Payment Error</p>
                <div className="text-sm whitespace-pre-wrap">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Payment Form */}
        {invoice.status !== "paid" && remainingBalance > 0 && paymentStatus !== "success" && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Pay with Mobile Money</h2>

            {/* Provider Selection - Ghana-only providers */}
            {(() => {
              const countryCode = normalizeCountry(businessCountry)
              const allowedProviders = getAllowedProviders(countryCode)
              const isGhana = countryCode === "GH"
              const canUseMTN = allowedProviders.includes("mtn_momo")
              
              // Only show Ghana providers if business is Ghana
              if (!isGhana || !canUseMTN) {
                return (
                  <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-yellow-800">
                      Mobile Money payment is not available for businesses outside Ghana. Please contact the business for alternative payment methods.
                    </p>
                  </div>
                )
              }
              
              return (
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">Select Provider</label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => setSelectedProvider("mtn")}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        selectedProvider === "mtn"
                          ? "border-yellow-500 bg-yellow-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="text-2xl mb-2">📱</div>
                      <div className="text-sm font-medium">MTN</div>
                    </button>
                    <button
                      onClick={() => setSelectedProvider("vodafone")}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        selectedProvider === "vodafone"
                          ? "border-red-500 bg-red-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="text-2xl mb-2">📱</div>
                      <div className="text-sm font-medium">Vodafone</div>
                    </button>
                    <button
                      onClick={() => setSelectedProvider("airteltigo")}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        selectedProvider === "airteltigo"
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="text-2xl mb-2">📱</div>
                      <div className="text-sm font-medium">AirtelTigo</div>
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Phone Number Input */}
            {selectedProvider && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Phone Number ({selectedProvider.toUpperCase()})
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(formatPhoneNumber(e.target.value))}
                  placeholder="0XX XXX XXXX"
                  maxLength={14}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                />
                <p className="text-xs text-gray-500 mt-1">Enter your {selectedProvider.toUpperCase()} Mobile Money number</p>
              </div>
            )}

            {/* Pay Button */}
            {selectedProvider && phoneNumber.length >= 10 && (
              <button
                onClick={handleInitiatePayment}
                disabled={paymentStatus === "initiating" || paymentStatus === "pending"}
                className="w-full bg-gradient-to-r from-green-600 to-green-700 text-white px-6 py-4 rounded-lg font-semibold text-lg shadow-lg hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {paymentStatus === "initiating" ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Initiating Payment...</span>
                  </>
                ) : paymentStatus === "pending" ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Waiting for Approval...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span>Pay {invoice.currency_symbol}{remainingBalance > 0 ? remainingBalance.toFixed(2) : Number(invoice.total).toFixed(2)}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* QR Code Section */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Scan to Pay</h3>
          {qrCodeUrl && (
            <div className="flex justify-center mb-4">
              <img src={qrCodeUrl} alt="Payment QR Code" className="border-2 border-gray-200 rounded-lg p-2" />
            </div>
          )}
          <p className="text-sm text-gray-600 mb-4">Scan this QR code with your mobile money app</p>
          <button
            onClick={() => {
              const payUrl = `${window.location.origin}/pay/${invoiceId}`
              navigator.clipboard.writeText(payUrl)
              toast.showToast("Payment link copied to clipboard!", "success")
            }}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Copy Payment Link
          </button>
        </div>
      </div>
    </div>
  )
}
