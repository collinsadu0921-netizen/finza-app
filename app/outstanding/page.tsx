"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"

type Invoice = {
  id: string
  invoice_number: string
  due_date: string | null
  total: number
  status: string
  customers: {
    id: string
    name: string
  } | null
}

export default function OutstandingInvoicesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    loadOutstandingInvoices()
  }, [])

  const loadOutstandingInvoices = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in to view outstanding invoices")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayISO = today.toISOString().split("T")[0]

      // Fetch invoices with due_date < today (we'll filter by outstanding_amount from payments)
      // Do NOT filter by status - use financial state calculation instead
      const { data: allInvoicesData, error: invoicesError } = await supabase
        .from("invoices")
        .select(
          `
          id,
          invoice_number,
          due_date,
          total,
          status,
          customers (
            id,
            name
          )
        `
        )
        .eq("business_id", business.id)
        .not("due_date", "is", null)
        .lt("due_date", todayISO)
        .is("deleted_at", null)

      if (invoicesError) {
        console.error("Error loading invoices:", invoicesError)
        setError("Failed to load invoices")
        setLoading(false)
        return
      }

      if (!allInvoicesData || allInvoicesData.length === 0) {
        setInvoices([])
        setLoading(false)
        return
      }

      // Get all payments and credit notes to calculate outstanding amounts
      const invoiceIds = allInvoicesData.map((inv: any) => inv.id)
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

      // Calculate outstanding amounts: invoice.total - sum(payments) - sum(credit_notes)
      const invoicePaymentsMap: Record<string, number> = {}
      payments?.forEach((p: any) => {
        if (p.invoice_id) {
          invoicePaymentsMap[p.invoice_id] = (invoicePaymentsMap[p.invoice_id] || 0) + Number(p.amount || 0)
        }
      })

      const invoiceCreditNotesMap: Record<string, number> = {}
      creditNotes?.forEach((cn: any) => {
        if (cn.invoice_id) {
          invoiceCreditNotesMap[cn.invoice_id] = (invoiceCreditNotesMap[cn.invoice_id] || 0) + Number(cn.total || 0)
        }
      })

      // Filter to only overdue invoices: outstanding_amount > 0 AND due_date < today
      // Paid invoices (outstanding_amount = 0) must be excluded
      // Draft invoices (not yet issued) must be excluded
      const overdueInvoices = allInvoicesData.filter((inv: any) => {
        // Exclude draft invoices (not yet issued)
        if (inv.status === "draft") {
          return false
        }
        
        const totalPaid = invoicePaymentsMap[inv.id] || 0
        const totalCredits = invoiceCreditNotesMap[inv.id] || 0
        const outstandingAmount = Math.max(0, Number(inv.total || 0) - totalPaid - totalCredits)
        
        // Exclude fully paid invoices (outstanding_amount = 0)
        return outstandingAmount > 0
      })

      const formattedInvoices = overdueInvoices.map((inv: any) => ({
        ...inv,
        customers: Array.isArray(inv.customers) && inv.customers.length > 0 ? inv.customers[0] : inv.customers
      }))
      setInvoices(formattedInvoices)
      setLoading(false)
    } catch (err: any) {
      console.error("Error loading outstanding invoices:", err)
      setError(err.message || "Failed to load outstanding invoices")
      setLoading(false)
    }
  }

  const calculateDaysOverdue = (dueDate: string | null): number => {
    if (!dueDate) return 0
    const due = new Date(dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    due.setHours(0, 0, 0, 0)
    const diffTime = today.getTime() - due.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays > 0 ? diffDays : 0
  }

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { bg: string; text: string; darkBg: string; darkText: string; border: string }> = {
      sent: {
        bg: "bg-orange-50/90",
        text: "text-orange-700",
        darkBg: "dark:bg-orange-950/25",
        darkText: "dark:text-orange-400",
        border: "border border-orange-100 dark:border-orange-900/40",
      },
      partially_paid: {
        bg: "bg-amber-50/90",
        text: "text-amber-700",
        darkBg: "dark:bg-amber-950/25",
        darkText: "dark:text-amber-400",
        border: "border border-amber-100 dark:border-amber-900/40",
      },
      paid: {
        bg: "bg-emerald-50/90",
        text: "text-emerald-600",
        darkBg: "dark:bg-emerald-950/25",
        darkText: "dark:text-emerald-400",
        border: "border border-emerald-100 dark:border-emerald-900/40",
      },
      overdue: {
        bg: "bg-red-50/90",
        text: "text-red-600",
        darkBg: "dark:bg-red-950/20",
        darkText: "dark:text-red-400",
        border: "border border-red-100 dark:border-red-900/40",
      },
    }

    const config = statusConfig[status] || {
      bg: "bg-gray-100",
      text: "text-gray-800",
      darkBg: "dark:bg-gray-700",
      darkText: "dark:text-gray-300",
      border: "border border-gray-200 dark:border-gray-600",
    }

    return (
      <span
        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text} ${config.darkBg} ${config.darkText} ${config.border}`}
      >
        {status.replace("_", " ").split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
      </span>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Overdue Invoices</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Invoices with outstanding balance past their due date
                </p>
              </div>
              <button
                onClick={() => router.push("/dashboard")}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                ← Back to Dashboard
              </button>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading outstanding invoices...</p>
            </div>
          ) : error ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <div className="text-center">
                <p className="text-red-600 dark:text-red-400">{error}</p>
                <button
                  onClick={loadOutstandingInvoices}
                  className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : invoices.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
              <svg
                className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-gray-600 dark:text-gray-400 font-medium mb-1">No outstanding invoices</p>
              <p className="text-sm text-gray-500 dark:text-gray-500">All invoices are up to date!</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Invoice #
                      </th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Due Date
                      </th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Days Overdue
                      </th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-5 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800">
                    {invoices.map((invoice) => {
                      const daysOverdue = calculateDaysOverdue(invoice.due_date)
                      return (
                        <tr
                          key={invoice.id}
                          className={`
                            cursor-pointer transition-colors duration-150
                            bg-red-100/90 hover:bg-red-200/90 dark:bg-red-950/40 dark:hover:bg-red-950/55
                            border-b border-red-200/70 dark:border-red-900/30
                          `}
                        >
                          <td className="px-5 py-2 whitespace-nowrap text-left">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/invoices/${invoice.id}/view`)
                              }}
                              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                            >
                              {invoice.invoice_number || "Invoice"}
                            </button>
                          </td>
                          <td className="px-5 py-2 whitespace-nowrap">
                            <span className="text-sm text-gray-900 dark:text-white">
                              {invoice.customers?.name || "No Customer"}
                            </span>
                          </td>
                          <td className="px-5 py-2 whitespace-nowrap">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              ₵{Number(invoice.total || 0).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-5 py-2 whitespace-nowrap">
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {invoice.due_date
                                ? new Date(invoice.due_date).toLocaleDateString("en-GH", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })
                                : "-"}
                            </span>
                          </td>
                          <td className="px-5 py-2 whitespace-nowrap">
                            <span
                              className={`text-sm font-medium ${daysOverdue > 30
                                  ? "text-red-600 dark:text-red-400"
                                  : daysOverdue > 14
                                    ? "text-orange-600 dark:text-orange-400"
                                    : "text-yellow-600 dark:text-yellow-400"
                                }`}
                            >
                              {daysOverdue} {daysOverdue === 1 ? "day" : "days"}
                            </span>
                          </td>
                          <td className="px-5 py-2 whitespace-nowrap">{getStatusBadge(invoice.status)}</td>
                          <td className="px-5 py-2 whitespace-nowrap text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/invoices/${invoice.id}/view`)
                              }}
                              className="px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
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





