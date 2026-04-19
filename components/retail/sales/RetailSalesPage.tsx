"use client"

import { useEffect, useState, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { useVoidSale } from "@/lib/hooks/useVoidSale"
import VoidSaleModalWrapper from "@/components/VoidSaleModalWrapper"
import { useRefund } from "@/lib/hooks/useRefund"
import RefundModalWrapper from "@/components/RefundModalWrapper"
import { getActiveStoreId } from "@/lib/storeSession"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
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

type Sale = {
  id: string
  amount: number
  payment_method: string
  payment_status?: string
  created_at: string
  description?: string
  user_id: string
}

export default function RetailSalesPage() {
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
        <svg className="h-3 w-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    }
    if (sortDirection === "asc") {
      return (
        <svg className="h-3 w-3 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      )
    }
    return (
      <svg className="h-3 w-3 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <RetailBackofficePageHeader
            eyebrow="Sales"
            title="Recent sales"
            description="Last 50 tickets for the store you have open. Use Sales history for filters, search, and exports."
          />
          <RetailBackofficeSkeleton rows={8} />
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain>
        <RetailBackofficePageHeader
          eyebrow="Sales"
          title="Recent sales"
          description="Last 50 tickets for the active store. For receipt lookup, filters, and exports, open Sales history."
          actions={
            <div className="flex flex-wrap gap-2">
              <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.dashboard)}>
                Dashboard
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="secondary" onClick={() => void loadSales()}>
                Refresh
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.salesHistory)}>
                Sales history
              </RetailBackofficeButton>
            </div>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {success ? (
          <RetailBackofficeAlert tone="success" className="mb-4">
            {success}
          </RetailBackofficeAlert>
        ) : null}

        {sales.length === 0 ? (
          <RetailBackofficeEmpty
            title="No sales in this store yet"
            description="Open the POS to record tickets, or create a test sale if you are setting up the account."
            action={
              <RetailBackofficeButton variant="primary" onClick={() => void createTestSale()}>
                Create test sale
              </RetailBackofficeButton>
            }
          />
        ) : (
          <RetailBackofficeCard padding="p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 backdrop-blur-sm">
                  <tr>
                    <th
                      className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                      onClick={() => handleSort("date")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Date</span>
                        {getSortIcon("date")}
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                      onClick={() => handleSort("description")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Description</span>
                        {getSortIcon("description")}
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                      onClick={() => handleSort("amount")}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Amount</span>
                        {getSortIcon("amount")}
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                      onClick={() => handleSort("payment")}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>Payment</span>
                        {getSortIcon("payment")}
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 sm:px-6"
                      onClick={() => handleSort("status")}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>Status</span>
                        {getSortIcon("status")}
                      </div>
                    </th>
                    <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedSales.map((sale) => (
                    <tr key={sale.id} className="transition hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600 sm:px-6">{formatDate(sale.created_at)}</td>
                      <td className="max-w-[220px] truncate px-4 py-3.5 text-sm text-slate-900 sm:max-w-xs sm:px-6">
                        {sale.description || "Sale"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm font-semibold tabular-nums text-slate-900 sm:px-6">
                        {format(sale.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-center sm:px-6">
                        <RetailBackofficeBadge tone="neutral">{formatPaymentMethod(sale.payment_method)}</RetailBackofficeBadge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-center sm:px-6">
                        {sale.payment_status === "pending" ? (
                          <RetailBackofficeBadge tone="warning">Pending</RetailBackofficeBadge>
                        ) : sale.payment_status === "refunded" ? (
                          <RetailBackofficeBadge tone="danger">Refunded</RetailBackofficeBadge>
                        ) : (
                          <RetailBackofficeBadge tone="success">Paid</RetailBackofficeBadge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 sm:px-6">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <RetailBackofficeButton
                            variant="ghost"
                            className="!px-2 !py-1.5 text-xs"
                            onClick={() => router.push(retailPaths.saleReceipt(sale.id))}
                          >
                            Receipt
                          </RetailBackofficeButton>
                          {sale.payment_status !== "refunded" && (
                            <>
                              <RetailBackofficeButton
                                variant="ghost"
                                className="!px-2 !py-1.5 text-xs text-amber-900 hover:bg-amber-50"
                                onClick={() => requestRefund(sale.id)}
                              >
                                Refund
                              </RetailBackofficeButton>
                              <RetailBackofficeButton
                                variant="danger"
                                className="!px-2 !py-1.5 text-xs"
                                onClick={() => requestVoidSale(sale.id)}
                              >
                                Void
                              </RetailBackofficeButton>
                            </>
                          )}
                          {sale.payment_status === "refunded" && (
                            <span className="text-xs text-slate-400">Refunded</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RetailBackofficeCard>
        )}

        <VoidSaleModalWrapper
          showOverrideModal={showVoidModal}
          saleId={voidSaleId}
          cashierId={voidCashierId}
          onClose={handleVoidClose}
          onSuccess={handleVoidSuccess}
        />

        <RefundModalWrapper
          showOverrideModal={showRefundModal}
          saleId={refundSaleId}
          cashierId={refundCashierId}
          onClose={handleRefundClose}
          onSuccess={handleRefundSuccess}
        />
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
