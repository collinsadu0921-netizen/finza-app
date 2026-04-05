"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { NativeSelect } from "@/components/ui/NativeSelect"

type RecurringInvoice = {
  id: string
  frequency: string
  next_run_date: string
  auto_send: boolean
  auto_whatsapp: boolean
  status: string
  last_run_date: string | null
  customers: {
    name: string
    email: string | null
  } | null
}

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([])
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  useEffect(() => {
    loadRecurringInvoices()
  }, [statusFilter])

  const loadRecurringInvoices = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not logged in")
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) throw new Error("Business not found")

      const params = new URLSearchParams()
      params.append("business_id", business.id)
      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }

      const response = await fetch(`/api/recurring-invoices/list?${params.toString()}`)
      if (!response.ok) {
        throw new Error("Failed to load recurring invoices")
      }

      const { recurringInvoices: data } = await response.json()
      setRecurringInvoices(data || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load recurring invoices")
      setLoading(false)
    }
  }

  const formatFrequency = (frequency: string) => {
    const frequencies: Record<string, string> = {
      weekly: "Weekly",
      biweekly: "Bi-weekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      yearly: "Yearly",
    }
    return frequencies[frequency] || frequency
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      paused: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.paused}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "active" ? "paused" : "active"
      const response = await fetch(`/api/recurring-invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        throw new Error("Failed to update status")
      }

      loadRecurringInvoices()
    } catch (err: any) {
      setError(err.message || "Failed to update status")
    }
  }

  const handleGenerateNow = async (id: string) => {
    try {
      const response = await fetch("/api/recurring-invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurring_invoice_id: id }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to generate invoice")
      }

      const { invoice, whatsappInfo } = await response.json()

      if (whatsappInfo?.url) {
        window.open(whatsappInfo.url, "_blank", "noopener,noreferrer")
      }

      toast.showToast(`Invoice ${invoice.invoice_number} generated successfully!`, "success")
      loadRecurringInvoices()
    } catch (err: any) {
      setError(err.message || "Failed to generate invoice")
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
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Recurring Invoices
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">Manage automated recurring billing</p>
            </div>
            <button
              onClick={() => router.push("/recurring/create")}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Recurring Invoice
            </button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 mb-6">
            <div className="flex items-center gap-4">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Status:</label>
              <NativeSelect
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                wrapperClassName="w-auto min-w-[8rem]"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </NativeSelect>
            </div>
          </div>

          {recurringInvoices.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center">
              <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-gray-600 dark:text-gray-400 font-medium text-lg mb-2">No recurring invoices found</p>
              <p className="text-gray-500 dark:text-gray-500 text-sm mb-6">Create your first recurring invoice to automate billing</p>
              <button
                onClick={() => router.push("/recurring/create")}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all inline-flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Recurring Invoice
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Customer</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Frequency</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Next Run</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Last Run</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Auto Send</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {recurringInvoices.map((recurring) => (
                      <tr key={recurring.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {recurring.customers?.name || "No Customer"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-700 dark:text-gray-300">{formatFrequency(recurring.frequency)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-700 dark:text-gray-300">
                            {new Date(recurring.next_run_date).toLocaleDateString("en-GH")}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-700 dark:text-gray-300">
                            {recurring.last_run_date ? new Date(recurring.last_run_date).toLocaleDateString("en-GH") : "Never"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {recurring.auto_send && (
                              <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 px-2 py-1 rounded">Email</span>
                            )}
                            {recurring.auto_whatsapp && (
                              <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300 px-2 py-1 rounded">WhatsApp</span>
                            )}
                            {!recurring.auto_send && !recurring.auto_whatsapp && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">Manual</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(recurring.status)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleGenerateNow(recurring.id)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors"
                              title="Generate now"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                            <button
                              onClick={() => router.push(`/recurring/${recurring.id}/view`)}
                              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors"
                            >
                              View
                            </button>
                            <button
                              onClick={() => router.push(`/recurring/${recurring.id}/edit`)}
                              className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300 font-medium transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleStatus(recurring.id, recurring.status)}
                              className={`font-medium transition-colors ${
                                recurring.status === "active"
                                  ? "text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300"
                                  : "text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
                              }`}
                            >
                              {recurring.status === "active" ? "Pause" : "Resume"}
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

