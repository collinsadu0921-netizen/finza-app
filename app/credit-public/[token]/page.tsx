"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"

type CreditNote = {
  id: string
  credit_number: string
  date: string
  reason: string | null
  notes: string | null
  subtotal: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  total_tax: number
  total: number
  invoices: {
    invoice_number: string
    customers: {
      name: string
      email: string | null
      phone: string | null
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
  email: string | null
  logo_url: string | null
}

type CreditNoteItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

export default function PublicCreditNotePage() {
  const params = useParams()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [creditNote, setCreditNote] = useState<CreditNote | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [items, setItems] = useState<CreditNoteItem[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    loadCreditNote()
  }, [token])

  const loadCreditNote = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/credit-notes/public/${token}`)
      
      if (!response.ok) {
        throw new Error("Credit note not found")
      }

      const data = await response.json()
      setCreditNote(data.creditNote)
      setBusiness(data.business)
      setItems(data.items || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load credit note")
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading credit note...</p>
        </div>
      </div>
    )
  }

  if (error || !creditNote) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg">{error || "Credit note not found"}</p>
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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
        {/* Header */}
        <div className="border-b-2 border-red-200 pb-6 mb-6">
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
              <h2 className="text-3xl font-bold text-red-600">CREDIT NOTE</h2>
              <p className="text-gray-600 text-sm mt-1">#{creditNote.credit_number}</p>
            </div>
          </div>
        </div>

        {/* Credit Note Details */}
        <div className="mb-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-800 font-semibold text-center text-lg">
              Credit Amount: -₵{Number(creditNote.total).toFixed(2)}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Invoice Number:</span>
              <span className="font-medium text-gray-900">#{creditNote.invoices?.invoice_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Customer:</span>
              <span className="font-medium text-gray-900">{creditNote.invoices?.customers?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Date:</span>
              <span className="font-medium text-gray-900">
                {new Date(creditNote.date).toLocaleDateString("en-GH")}
              </span>
            </div>
            {creditNote.reason && (
              <div className="flex justify-between">
                <span className="text-gray-600">Reason:</span>
                <span className="font-medium text-gray-900">{creditNote.reason}</span>
              </div>
            )}
          </div>
        </div>

        {/* Line Items */}
        <div className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">Items:</h3>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Description</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-700">Qty</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700">Price</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 text-sm text-gray-900">{item.description}</td>
                    <td className="px-4 py-2 text-sm text-center text-gray-700">{Number(item.qty)}</td>
                    <td className="px-4 py-2 text-sm text-right text-gray-700">₵{Number(item.unit_price).toFixed(2)}</td>
                    <td className="px-4 py-2 text-sm text-right font-medium text-red-600">-₵{Number(item.line_subtotal).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="mb-6">
          <div className="flex justify-end">
            <div className="w-72 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal:</span>
                <span className="text-gray-900">₵{Number(creditNote.subtotal).toFixed(2)}</span>
              </div>
              {Number(creditNote.nhil || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">NHIL (2.5%):</span>
                  <span className="text-red-600">-₵{Number(creditNote.nhil).toFixed(2)}</span>
                </div>
              )}
              {Number(creditNote.getfund || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">GETFund (2.5%):</span>
                  <span className="text-red-600">-₵{Number(creditNote.getfund).toFixed(2)}</span>
                </div>
              )}
              {Number(creditNote.vat || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">VAT (15%):</span>
                  <span className="text-red-600">-₵{Number(creditNote.vat).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t-2 border-gray-300">
                <span className="font-bold text-gray-900">Total Credit:</span>
                <span className="font-bold text-red-600 text-lg">-₵{Number(creditNote.total).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {creditNote.notes && (
          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Notes:</h3>
            <p className="text-gray-700 text-sm whitespace-pre-wrap">{creditNote.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-6 mt-6">
          <p className="text-gray-600 text-sm text-center">
            This credit note has been applied to Invoice #{creditNote.invoices?.invoice_number}
          </p>
        </div>
      </div>
    </div>
  )
}

