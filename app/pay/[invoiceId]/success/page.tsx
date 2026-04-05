"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { formatMoney, formatMoneyWithSymbol } from "@/lib/money"

export default function PaymentSuccessPage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = (params?.invoiceId as string) || ""
  const [invoice, setInvoice] = useState<any>(null)

  useEffect(() => {
    if (invoiceId) {
      loadInvoice()
    }
  }, [invoiceId])

  const loadInvoice = async () => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoice(data.invoice)
      }
    } catch (err) {
      console.error("Error loading invoice:", err)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h2>
        <p className="text-gray-600 mb-6">
          Your payment of {invoice
            ? invoice.currency_code
              ? formatMoney(invoice.total, invoice.currency_code)
              : formatMoneyWithSymbol(invoice.total, invoice.currency_symbol || "")
            : ""} has been processed successfully.
        </p>
        {invoice && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm text-gray-600">Invoice Number</p>
            <p className="font-semibold text-gray-900">{invoice.invoice_number}</p>
          </div>
        )}
        <div className="space-y-3">
          <button
            onClick={() => router.push(`/invoice-public/${invoice?.public_token}`)}
            className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            View Invoice
          </button>
          <button
            onClick={() => router.push("/")}
            className="w-full border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

