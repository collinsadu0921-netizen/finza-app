"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import Link from "next/link"
import { formatMoney } from "@/lib/money"
import {
  RetailBackofficeAlert,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeSkeleton,
} from "@/components/retail/RetailBackofficeUi"
import {
  purchaseOrderStatusBadgeTone,
  purchaseOrderStatusLabel,
} from "@/lib/retail/purchaseOrderStatusLabels"

type PoItem = {
  id: string
  product_id: string
  variant_id: string | null
  quantity: number
  unit_cost: number | null
  total_cost: number | null
}

type PurchaseOrder = {
  id: string
  supplier_id: string
  status: string
  payment_state?: string
  reference: string | null
  order_date: string
  expected_date: string | null
  created_at: string
  received_at: string | null
  supplier: { id: string; name: string }
  items: PoItem[]
}

function estimatedLineTotal(it: PoItem): number {
  const u = it.unit_cost != null ? Number(it.unit_cost) : NaN
  if (Number.isFinite(u) && u >= 0) return Number(it.quantity) * u
  if (it.total_cost != null) return Number(it.total_cost)
  return 0
}

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)

  useEffect(() => {
    void loadPurchaseOrders()
    void loadCurrency()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const loadCurrency = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const business = await getCurrentBusiness(supabase, user.id)
      if (business) setCurrencyCode(business.default_currency || "GHS")
    }
  }

  const loadPurchaseOrders = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Sign in to view supplier orders.")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      const params = new URLSearchParams()
      if (statusFilter !== "all") params.append("status", statusFilter)

      const response = await fetch(`/api/purchase-orders?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || "Failed to load purchase orders")

      setPurchaseOrders(data.purchase_orders || [])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load purchase orders"
      console.error("Error loading purchase orders:", err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const estimatedTotal = (items: PoItem[]) => items.reduce((s, it) => s + estimatedLineTotal(it), 0)

  const filters = ["all", "planned", "ordered", "partially_received", "received", "cancelled"] as const

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-6xl">
        <RetailBackofficePageHeader
          eyebrow="Procurement"
          title="Buy lists & supplier orders"
          description="Plan what to restock, send a simple list by WhatsApp or email, then enter real costs when goods arrive. Inventory and supplier payables update when you receive."
          actions={
            <RetailBackofficeButton variant="primary" type="button" onClick={() => router.push("/retail/admin/purchase-orders/new")}>
              New buy list
            </RetailBackofficeButton>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard className="mb-6">
          <div className="flex flex-wrap gap-2">
            {filters.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === key
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                {key === "all" ? "All" : purchaseOrderStatusLabel(key)}
              </button>
            ))}
          </div>
        </RetailBackofficeCard>

        {loading ? (
          <RetailBackofficeSkeleton rows={6} />
        ) : purchaseOrders.length === 0 ? (
          <RetailBackofficeEmpty
            title="No buy lists yet"
            description="Start from low stock or add lines manually, then share with your supplier."
            action={
              <RetailBackofficeButton variant="primary" type="button" onClick={() => router.push("/retail/admin/purchase-orders/new")}>
                New buy list
              </RetailBackofficeButton>
            }
          />
        ) : (
          <RetailBackofficeCard padding="p-0 sm:p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
                  <tr>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Ref
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Lines
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Est. total
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Status
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Send
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Open
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {purchaseOrders.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3.5 font-medium text-slate-900 sm:px-6">
                        {po.reference || po.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3.5 text-slate-800 sm:px-6">{po.supplier.name}</td>
                      <td className="px-4 py-3.5 text-slate-600 sm:px-6">
                        {po.items.length} line{po.items.length !== 1 ? "s" : ""}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 sm:px-6">
                        {estimatedTotal(po.items) > 0
                          ? formatMoney(estimatedTotal(po.items), currencyCode)
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 sm:px-6">
                        <RetailBackofficeBadge tone={purchaseOrderStatusBadgeTone(po.status)}>
                          {purchaseOrderStatusLabel(po.status)}
                        </RetailBackofficeBadge>
                      </td>
                      <td className="px-4 py-3.5 sm:px-6">
                        {po.status === "planned" ? (
                          <Link
                            href={`/retail/admin/purchase-orders/${po.id}#send-to-supplier`}
                            className="text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
                          >
                            Send list
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right sm:px-6">
                        <Link
                          href={`/retail/admin/purchase-orders/${po.id}`}
                          className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RetailBackofficeCard>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
