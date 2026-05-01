"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { formatMoney, formatMoneyWithSymbol } from "@/lib/money"

type PublicPayment = { reference?: string | null; public_token?: string | null; date?: string }

const PAY_LINK_UNAVAILABLE =
  "This payment link is no longer available. Please use the invoice link sent by the business."

export default function PaymentSuccessPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const invoiceId = (params?.invoiceId as string) || ""
  const publicToken = (searchParams.get("token") ?? "").trim()
  const [invoice, setInvoice] = useState<{
    invoice_number: string
    total: number
    currency_code?: string | null
    currency_symbol?: string | null
    public_token?: string | null
  } | null>(null)
  const [payments, setPayments] = useState<PublicPayment[]>([])

  useEffect(() => {
    if (!invoiceId || !publicToken) return
    const load = async () => {
      try {
        const response = await fetch(
          `/api/public/invoice/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(publicToken)}`
        )
        if (!response.ok) return
        const data = await response.json()
        if (data.invoice) setInvoice(data.invoice)
        setPayments(data.payments || [])
      } catch {
        /* ignore — show generic success copy */
      }
    }
    void load()
  }, [invoiceId, publicToken])

  const receiptPublicToken = useMemo(() => {
    if (!payments.length) return null
    const sorted = [...payments].sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    )
    const withTok = sorted.find((p) => p.public_token)
    return (withTok?.public_token as string) || null
  }, [payments])

  const openReceipt = (opts?: { savePdf?: boolean }) => {
    if (!receiptPublicToken) return
    const qs = opts?.savePdf ? "?savePdf=1" : ""
    window.open(
      `${window.location.origin}/receipt-public/${encodeURIComponent(receiptPublicToken)}${qs}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  if (!publicToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <p className="text-gray-800 text-sm leading-relaxed">{PAY_LINK_UNAVAILABLE}</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Go home
          </button>
        </div>
      </div>
    )
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
          <>
            Your payment
            {invoice ? (
              <>
                {" "}
                of{" "}
                {invoice.currency_code
                  ? formatMoney(invoice.total, invoice.currency_code)
                  : formatMoneyWithSymbol(invoice.total, invoice.currency_symbol || "")}{" "}
              </>
            ) : null}{" "}
            has been processed successfully.
          </>
        </p>
        {invoice && publicToken ? (
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm text-gray-600">Invoice Number</p>
            <p className="font-semibold text-gray-900">{invoice.invoice_number}</p>
          </div>
        ) : null}
        <div className="space-y-3">
          {receiptPublicToken && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openReceipt()}
                className="w-full bg-emerald-600 text-white px-6 py-3 rounded-lg hover:bg-emerald-700 transition-colors font-medium"
              >
                View receipt
              </button>
              <button
                type="button"
                onClick={() => openReceipt({ savePdf: true })}
                className="w-full border border-slate-300 bg-white text-slate-800 px-6 py-3 rounded-lg hover:bg-slate-50 transition-colors font-medium"
              >
                Download receipt
              </button>
            </div>
          )}
          {invoice?.public_token && publicToken && (
            <button
              type="button"
              onClick={() =>
                router.push(`/invoice-public/${encodeURIComponent(String(invoice.public_token))}`)
              }
              className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              View Invoice
            </button>
          )}
          <button
            type="button"
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
