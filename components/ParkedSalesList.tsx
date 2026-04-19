"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { formatMoney } from "@/lib/money"

/** One line from POS `cart_json` when parking a sale */
type ParkedCartLine = {
  id?: string
  product?: { name?: string; price?: number }
  quantity?: number
  variantName?: string | null
  variantPrice?: number | null
  modifiers?: Array<{ name?: string; price?: number }>
  note?: string
  discount_type?: string
  discount_value?: number
}

function getParkedCartLines(
  cartJson: unknown,
  currencyCode: string | null
): Array<{ key: string; label: string; detail: string; lineTotal: number }> {
  if (!Array.isArray(cartJson)) return []
  return cartJson.map((raw: unknown, idx: number) => {
    const item = raw as ParkedCartLine
    const name = (item.product?.name || "").trim() || "Item"
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
    const modTotal = (item.modifiers || []).reduce((s, m) => s + Number(m?.price || 0), 0)
    const unit = Number(item.variantPrice ?? item.product?.price ?? 0) + modTotal
    const gross = unit * qty
    let discount = 0
    const dv = Number(item.discount_value) || 0
    if (dv > 0) {
      if (item.discount_type === "percent") discount = (gross * Math.min(100, dv)) / 100
      else if (item.discount_type === "amount") discount = Math.min(dv, gross)
    }
    const net = Math.max(0, gross - discount)
    const vn = item.variantName?.trim()
    const label =
      vn && vn !== name ? `${name} — ${vn}` : name
    const modLabels = (item.modifiers || [])
      .map((m) => m.name)
      .filter(Boolean)
      .join(", ")
    const detailParts: string[] = [`${qty} × ${formatMoney(unit, currencyCode)}`]
    if (modLabels) detailParts.push(modLabels)
    if (item.note?.trim()) detailParts.push(`"${item.note.trim()}"`)
    return {
      key: typeof item.id === "string" && item.id ? item.id : `line-${idx}`,
      label,
      detail: detailParts.join(" · "),
      lineTotal: net,
    }
  })
}

type ParkedSale = {
  id: string
  business_id: string
  cashier_id: string
  cart_json: any
  subtotal: number
  taxes: number
  total: number
  created_at: string
  users?: {
    email?: string
    full_name?: string
  }
}

interface ParkedSalesListProps {
  businessId: string
  currencyCode?: string | null
  onClose: () => void
  onResume: (sale: ParkedSale) => void
}

export default function ParkedSalesList({
  businessId,
  currencyCode = null,
  onClose,
  onResume,
}: ParkedSalesListProps) {
  const homeCode = currencyCode ?? "GHS"
  const { openConfirm } = useConfirm()
  const [parkedSales, setParkedSales] = useState<ParkedSale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [resumingId, setResumingId] = useState<string | null>(null)

  useEffect(() => {
    loadParkedSales()
  }, [businessId])

  const loadParkedSales = async () => {
    try {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from("parked_sales")
        .select("*, users(email, full_name)")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })

      if (fetchError) throw fetchError

      setParkedSales((data || []) as ParkedSale[])
    } catch (err: any) {
      setError(err.message || "Failed to load parked sales")
    } finally {
      setLoading(false)
    }
  }

  const handleResume = async (sale: ParkedSale) => {
    try {
      setResumingId(sale.id)
      setError("")

      // Delete the parked sale
      const { error: deleteError } = await supabase
        .from("parked_sales")
        .delete()
        .eq("id", sale.id)

      if (deleteError) throw deleteError

      // Restore cart
      onResume(sale)
    } catch (err: any) {
      setError(err.message || "Failed to resume sale")
      setResumingId(null)
    }
  }

  const handleDelete = async (saleId: string) => {
    openConfirm({
      title: "Delete parked sale",
      description: "Are you sure you want to delete this parked sale?",
      onConfirm: () => runDelete(saleId),
    })
  }

  const runDelete = async (saleId: string) => {
    try {
      const { error: deleteError } = await supabase
        .from("parked_sales")
        .delete()
        .eq("id", saleId)

      if (deleteError) throw deleteError

      loadParkedSales()
    } catch (err: any) {
      setError(err.message || "Failed to delete parked sale")
    }
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Parked Sales</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : parkedSales.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No parked sales found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {parkedSales.map((sale) => (
              <div
                key={sale.id}
                className="border rounded-lg p-4 hover:bg-gray-50"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-lg">
                        Sale #{sale.id.slice(0, 8)}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatTime(sale.created_at)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mb-1">
                      Cashier: {sale.users?.full_name || sale.users?.email || "Unknown"}
                    </div>
                    {(() => {
                      const lines = getParkedCartLines(sale.cart_json, currencyCode ?? null)
                      if (lines.length === 0) return null
                      return (
                        <div className="mb-3 mt-2 rounded-md border border-slate-200 bg-slate-50">
                          <div className="border-b border-slate-200 bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Items ({lines.length})
                          </div>
                          <ul className="max-h-48 divide-y divide-slate-200 overflow-y-auto text-sm">
                            {lines.map((line) => (
                              <li key={line.key} className="flex gap-2 px-2 py-1.5">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium text-slate-900">{line.label}</div>
                                  <div className="truncate text-xs text-slate-600">{line.detail}</div>
                                </div>
                                <div className="shrink-0 text-right font-semibold tabular-nums text-slate-900">
                                  {formatMoney(line.lineTotal, currencyCode ?? null)}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        <strong>Subtotal:</strong> {formatMoney(sale.subtotal, homeCode)}
                      </span>
                      <span>
                        <strong>Tax:</strong> {formatMoney(sale.taxes, homeCode)}
                      </span>
                      <span className="font-bold text-blue-600">
                        <strong>Total:</strong> {formatMoney(sale.total, homeCode)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleResume(sale)}
                      disabled={resumingId === sale.id}
                      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      {resumingId === sale.id ? "Resuming..." : "Resume"}
                    </button>
                    <button
                      onClick={() => handleDelete(sale.id)}
                      className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


