"use client"

import { useEffect, useState, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import Table from "@/components/ui/Table"
import { useToast } from "@/components/ui/ToastProvider"
import { exportToCSV, exportToExcel, ExportColumn, formatCurrencyRaw, formatDate } from "@/lib/exportUtils"
import { getCurrencySymbol } from "@/lib/currency"
import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Invoice = {
  id: string
  invoice_number: string
  customer_id: string | null
  customers: {
    id: string
    name: string
    email: string | null
  } | null
  subtotal?: number
  vat?: number
  total: number
  status: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled"
  issue_date: string | null
  due_date: string | null
  created_at: string
}

function InvoicesPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { format } = useBusinessCurrency()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    // Initialize from URL params if present
    const status = searchParams.get("status")
    return status || "all"
  })
  const [customerFilter, setCustomerFilter] = useState<string>("all")
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")
  const [searchInput, setSearchInput] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [customers, setCustomers] = useState<any[]>([])
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    loadCustomers()
    loadInvoices()
  }, [])

  // INVARIANT 6: Rehydrate from backend when page regains focus (e.g., returning from send)
  useEffect(() => {
    const handleFocus = () => {
      if (businessId && !isInitialLoadRef.current) {
        loadInvoices()
      }
    }
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [businessId])

  // Debounced search effect - updates searchQuery after user stops typing
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    // Only show searching indicator if there's actual input
    if (searchInput.trim()) {
      setIsSearching(true)
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchInput])

  // Load invoices when filters change (including debounced searchQuery)
  useEffect(() => {
    if (businessId) {
      loadInvoices()
    }
  }, [businessId, statusFilter, customerFilter, startDate, endDate, searchQuery])

  const loadCustomers = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])
    } catch (err) {
      console.error("Error loading customers:", err)
    }
  }

  const loadInvoices = async () => {
    try {
      // Only show full loading screen on initial load, not for search-only updates
      if (isInitialLoadRef.current) {
        setLoading(true)
      }

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

      // Build query parameters
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.append("status", statusFilter)
      if (customerFilter !== "all") params.append("customer_id", customerFilter)
      if (startDate) params.append("start_date", startDate)
      if (endDate) params.append("end_date", endDate)
      if (searchQuery) params.append("search", searchQuery)

      const response = await fetch(`/api/invoices/list?${params.toString()}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const friendlyError = errorData.error || "We couldn't load your invoices. Please refresh the page or check your connection."
        throw new Error(friendlyError)
      }

      const { invoices: invoicesData } = await response.json()
      setInvoices(invoicesData || [])
      setLoading(false)
      isInitialLoadRef.current = false
    } catch (err: any) {
      setError(err.message || "We couldn't load your invoices. Please refresh the page or check your connection.")
      setLoading(false)
      isInitialLoadRef.current = false
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      partially_paid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
      cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-500",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
        {status.replace("_", " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
      </span>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  // Fetch payment totals and credit notes for invoices to calculate amount paid and outstanding
  const fetchInvoicePaymentTotals = async (invoiceIds: string[]): Promise<{
    payments: Record<string, number>
    creditNotes: Record<string, number>
  }> => {
    if (invoiceIds.length === 0) return { payments: {}, creditNotes: {} }

    try {
      const { data: payments } = await supabase
        .from("payments")
        .select("invoice_id, amount")
        .in("invoice_id", invoiceIds)
        .is("deleted_at", null)

      const { data: creditNotes } = await supabase
        .from("credit_notes")
        .select("invoice_id, total")
        .in("invoice_id", invoiceIds)
        .eq("status", "applied")
        .is("deleted_at", null)

      const paymentTotals: Record<string, number> = {}
      payments?.forEach((payment) => {
        const invoiceId = payment.invoice_id
        paymentTotals[invoiceId] = (paymentTotals[invoiceId] || 0) + Number(payment.amount || 0)
      })

      const creditNoteTotals: Record<string, number> = {}
      creditNotes?.forEach((cn) => {
        const invoiceId = cn.invoice_id
        creditNoteTotals[invoiceId] = (creditNoteTotals[invoiceId] || 0) + Number(cn.total || 0)
      })

      return { payments: paymentTotals, creditNotes: creditNoteTotals }
    } catch (err) {
      console.error("Error fetching payment totals:", err)
      return { payments: {}, creditNotes: {} }
    }
  }

  // Export invoices to CSV
  const handleExportCSV = async () => {
    try {
      if (invoices.length === 0) {
        toast.showToast("No invoices to export", "error")
        return
      }

      // Fetch payment totals and credit notes for all invoices
      const invoiceIds = invoices.map((inv) => inv.id)
      const { payments: paymentTotals, creditNotes: creditNoteTotals } = await fetchInvoicePaymentTotals(invoiceIds)

      // Prepare export data with payment and credit note calculations
      // Use canonical helper to read from tax_lines JSONB (source of truth) for VAT amount
      const exportData = invoices.map((invoice) => {
        const totalPaid = paymentTotals[invoice.id] || 0
        const totalCredits = creditNoteTotals[invoice.id] || 0
        const outstanding = Math.max(0, Number(invoice.total || 0) - totalPaid - totalCredits)
        // Use canonical helper to get VAT from tax_lines, fallback to legacy column for old invoices
        const { vat } = getGhanaLegacyView(invoice.tax_lines)
        const vatAmount = vat > 0 ? vat : (invoice.vat || 0)
        return {
          ...invoice,
          amountPaid: totalPaid,
          credits: totalCredits,
          outstanding,
          subtotal: Number(invoice.subtotal || 0),
          vat: vatAmount,
          total: Number(invoice.total || 0),
        }
      })

      // Define export columns
      const columns: ExportColumn<typeof exportData[0]>[] = [
        { header: "Invoice Number", accessor: (inv) => inv.invoice_number || "", width: 20 },
        { header: "Invoice Date", accessor: (inv) => formatDate(inv.issue_date), width: 15 },
        { header: "Due Date", accessor: (inv) => formatDate(inv.due_date), width: 15 },
        { header: "Customer", accessor: (inv) => inv.customers?.name || "No Customer", width: 30 },
        { header: "Status", accessor: (inv) => inv.status.replace("_", " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "), width: 15 },
        {
          header: "Subtotal",
          accessor: (inv) => inv.subtotal,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "VAT",
          accessor: (inv) => inv.vat,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Total",
          accessor: (inv) => inv.total,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Amount Paid",
          accessor: (inv) => inv.amountPaid,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Outstanding",
          accessor: (inv) => inv.outstanding,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
      ]

      exportToCSV(exportData, columns, "invoices")
      toast.showToast("Invoices exported to CSV successfully", "success")
    } catch (error: any) {
      console.error("Export error:", error)
      toast.showToast(error.message || "Failed to export invoices", "error")
    }
  }

  // Export invoices to Excel
  const handleExportExcel = async () => {
    try {
      if (invoices.length === 0) {
        toast.showToast("No invoices to export", "error")
        return
      }

      // Fetch payment totals and credit notes for all invoices
      const invoiceIds = invoices.map((inv) => inv.id)
      const { payments: paymentTotals, creditNotes: creditNoteTotals } = await fetchInvoicePaymentTotals(invoiceIds)

      // Prepare export data with payment and credit note calculations
      // Use canonical helper to read from tax_lines JSONB (source of truth) for VAT amount
      const exportData = invoices.map((invoice) => {
        const totalPaid = paymentTotals[invoice.id] || 0
        const totalCredits = creditNoteTotals[invoice.id] || 0
        const outstanding = Math.max(0, Number(invoice.total || 0) - totalPaid - totalCredits)
        // Use canonical helper to get VAT from tax_lines, fallback to legacy column for old invoices
        const { vat } = getGhanaLegacyView(invoice.tax_lines)
        const vatAmount = vat > 0 ? vat : (invoice.vat || 0)
        return {
          ...invoice,
          amountPaid: totalPaid,
          credits: totalCredits,
          outstanding,
          subtotal: Number(invoice.subtotal || 0),
          vat: vatAmount,
          total: Number(invoice.total || 0),
        }
      })

      // Define export columns (same as CSV but with Excel formatting)
      const columns: ExportColumn<typeof exportData[0]>[] = [
        { header: "Invoice Number", accessor: (inv) => inv.invoice_number || "", width: 20 },
        {
          header: "Invoice Date",
          accessor: (inv) => inv.issue_date || "",
          formatter: (val) => val ? formatDate(val) : "",
          excelType: "date",
          width: 15,
        },
        {
          header: "Due Date",
          accessor: (inv) => inv.due_date || "",
          formatter: (val) => val ? formatDate(val) : "",
          excelType: "date",
          width: 15,
        },
        { header: "Customer", accessor: (inv) => inv.customers?.name || "No Customer", width: 30 },
        { header: "Status", accessor: (inv) => inv.status.replace("_", " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "), width: 15 },
        {
          header: "Subtotal",
          accessor: (inv) => inv.subtotal,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "VAT",
          accessor: (inv) => inv.vat,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Total",
          accessor: (inv) => inv.total,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Amount Paid",
          accessor: (inv) => inv.amountPaid,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Outstanding",
          accessor: (inv) => inv.outstanding,
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
      ]

      await exportToExcel(exportData, columns, "invoices")
      toast.showToast("Invoices exported to Excel successfully", "success")
    } catch (error: any) {
      console.error("Export error:", error)
      toast.showToast(error.message || "Failed to export invoices", "error")
    }
  }

  // Calculate total revenue from actual payments (same as dashboard)
  // This is more accurate than using invoice status which can be out of sync
  useEffect(() => {
    const calculateTotalRevenue = async () => {
      if (!businessId) return
      
      try {
        const { data: payments } = await supabase
          .from("payments")
          .select("amount")
          .eq("business_id", businessId)
          .is("deleted_at", null)
        
        const revenue = payments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0
        setTotalRevenue(revenue)
      } catch (error) {
        console.error("Error calculating total revenue:", error)
      }
    }
    
    calculateTotalRevenue()
  }, [businessId])

  // Calculate outstanding amount properly: exclude drafts and calculate actual outstanding (total - payments - credits)
  // CRITICAL: Draft invoices are NOT financial documents and cannot be outstanding
  // Only issued/sent/partially_paid invoices can be outstanding
  const [outstandingAmount, setOutstandingAmount] = useState(0)
  
  useEffect(() => {
    const calculateOutstanding = async () => {
      if (!businessId || invoices.length === 0) {
        setOutstandingAmount(0)
        return
      }
      
      try {
        // Filter out drafts - only calculate outstanding for issued invoices
        const nonDraftInvoices = invoices.filter((inv) => 
          inv.status !== "draft" && 
          inv.status !== "paid" && 
          inv.status !== "cancelled" &&
          (inv.status === "sent" || inv.status === "overdue" || inv.status === "partially_paid")
        )
        
        if (nonDraftInvoices.length === 0) {
          setOutstandingAmount(0)
          return
        }
        
        // Fetch payments and credit notes for outstanding calculation
        const invoiceIds = nonDraftInvoices.map((inv) => inv.id)
        const { payments: paymentTotals, creditNotes: creditNoteTotals } = await fetchInvoicePaymentTotals(invoiceIds)
        
        // Calculate outstanding: invoice.total - payments - credit_notes
        const totalOutstanding = nonDraftInvoices.reduce((sum, inv) => {
          const totalPaid = paymentTotals[inv.id] || 0
          const totalCredits = creditNoteTotals[inv.id] || 0
          const outstanding = Math.max(0, Number(inv.total || 0) - totalPaid - totalCredits)
          return sum + outstanding
        }, 0)
        
        setOutstandingAmount(totalOutstanding)
      } catch (error) {
        console.error("Error calculating outstanding amount:", error)
        setOutstandingAmount(0)
      }
    }
    
    calculateOutstanding()
  }, [businessId, invoices])

  if (loading) {
    return (
      
        <LoadingScreen />
      
    )
  }

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Invoices"
            subtitle="Manage and track all your invoices"
            actions={
              <div className="flex gap-2">
                {invoices.length > 0 && (
                  <>
                    <Button
                      onClick={handleExportCSV}
                      variant="outline"
                      leftIcon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      }
                    >
                      Export CSV
                    </Button>
                    <Button
                      onClick={handleExportExcel}
                      variant="outline"
                      leftIcon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      }
                    >
                      Export Excel
                    </Button>
                  </>
                )}
                <Button
                  onClick={() => router.push("/invoices/create")}
                  leftIcon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  }
                >
                  New Invoice
                </Button>
              </div>
            }
          />

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-green-900 dark:text-green-300 font-semibold">Total Revenue:</span>
                <span className="text-green-900 dark:text-green-300 font-bold text-xl">{format(totalRevenue)}</span>
              </div>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border border-orange-200 dark:border-orange-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-orange-900 dark:text-orange-300 font-semibold">Outstanding:</span>
                <span className="text-orange-900 dark:text-orange-300 font-bold text-xl">{format(outstandingAmount)}</span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="md:col-span-2 lg:col-span-1">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Invoice #, client name, or notes..."
                    className="w-full min-w-0 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-colors"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Customer</label>
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="all">All Customers</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Start Date</label>
                <input
                  type="date"
                  lang="en"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Format: YYYY-MM-DD</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">End Date</label>
                <input
                  type="date"
                  lang="en"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Format: YYYY-MM-DD</p>
              </div>
            </div>
            <div className="mt-4">
              <button
                onClick={() => {
                  setStatusFilter("all")
                  setCustomerFilter("all")
                  setStartDate("")
                  setEndDate("")
                  setSearchInput("")
                  setSearchQuery("")
                }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                Clear all filters
              </button>
            </div>
          </div>

          {invoices.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              title="No invoices found"
              description="Get started by creating your first invoice to track your sales and payments."
              actionLabel="Create Your First Invoice"
              onAction={() => router.push("/invoices/create")}
            />
          ) : (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Invoice #
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Issue Date
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Due Date
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">{invoice.invoice_number}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {invoice.customers?.name || "No Customer"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-bold text-gray-900 dark:text-white">
                            {format(Number(invoice.total || 0))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(invoice.status)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600 dark:text-gray-400">{formatDate(invoice.issue_date)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600 dark:text-gray-400">{formatDate(invoice.due_date)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => router.push(`/invoices/${invoice.id}/view`)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors"
                            >
                              View
                            </button>
                            <button
                              onClick={() => router.push(`/invoices/${invoice.id}/view`)}
                              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    
  )
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    }>
      <InvoicesPageContent />
    </Suspense>
  )
}
