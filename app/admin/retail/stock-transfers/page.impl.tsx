"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import Link from "next/link"

type StockTransfer = {
  id: string
  from_store_id: string
  to_store_id: string
  status: "draft" | "in_transit" | "received" | "cancelled"
  reference: string | null
  initiated_at: string
  received_at: string | null
  from_store: { id: string; name: string }
  to_store: { id: string; name: string }
  initiated_by_user: { id: string; full_name: string | null; email: string } | null
  received_by_user: { id: string; full_name: string | null; email: string } | null
  items: Array<{
    id: string
    product_id: string
    variant_id: string | null
    quantity: number
    unit_cost: number
    total_cost: number
  }>
}

export default function StockTransfersPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("all")

  useEffect(() => {
    loadTransfers()
  }, [statusFilter])

  const loadTransfers = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in")
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
      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }

      const response = await fetch(`/api/stock-transfers?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to load transfers")
      }

      setTransfers(data.transfers || [])
    } catch (err: any) {
      console.error("Error loading transfers:", err)
      setError(err.message || "Failed to load transfers")
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800",
      in_transit: "bg-yellow-100 text-yellow-800",
      received: "bg-green-100 text-green-800",
      cancelled: "bg-red-100 text-red-800",
    }
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-semibold ${
          styles[status] || styles.draft
        }`}
      >
        {status.replace("_", " ").toUpperCase()}
      </span>
    )
  }

  const calculateTotalCost = (items: StockTransfer["items"]) => {
    return items.reduce((sum, item) => sum + Number(item.total_cost || 0), 0)
  }

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: "GHS",
    }).format(amount)
  }

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading transfers...</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Stock Transfers</h1>
            <p className="text-gray-600 mt-1">
              Manage inventory transfers between stores
            </p>
          </div>
          <Link
            href="/admin/retail/stock-transfers/new"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            + New Transfer
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-4 py-2 rounded ${
              statusFilter === "all"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setStatusFilter("draft")}
            className={`px-4 py-2 rounded ${
              statusFilter === "draft"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Draft
          </button>
          <button
            onClick={() => setStatusFilter("in_transit")}
            className={`px-4 py-2 rounded ${
              statusFilter === "in_transit"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            In Transit
          </button>
          <button
            onClick={() => setStatusFilter("received")}
            className={`px-4 py-2 rounded ${
              statusFilter === "received"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Received
          </button>
        </div>

        {/* Transfers Table */}
        {transfers.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">No transfers found</p>
            <Link
              href="/admin/retail/stock-transfers/new"
              className="text-blue-600 hover:underline mt-2 inline-block"
            >
              Create your first transfer
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reference
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    From → To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Items
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Cost
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Initiated
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transfer.reference || transfer.id.substring(0, 8)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div>
                        <span className="font-medium">{transfer.from_store.name}</span>
                        <span className="mx-2">→</span>
                        <span className="font-medium">{transfer.to_store.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transfer.items.length} item{transfer.items.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatMoney(calculateTotalCost(transfer.items))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(transfer.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(transfer.initiated_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link
                        href={`/admin/retail/stock-transfers/${transfer.id}`}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
