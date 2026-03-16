"use client"

import { useEffect, useState, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { useVoidSale } from "@/lib/hooks/useVoidSale"
import VoidSaleModalWrapper from "@/components/VoidSaleModalWrapper"
import { useRefund } from "@/lib/hooks/useRefund"
import RefundModalWrapper from "@/components/RefundModalWrapper"
import { getActiveStoreId } from "@/lib/storeSession"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Sale = {
  id: string
  amount: number
  payment_method: string
  payment_status?: string
  created_at: string
  description?: string
  user_id: string
}

export default function SalesPage() {
  const router = useRouter()
  const { format } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<Sale[]>([])
  const [businessId, setBusinessId] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  
  // Sorting
  const [sortField, setSortField] = useState<string>("date")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return (
        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    }
    if (sortDirection === "asc") {
      return (
        <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      )
    }
    return (
      <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    )
  }

  // Sort sales client-side
  const sortedSales = useMemo(() => {
    return [...sales].sort((a, b) => {
      let comparison = 0
      const ascending = sortDirection === "asc"
      
      if (sortField === "date") {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      } else if (sortField === "amount") {
        comparison = (a.amount || 0) - (b.amount || 0)
      } else if (sortField === "description") {
        comparison = (a.description || "").localeCompare(b.description || "")
      } else if (sortField === "payment") {
        comparison = (a.payment_method || "").localeCompare(b.payment_method || "")
      } else if (sortField === "status") {
        comparison = (a.payment_status || "").localeCompare(b.payment_status || "")
      } else {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      
      return ascending ? comparison : -comparison
    })
  }, [sales, sortField, sortDirection])

  const {
    requestVoidSale,
    showOverrideModal: showVoidModal,
    saleId: voidSaleId,
    cashierId: voidCashierId,
    handleOverrideClose: handleVoidClose,
    handleOverrideSuccess: handleVoidSuccess,
  } = useVoidSale({
    onSuccess: () => {
      setSuccess("Sale voided successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadSales()
    },
    onError: (errorMsg) => {
      setError(errorMsg)
      setTimeout(() => setError(""), 5000)
    },
  })

  const {
    requestRefund,
    showOverrideModal: showRefundModal,
    saleId: refundSaleId,
    cashierId: refundCashierId,
    handleOverrideClose: handleRefundClose,
    handleOverrideSuccess: handleRefundSuccess,
  } = useRefund({
    onSuccess: () => {
      setSuccess("Sale refunded successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadSales()
    },
    onError: (errorMsg) => {
      setError(errorMsg || "Supervisor approval is required to refund a sale.")
      setTimeout(() => setError(""), 5000)
    },
  })

  useEffect(() => {
    loadSales()
    
    // Reload when store changes
    const handleStoreChange = () => {
      loadSales()
    }
    
    window.addEventListener('storeChanged', handleStoreChange)
    
    return () => {
      window.removeEventListener('storeChanged', handleStoreChange)
    }
  }, [])

  const loadSales = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Get active store - sales MUST be store-specific
      const activeStoreId = getActiveStoreId()
      
      if (!activeStoreId || activeStoreId === 'all') {
        setError("Please select a store before viewing sales. Go to Stores page and click 'Open Store'.")
        setSales([])
        setLoading(false)
        return
      }

      // Load recent sales (last 50) - FILTER BY STORE
      let salesQuery = supabase
        .from("sales")
        .select("id, amount, payment_method, payment_status, created_at, description, user_id, store_id")
        .eq("business_id", business.id)
        .eq("store_id", activeStoreId) // CRITICAL: Only sales for active store
        .order("created_at", { ascending: false })
        .limit(50)
      
      const { data: salesData, error: salesError } = await salesQuery

      if (salesError) {
        setError(`Error loading sales: ${salesError.message}`)
        setLoading(false)
        return
      }

      setSales(
        (salesData || []).map((s) => ({
          ...s,
          amount: Number(s.amount || 0),
        }))
      )
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load sales")
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatPaymentMethod = (method: string) => {
    // CRITICAL: Use country-aware labels for payment methods
    const methods: Record<string, string> = {
      cash: "Cash",
      momo: "MoMo",
      mobile_money: "Mobile Money", // Generic label
      mtn_momo: "MTN MoMo", // Only shown for GH
      hubtel: "Hubtel", // Only shown for GH
      card: "Card",
      bank: "Bank",
    }
    return methods[method] || method
  }

  const createTestSale = async () => {
    if (!businessId) {
      setError("Business not found. Please refresh the page.")
      return
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in to create a sale.")
        return
      }

      const { error: saleError } = await supabase.from("sales").insert({
        business_id: businessId,
        user_id: user.id,
        amount: Math.floor(Math.random() * 1000) + 10, // Random amount between 10-1010
        description: `Test Sale - ${new Date().toLocaleString()}`,
        payment_method: "cash",
        payment_status: "paid",
      })

      if (saleError) {
        setError(`Error creating test sale: ${saleError.message}`)
        return
      }

      setSuccess("Test sale created successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadSales()
    } catch (err: any) {
      setError(err.message || "Failed to create test sale")
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
    <div className="p-6 max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">POS - Sales</h1>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              Dashboard
            </button>
            <button
              onClick={loadSales}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        {sales.length === 0 ? (
          <div className="border p-8 rounded-lg text-center bg-gray-50">
            <p className="text-gray-600">No sales found.</p>
            <p className="text-sm text-gray-500 mt-2">
              Sales will appear here once transactions are recorded.
            </p>
            <button
              onClick={createTestSale}
              className="mt-4 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700"
            >
              Create Test Sale
            </button>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-white">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th 
                    className="text-left py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort("date")}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Date</span>
                      {getSortIcon("date")}
                    </div>
                  </th>
                  <th 
                    className="text-left py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort("description")}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Description</span>
                      {getSortIcon("description")}
                    </div>
                  </th>
                  <th 
                    className="text-right py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort("amount")}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Amount</span>
                      {getSortIcon("amount")}
                    </div>
                  </th>
                  <th 
                    className="text-center py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort("payment")}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Payment</span>
                      {getSortIcon("payment")}
                    </div>
                  </th>
                  <th 
                    className="text-center py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Status</span>
                      {getSortIcon("status")}
                    </div>
                  </th>
                  <th className="text-center py-3 px-4 font-semibold text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedSales.map((sale) => (
                  <tr key={sale.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {formatDate(sale.created_at)}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {sale.description || "Sale"}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold">
                      {format(sale.amount)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                        {formatPaymentMethod(sale.payment_method)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {sale.payment_status === "pending" ? (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                          Pending
                        </span>
                      ) : sale.payment_status === "refunded" ? (
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs">
                          Refunded
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                          Paid
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => router.push(`/sales/${sale.id}/receipt`)}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                        >
                          View
                        </button>
                        {sale.payment_status !== "refunded" && (
                          <>
                            <button
                              onClick={() => requestRefund(sale.id)}
                              className="bg-orange-600 text-white px-3 py-1 rounded text-sm hover:bg-orange-700"
                            >
                              Refund
                            </button>
                            <button
                              onClick={() => requestVoidSale(sale.id)}
                              className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                            >
                              Void
                            </button>
                          </>
                        )}
                        {sale.payment_status === "refunded" && (
                          <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                            Refunded
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Render the void sale override modal */}
        <VoidSaleModalWrapper
          showOverrideModal={showVoidModal}
          saleId={voidSaleId}
          cashierId={voidCashierId}
          onClose={handleVoidClose}
          onSuccess={handleVoidSuccess}
        />

        {/* Render the refund override modal */}
        <RefundModalWrapper
          showOverrideModal={showRefundModal}
          saleId={refundSaleId}
          cashierId={refundCashierId}
          onClose={handleRefundClose}
          onSuccess={handleRefundSuccess}
        />
      </div>
  )
}
