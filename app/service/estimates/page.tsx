"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

type Estimate = {
  id: string
  estimate_number: string
  customer_id: string | null
  customer_name: string | null
  total_amount: number
  status: "draft" | "sent" | "accepted" | "rejected" | "expired"
  expiry_date: string | null
  created_at: string
}

export default function EstimatesPage() {
  const router = useRouter()
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  useEffect(() => {
    loadEstimates()
  }, [])

  useEffect(() => {
    if (businessId) {
      loadEstimates()
    }
  }, [businessId, statusFilter])

  const loadEstimates = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      let query = supabase
        .from("estimates")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter)
      }

      const { data, error: fetchError } = await query

      if (fetchError) {
        // If table doesn't exist, show empty state
        if (fetchError.code === "42P01") {
          setEstimates([])
          setLoading(false)
          return
        }
        throw fetchError
      }

      const rows = data || []
      const customerIds = [...new Set(rows.map((est: any) => est.customer_id).filter(Boolean))] as string[]
      const customerMap: Record<string, string> = {}
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from("customers")
          .select("id, name")
          .in("id", customerIds)
        for (const c of customers || []) {
          customerMap[c.id] = c.name ?? "No Customer"
        }
      }

      const mappedEstimates = rows.map((est: any) => {
        const cid = est.customer_id
        return {
          id: est.id,
          estimate_number: est.estimate_number || est.id.substring(0, 8),
          customer_id: cid,
          customer_name: cid ? (customerMap[cid] ?? "No Customer") : "No Customer",
          total_amount: Number(est.total_amount || 0),
          status: est.status || "draft",
          expiry_date: est.expiry_date,
          created_at: est.created_at,
        }
      })

      setEstimates(mappedEstimates)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load quotes")
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
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const convertToInvoice = async (estimateId: string) => {
    try {
      // This would create an invoice from the estimate
      // Implementation depends on your invoice creation logic
      router.push(`/estimates/${estimateId}/convert`)
    } catch (err: any) {
      setError(err.message || "Failed to convert quote")
    }
  }

  if (loading) {
    return (
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    )
  }

  return (
    
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Quotes</h1>
            <p className="text-gray-600">Manage your quotes</p>
          </div>
          <button
            onClick={() => router.push("/estimates/new")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            + Create Quote
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="mb-4 flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {estimates.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-500 mb-4">No quotes found</p>
            <button
              onClick={() => router.push("/estimates/new")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              Create Your First Quote
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quote #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Expiry Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {estimates.map((estimate) => (
                  <tr key={estimate.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{estimate.estimate_number}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{estimate.customer_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        GHS {estimate.total_amount.toFixed(2)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(estimate.status)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{formatDate(estimate.expiry_date)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{formatDate(estimate.created_at)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => router.push(`/estimates/${estimate.id}/view`)}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                      >
                        View
                      </button>
                      {estimate.status === "accepted" && (
                        <button
                          onClick={() => convertToInvoice(estimate.id)}
                          className="text-green-600 hover:text-green-900 mr-4"
                        >
                          Convert to Invoice
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    
  )
}

