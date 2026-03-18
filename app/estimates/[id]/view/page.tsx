"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import Toast from "@/components/Toast"
import { getGhanaLegacyView, getTaxBreakdown } from "@/lib/taxes/readTaxLines"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type Estimate = {
  id: string
  estimate_number: string
  issue_date: string
  expiry_date: string | null
  notes: string | null
  subtotal: number
  nhil_amount: number
  getfund_amount: number
  covid_amount: number
  vat_amount: number
  total_tax_amount: number
  total_amount: number
  status: string
  converted_to: string | null
  converted_to_proforma_id: string | null
  public_token: string | null
  tax_lines: any | null
  customers: {
    id: string
    name: string
    email: string | null
    phone: string | null
    whatsapp_phone: string | null
    address: string | null
  } | null
}

type EstimateItem = {
  id: string
  description: string
  quantity: number
  price: number
  total: number
}

export default function EstimateViewPage() {
  const router = useRouter()
  const params = useParams()
  const estimateId = (params?.id as string) || ""
  const { currencySymbol } = useBusinessCurrency()
  const { openConfirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [items, setItems] = useState<EstimateItem[]>([])
  const [error, setError] = useState("")
  const [showSendModal, setShowSendModal] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)
  const [convertingToProforma, setConvertingToProforma] = useState(false)
  const [copiedClientLink, setCopiedClientLink] = useState(false)

  const handleCopyClientLink = () => {
    if (!estimate?.public_token) return
    const url = `${window.location.origin}/quote-public/${estimate.public_token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedClientLink(true)
      setTimeout(() => setCopiedClientLink(false), 2000)
    })
  }

  useEffect(() => {
    if (estimateId) {
      loadEstimate()
    }
  }, [estimateId])

  useEffect(() => {
    if (typeof window !== "undefined" && estimate && estimate.status === "draft") {
      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get("send") === "true") {
        setTimeout(() => {
          setShowSendModal(true)
          window.history.replaceState({}, "", window.location.pathname)
        }, 500)
      }
    }
  }, [estimate])

  const loadEstimate = async () => {
    try {
      setLoading(true)
      setError("")

      const response = await fetch(`/api/estimates/${estimateId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (response.status === 404) {
          throw new Error("We couldn't find this quote. It may have been deleted or the link is incorrect.")
        } else {
          throw new Error(errorData.error || "We couldn't load this quote. Please refresh or check your connection.")
        }
      }

      const data = await response.json()
      console.log("Estimate data received:", { hasEstimate: !!data.estimate, hasItems: !!data.items, itemsCount: data.items?.length })

      if (!data.estimate) {
        throw new Error("Quote data is missing from the response")
      }

      setEstimate(data.estimate)

      // Ensure items are properly set
      const estimateItems = data.items || []
      console.log("Setting items:", estimateItems)
      setItems(estimateItems)

      // No linked entity lookup needed — proforma ID is on the estimate itself
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "We couldn't load this quote. Please refresh or check your connection.")
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800",
      sent: "bg-blue-100 text-blue-800",
      accepted: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      expired: "bg-yellow-100 text-yellow-800",
    }
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status] || styles.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const handleConvertToProforma = async () => {
    if (!estimate) return
    openConfirm({
      title: "Convert to Proforma Invoice",
      description: "This will create a Proforma Invoice from this quote. The customer can then approve or pay based on the proforma before a final invoice is issued.",
      onConfirm: () => runConvertToProforma(),
    })
  }

  const runConvertToProforma = async () => {
    if (!estimate) return
    try {
      setConvertingToProforma(true)
      const response = await fetch("/api/proforma/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_estimate_id: estimateId }),
      })

      const data = await response.json()

      if (response.ok && data.proformaId) {
        setToast({ message: "Proforma Invoice created successfully!", type: "success" })
        setTimeout(() => {
          router.push(`/service/proforma/${data.proformaId}/view`)
        }, 800)
      } else {
        setToast({ message: data.error || "Failed to create Proforma Invoice", type: "error" })
        setConvertingToProforma(false)
      }
    } catch (err: any) {
      setToast({ message: "Error creating Proforma Invoice. Please try again.", type: "error" })
      setConvertingToProforma(false)
    }
  }

  const handleSend = async (action: "whatsapp" | "email" | "link") => {
    try {
      const body: any = {}
      if (action === "whatsapp") body.sendWhatsApp = true
      if (action === "email") body.sendEmail = true
      if (action === "link") body.copyLink = true

      const response = await fetch(`/api/estimates/${estimateId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.message || "Failed to send quote")
      }

      if (action === "whatsapp" && data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank", "noopener,noreferrer")
        setToast({ message: "WhatsApp message opened!", type: "success" })
      } else if (action === "link" && data.publicUrl) {
        navigator.clipboard.writeText(data.publicUrl)
        setToast({ message: "Public link copied to clipboard!", type: "success" })
      } else {
        setToast({ message: data.message || "Quote sent successfully!", type: "success" })
      }

      setShowSendModal(false)
      loadEstimate() // Refresh to update status
    } catch (err: any) {
      setToast({ message: err.message || "Failed to send quote", type: "error" })
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || (!loading && !estimate)) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Unable to load this quote."}
          </div>
          <button
            onClick={() => router.push("/service/estimates")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Quotes
          </button>
        </div>
      </ProtectedLayout>
    )
  }

  // Extra check for TypeScript
  if (!estimate) return null

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Quote #{estimate.estimate_number}</h1>
            <p className="text-gray-600">View and manage your quote</p>
          </div>
          <div className="flex gap-2">
            {/* Edit button - Show for draft and sent (sent creates revision) */}
            {!estimate.converted_to && (estimate.status === "draft" || estimate.status === "sent") && (
              <button
                onClick={() => router.push(`/service/estimates/${estimateId}/edit`)}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
              >
                Edit{estimate.status === "sent" ? " (Creates Revision)" : ""}
              </button>
            )}
            {/* Show read-only indicator if converted */}
            {estimate.converted_to && (
              <div className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Read-only (Converted to {estimate.converted_to === "proforma" ? "Proforma Invoice" : estimate.converted_to})</span>
              </div>
            )}
            {/* Send button - Only for draft */}
            {estimate.status === "draft" && !estimate.converted_to && (
              <button
                onClick={() => setShowSendModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Send Quote
              </button>
            )}
            {/* Resend button - Only for sent */}
            {estimate.status === "sent" && !estimate.converted_to && (
              <button
                onClick={() => setShowSendModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Resend Quote
              </button>
            )}
            {/* Copy client acceptance link — show when sent */}
            {estimate.status === "sent" && estimate.public_token && (
              <button
                onClick={handleCopyClientLink}
                className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
              >
                {copiedClientLink ? (
                  <>
                    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Client Link
                  </>
                )}
              </button>
            )}
            {/* Convert to Proforma Invoice - Show for sent and accepted */}
            {!estimate.converted_to && (estimate.status === "sent" || estimate.status === "accepted") && (
              <button
                onClick={handleConvertToProforma}
                disabled={convertingToProforma}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {convertingToProforma ? "Creating Proforma..." : "Convert to Proforma"}
              </button>
            )}
            {/* Link to existing proforma if converted */}
            {estimate.converted_to === "proforma" && estimate.converted_to_proforma_id && (
              <button
                onClick={() => router.push(`/service/proforma/${estimate.converted_to_proforma_id}/view`)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
              >
                View Proforma
              </button>
            )}
            {/* Convert directly to Invoice - Show for sent and accepted */}
            {!estimate.converted_to && (estimate.status === "sent" || estimate.status === "accepted") && (
              <button
                onClick={() => router.push(`/service/estimates/${estimateId}/convert`)}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
              >
                Convert to Invoice
              </button>
            )}
          </div>
        </div>

        {/* Status Badge */}
        <div className="mb-6">
          {getStatusBadge(estimate.status)}
        </div>

        {/* Quote Details */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Customer</h3>
              <p className="text-lg font-semibold">{estimate.customers?.name || "No Customer"}</p>
              {estimate.customers?.email && (
                <p className="text-sm text-gray-600">{estimate.customers.email}</p>
              )}
              {estimate.customers?.phone && (
                <p className="text-sm text-gray-600">{estimate.customers.phone}</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Quote Details</h3>
              <p className="text-sm text-gray-600">Issue Date: {new Date(estimate.issue_date).toLocaleDateString()}</p>
              {estimate.expiry_date && (
                <p className="text-sm text-gray-600">Expiry Date: {new Date(estimate.expiry_date).toLocaleDateString()}</p>
              )}
            </div>
          </div>

          {/* Line Items */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4">Line Items</h3>
            {items && items.length > 0 ? (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Description</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Quantity</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Price</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {items.map((item, index) => (
                    <tr key={item.id || index}>
                      <td className="px-4 py-3">{item.description || "No description"}</td>
                      <td className="px-4 py-3 text-right">{Number(item.quantity) || 0}</td>
                      <td className="px-4 py-3 text-right">{currencySymbol || ""} {Number(item.price || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium">{currencySymbol || ""} {Number(item.total || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
                <p>No line items found for this quote.</p>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-medium">{currencySymbol || ""} {Number(estimate.subtotal).toFixed(2)}</span>
                </div>
                {estimate.total_tax_amount > 0 && (() => {
                  // Read tax data via readTaxLines helper if tax_lines exists, fallback to legacy columns
                  const taxBreakdown = estimate.tax_lines 
                    ? getGhanaLegacyView(estimate.tax_lines)
                    : {
                        nhil: estimate.nhil_amount || 0,
                        getfund: estimate.getfund_amount || 0,
                        covid: estimate.covid_amount || 0,
                        vat: estimate.vat_amount || 0,
                      }
                  
                  // Get all tax lines for display
                  const allTaxLines = estimate.tax_lines 
                    ? getTaxBreakdown(estimate.tax_lines)
                    : null
                  
                  return (
                    <>
                      {/* Display tax lines from tax_lines if available, otherwise use legacy columns (no rate labels) */}
                      {estimate.tax_lines && allTaxLines ? (
                        // Display from canonical tax_lines (no rate labels). Exclude COVID and zero-value lines.
                        Object.entries(allTaxLines)
                          .filter(([code, amount]) => Number(amount) > 0 && code.toUpperCase() !== "COVID")
                          .map(([code, amount]) => (
                            <div key={code} className="flex justify-between text-sm text-gray-600">
                              <span>{code}:</span>
                              <span>{currencySymbol || ""} {Number(amount).toFixed(2)}</span>
                            </div>
                          ))
                      ) : (
                        // Fallback to legacy columns (no rate labels)
                        <>
                          {taxBreakdown.nhil > 0 && (
                            <div className="flex justify-between text-sm text-gray-600">
                              <span>NHIL:</span>
                              <span>{currencySymbol || ""} {Number(taxBreakdown.nhil).toFixed(2)}</span>
                            </div>
                          )}
                          {taxBreakdown.getfund > 0 && (
                            <div className="flex justify-between text-sm text-gray-600">
                              <span>GETFund:</span>
                              <span>{currencySymbol || ""} {Number(taxBreakdown.getfund).toFixed(2)}</span>
                            </div>
                          )}
                          {taxBreakdown.vat > 0 && (
                            <div className="flex justify-between text-sm text-gray-600">
                              <span>VAT:</span>
                              <span>{currencySymbol || ""} {Number(taxBreakdown.vat).toFixed(2)}</span>
                            </div>
                          )}
                        </>
                      )}
                      <div className="flex justify-between pt-2 border-t border-gray-200">
                        <span className="font-medium">Total Tax:</span>
                        <span className="font-medium">{currencySymbol || ""} {Number(estimate.total_tax_amount).toFixed(2)}</span>
                      </div>
                    </>
                  )
                })()}
                <div className="flex justify-between text-lg pt-2 border-t-2 border-gray-300">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold">{currencySymbol || ""} {Number(estimate.total_amount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {estimate.notes && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Notes</h3>
              <p className="text-gray-700 whitespace-pre-wrap">{estimate.notes}</p>
            </div>
          )}

          {/* Client acceptance details */}
          {estimate.status === "accepted" && (estimate as any).client_name_signed && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                Accepted &amp; Signed by Client
              </h3>
              <div className="flex flex-wrap items-start gap-6">
                {(estimate as any).client_signature && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <img src={(estimate as any).client_signature} alt="Client signature" className="h-14 w-auto" />
                  </div>
                )}
                <div className="text-sm space-y-0.5">
                  <p className="font-semibold text-gray-800">{(estimate as any).client_name_signed}</p>
                  {(estimate as any).client_id_type && (
                    <p className="text-gray-600">
                      {(estimate as any).client_id_type === "ghana_card" ? "Ghana Card" :
                       (estimate as any).client_id_type === "national_id" ? "National ID" :
                       (estimate as any).client_id_type === "passport" ? "Passport" :
                       (estimate as any).client_id_type === "drivers_license" ? "Driver's License" :
                       (estimate as any).client_id_type === "voters_id" ? "Voter's ID" :
                       (estimate as any).client_id_type}
                      {(estimate as any).client_id_number && `: ${(estimate as any).client_id_number}`}
                    </p>
                  )}
                  {(estimate as any).signed_at && (
                    <p className="text-gray-400 text-xs">
                      Signed {new Date((estimate as any).signed_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Rejection details */}
          {estimate.status === "rejected" && (estimate as any).rejected_reason && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2">Declined by Client</h3>
              <p className="text-sm text-gray-600">{(estimate as any).rejected_reason}</p>
            </div>
          )}
        </div>

        {/* Send Modal */}
        {showSendModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold mb-4">Send Quote</h3>
              <div className="space-y-3">
                <button
                  onClick={() => handleSend("whatsapp")}
                  className="w-full bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                  </svg>
                  Send via WhatsApp
                </button>
                <button
                  onClick={() => handleSend("email")}
                  className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Send via Email
                </button>
                <button
                  onClick={() => handleSend("link")}
                  className="w-full bg-gray-600 text-white px-4 py-3 rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Public Link
                </button>
              </div>
              <button
                onClick={() => setShowSendModal(false)}
                className="mt-4 w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </ProtectedLayout>
  )
}

