"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"

type Payment = {
  id: string
  amount: number
  date: string
  method: string
  reference: string | null
  notes: string | null
  invoices: {
    invoice_number: string
    total: number
    customers: {
      name: string
      email: string | null
      phone: string | null
      whatsapp_phone: string | null
    } | null
  } | null
}

type Business = {
  legal_name: string | null
  trading_name: string | null
  address_street: string | null
  address_city: string | null
  address_region: string | null
  address_country: string | null
  phone: string | null
  whatsapp_phone: string | null
  email: string | null
  website: string | null
  tin: string | null
  logo_url: string | null
}

export default function PublicReceiptPage() {
  const params = useParams()
  const token = params.token as string
  const [loading, setLoading] = useState(true)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [remainingBalance, setRemainingBalance] = useState(0)
  const [error, setError] = useState("")

  useEffect(() => {
    loadReceipt()
  }, [token])

  const loadReceipt = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/receipts/public/${token}`)
      
      if (!response.ok) {
        throw new Error("Receipt not found")
      }

      const data = await response.json()
      setPayment(data.payment)
      setBusiness(data.business)
      setRemainingBalance(data.remainingBalance || 0)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load receipt")
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading receipt...</p>
        </div>
      </div>
    )
  }

  if (error || !payment) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg">{error || "Receipt not found"}</p>
        </div>
      </div>
    )
  }

  const businessName = business?.trading_name || business?.legal_name || "Business"
  const businessAddress = [
    business?.address_street,
    business?.address_city,
    business?.address_region,
    business?.address_country,
  ]
    .filter(Boolean)
    .join(", ")

  const formatMethod = (method: string) => {
    const methods: Record<string, string> = {
      cash: "Cash",
      bank: "Bank Transfer",
      momo: "Mobile Money",
      card: "Card Payment",
      cheque: "Cheque",
      paystack: "Paystack",
      other: "Other",
    }
    return methods[method] || method
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
        {/* Header */}
        <div className="border-b-2 border-gray-200 pb-6 mb-6">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="mb-4">
                <BusinessLogoDisplay
                  logoUrl={business?.logo_url}
                  businessName={businessName}
                  size="xl"
                  rounded="lg"
                />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{businessName}</h1>
              {businessAddress && (
                <p className="text-gray-600 text-sm mt-1">{businessAddress}</p>
              )}
            </div>
            <div className="text-right">
              <h2 className="text-3xl font-bold text-gray-900">PAYMENT RECEIPT</h2>
            </div>
          </div>
        </div>

        {/* Payment Details */}
        <div className="mb-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <p className="text-green-800 font-semibold text-center text-lg">
              Payment Received: ₵{Number(payment.amount).toFixed(2)}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Invoice Number:</span>
              <span className="font-medium text-gray-900">#{payment.invoices?.invoice_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Customer:</span>
              <span className="font-medium text-gray-900">{payment.invoices?.customers?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Payment Date:</span>
              <span className="font-medium text-gray-900">
                {new Date(payment.date).toLocaleDateString("en-GH")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Payment Method:</span>
              <span className="font-medium text-gray-900">{formatMethod(payment.method)}</span>
            </div>
            {payment.reference && (
              <div className="flex justify-between">
                <span className="text-gray-600">Reference:</span>
                <span className="font-medium text-gray-900">{payment.reference}</span>
              </div>
            )}
            {payment.method === "momo" && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mt-2">
                <p className="text-yellow-800 text-xs">
                  Note: E-Levy (1.5%) may apply to mobile money transactions
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Balance Information */}
        {remainingBalance > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-blue-800 text-sm">
              <strong>Remaining Balance:</strong> ₵{remainingBalance.toFixed(2)}
            </p>
          </div>
        )}

        {remainingBalance === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="text-green-800 text-sm font-semibold text-center">
              ✓ Invoice Fully Paid
            </p>
          </div>
        )}

        {/* Notes */}
        {payment.notes && (
          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Notes:</h3>
            <p className="text-gray-700 text-sm">{payment.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-6 mt-6">
          <p className="text-gray-600 text-sm text-center">
            Thank you for your payment.
          </p>
        </div>
      </div>
    </div>
  )
}

