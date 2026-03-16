"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import { useToast } from "@/components/ui/ToastProvider"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type RecurringInvoice = {
  id: string
  invoice_number: string
  client_id: string | null
  client_name: string | null
  total_amount: number
  frequency: "weekly" | "monthly" | "quarterly" | "yearly"
  next_date: string
  status: "active" | "paused" | "cancelled"
  created_at: string
}

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const toast = useToast()
  const { format } = useBusinessCurrency()
  const [invoices, setInvoices] = useState<RecurringInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")

  useEffect(() => {
    loadRecurringInvoices()
  }, [])

  const loadRecurringInvoices = async () => {
    try {
      setLoading(true)

      // Check session first and refresh if needed
      let { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session) {
        console.error("Session error:", sessionError)
        // Try to refresh session
        const refreshResult = await supabase.auth.refreshSession()
        if (refreshResult.error || !refreshResult.data.session) {
          router.push("/login")
          return
        }
        sessionData = refreshResult.data
      }

      let {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        console.error("User error:", userError)
        // Try to refresh session and retry
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
        if (refreshError || !refreshData.session) {
          router.push("/login")
          return
        }
        // Retry getting user after refresh
        const retryResult = await supabase.auth.getUser()
        if (!retryResult.data.user) {
          router.push("/login")
          return
        }
        user = retryResult.data.user
      }

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        router.push("/login")
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Load recurring invoices - use basic select first to avoid join issues
      let query = supabase
        .from("recurring_invoices")
        .select("*")
        .eq("business_id", business.id)

      // Only filter by deleted_at if the column exists (some tables might not have it)
      // We'll filter in memory if needed
      const { data: recurringData, error: fetchError } = await query.order("created_at", { ascending: false })

      if (fetchError) {
        console.error("Error loading recurring invoices:", {
          code: fetchError.code,
          message: fetchError.message,
          details: fetchError.details,
          hint: fetchError.hint
        })

        // Handle 401 Unauthorized - session expired
        if (fetchError.code === "PGRST301" || fetchError.message?.includes("401") || fetchError.message?.includes("Unauthorized")) {
          // Try to refresh session
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
          if (refreshError || !refreshData.session) {
            setError("Session expired. Please log in again.")
            toast.showToast("Session expired. Redirecting to login...", "error")
            setTimeout(() => router.push("/login"), 2000)
            setLoading(false)
            return
          }
          // Retry the query after refresh
          const { data: retryData, error: retryError } = await supabase
            .from("recurring_invoices")
            .select("*")
            .eq("business_id", business.id)
            .order("created_at", { ascending: false })

          if (retryError) {
            setError("Session expired. Please log in again.")
            toast.showToast("Session expired. Redirecting to login...", "error")
            setTimeout(() => router.push("/login"), 2000)
            setLoading(false)
            return
          }

          // Process retry data
          const filteredData = (retryData || []).filter((inv: any) => !inv.deleted_at)

          // Load client names if needed
          const clientIds = filteredData
            .map((inv: any) => inv.client_id || inv.customer_id)
            .filter((id: any) => id !== null && id !== undefined)
            .filter((id: any, index: number, self: any[]) => self.indexOf(id) === index)

          let clientsMap: Record<string, string> = {}
          if (clientIds.length > 0) {
            try {
              const { data: customersData } = await supabase
                .from("customers")
                .select("id, name")
                .in("id", clientIds)
                .is("deleted_at", null)
              if (customersData) {
                customersData.forEach((customer: any) => {
                  clientsMap[customer.id] = customer.name
                })
              }
            } catch (e) {
              console.warn("Could not load customer names:", e)
            }
          }

          // Map the retry data
          const mappedInvoices = filteredData.map((inv: any) => {
            let invoiceNumber = inv.invoice_number
            if (!invoiceNumber && inv.invoice_template_data) {
              try {
                const templateData = typeof inv.invoice_template_data === 'string'
                  ? JSON.parse(inv.invoice_template_data)
                  : inv.invoice_template_data
                invoiceNumber = templateData?.invoice_number || templateData?.invoice_prefix || `REC-${inv.id.substring(0, 8)}`
              } catch (e) {
                invoiceNumber = `REC-${inv.id.substring(0, 8)}`
              }
            }
            if (!invoiceNumber) {
              invoiceNumber = `REC-${inv.id.substring(0, 8)}`
            }

            let totalAmount = inv.total_amount
            if ((!totalAmount || totalAmount === 0) && inv.invoice_template_data) {
              try {
                const templateData = typeof inv.invoice_template_data === 'string'
                  ? JSON.parse(inv.invoice_template_data)
                  : inv.invoice_template_data
                totalAmount = templateData?.total || templateData?.total_amount || 0
              } catch (e) {
                totalAmount = 0
              }
            }

            const clientId = inv.client_id || inv.customer_id
            const customerName = clientId ? (clientsMap[clientId] || "No Customer") : "No Customer"

            return {
              id: inv.id,
              invoice_number: invoiceNumber,
              client_id: clientId,
              client_name: customerName,
              total_amount: Number(totalAmount || 0),
              frequency: inv.frequency || "monthly",
              next_date: inv.next_run_date || inv.next_invoice_date || inv.next_date,
              status: inv.status || "active",
              created_at: inv.created_at,
            }
          })

          setInvoices(mappedInvoices)
          setError("")
          setLoading(false)
          return
        }

        // If table doesn't exist, show empty state
        if (fetchError.code === "42P01") {
          setInvoices([])
          setLoading(false)
          return
        }

        if (fetchError.code === "42501" || fetchError.message?.includes("permission") || fetchError.message?.includes("policy")) {
          throw new Error("Unable to load recurring invoices.")
        }

        throw fetchError
      }

      // Check if we got data
      if (!recurringData) {
        console.warn("No data returned from recurring_invoices query")
        setInvoices([])
        setLoading(false)
        return
      }

      // Filter out deleted invoices in memory (in case deleted_at column doesn't exist or query failed)
      const data = recurringData.filter((inv: any) => !inv.deleted_at)

      // Load client names separately if we have client_ids
      const clientIds = data
        .map((inv: any) => inv.client_id || inv.customer_id)
        .filter((id: any) => id !== null && id !== undefined)
        .filter((id: any, index: number, self: any[]) => self.indexOf(id) === index) // Remove duplicates

      let clientsMap: Record<string, string> = {}
      if (clientIds.length > 0) {
        try {
          // Load from customers table
          const { data: customersData, error: customersError } = await supabase
            .from("customers")
            .select("id, name")
            .in("id", clientIds)
            .is("deleted_at", null)

          if (!customersError && customersData) {
            customersData.forEach((customer: any) => {
              clientsMap[customer.id] = customer.name
            })
          }
        } catch (e) {
          // If loading customers fails, continue without customer names
          console.warn("Could not load customer names:", e)
        }
      }

      // Map the data
      let mappedInvoices: RecurringInvoice[] = []
      try {
        mappedInvoices = data.map((inv: any) => {
          // Extract invoice_number from template_data if it exists
          let invoiceNumber = inv.invoice_number
          if (!invoiceNumber && inv.invoice_template_data) {
            try {
              const templateData = typeof inv.invoice_template_data === 'string'
                ? JSON.parse(inv.invoice_template_data)
                : inv.invoice_template_data
              invoiceNumber = templateData?.invoice_number || templateData?.invoice_prefix || `REC-${inv.id.substring(0, 8)}`
            } catch (e) {
              invoiceNumber = `REC-${inv.id.substring(0, 8)}`
            }
          }
          if (!invoiceNumber) {
            invoiceNumber = `REC-${inv.id.substring(0, 8)}`
          }

          // Extract total_amount from template_data if needed
          let totalAmount = inv.total_amount
          if ((!totalAmount || totalAmount === 0) && inv.invoice_template_data) {
            try {
              const templateData = typeof inv.invoice_template_data === 'string'
                ? JSON.parse(inv.invoice_template_data)
                : inv.invoice_template_data
              totalAmount = templateData?.total || templateData?.total_amount || 0
            } catch (e) {
              totalAmount = 0
            }
          }

          const clientId = inv.client_id || inv.customer_id
          const customerName = clientId ? (clientsMap[clientId] || "No Customer") : "No Customer"

          return {
            id: inv.id,
            invoice_number: invoiceNumber,
            client_id: clientId,
              client_name: customerName,
            total_amount: Number(totalAmount || 0),
            frequency: inv.frequency || "monthly",
            next_date: inv.next_run_date || inv.next_invoice_date || inv.next_date,
            status: inv.status || "active",
            created_at: inv.created_at,
          }
        })
      } catch (mapError: any) {
        console.error("Error mapping recurring invoices data:", mapError)
        throw new Error(`Failed to process recurring invoices: ${mapError.message || mapError}`)
      }

      setInvoices(mappedInvoices)
      setError("")
      setLoading(false)
    } catch (err: any) {
      console.error("Error loading recurring invoices:", err)
      const isPermissionError = err.code === "42501" || err.message?.includes("permission") || err.message?.includes("policy")
      const errorMessage = isPermissionError ? "Unable to load recurring invoices." : (err.message || err.code || "Failed to load recurring invoices")
      setError(errorMessage)
      toast.showToast(errorMessage, "error")
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: "bg-green-100 text-green-800",
      paused: "bg-yellow-100 text-yellow-800",
      cancelled: "bg-gray-100 text-gray-500",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.active}`}>
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

  if (loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Recurring Invoices"
            subtitle="Manage your recurring invoices"
            actions={
              <Button
                onClick={() => router.push("/recurring/create")}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                }
              >
                Create Recurring Invoice
              </Button>
            }
          />

          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {invoices.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
              title="No recurring invoices found"
              description="Set up recurring invoices to automatically generate and send invoices on a schedule."
              actionLabel="Create Recurring Invoice"
              onAction={() => router.push("/recurring/create")}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Invoice #
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Frequency
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Next Invoice
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{invoice.invoice_number}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{invoice.client_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {format(invoice.total_amount)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600 capitalize">{invoice.frequency}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600">{formatDate(invoice.next_date)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(invoice.status)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => router.push(`/recurring/${invoice.id}/view`)}
                              className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
                            >
                              View
                            </button>
                            <button
                              onClick={() => router.push(`/recurring/${invoice.id}/edit`)}
                              className="text-gray-600 hover:text-gray-800 font-medium transition-colors"
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
    </ProtectedLayout>
  )
}

