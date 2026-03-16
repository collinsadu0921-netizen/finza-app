"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import Toast from "@/components/Toast"
import SendOrderConfirmationModal from "@/components/orders/SendOrderConfirmationModal"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type Order = {
  id: string
  customer_id: string | null
  estimate_id: string | null
  invoice_id: string | null
  status: string
  subtotal: number
  total_tax: number
  total_amount: number
  notes: string | null
  created_at: string
  updated_at: string
  public_token?: string | null
  customers: {
    id: string
    name: string
    email: string | null
    phone: string | null
    whatsapp_phone?: string | null
    address: string | null
  } | null
  estimates: {
    id: string
    estimate_number: string
    status: string
  } | null
  invoices: {
    id: string
    invoice_number: string
    status: string
  } | null
}

type OrderItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
  products_services: {
    id: string
    name: string
  } | null
}

export default function OrderViewPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = (params?.id as string) || ""
  const { openConfirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [error, setError] = useState("")
  const [converting, setConverting] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)

  useEffect(() => {
    if (orderId) {
      loadOrder()
    }
  }, [orderId])

  const loadOrder = async () => {
    try {
      setLoading(true)
      setError("")

      const response = await fetch(`/api/orders/${orderId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (response.status === 404) {
          throw new Error("We couldn't find this order. It may have been deleted or the link is incorrect.")
        } else {
          throw new Error(errorData.error || "We couldn't load this order. Please refresh or check your connection.")
        }
      }

      const data = await response.json()
      setOrder(data.order)
      setItems(data.items || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "We couldn't load this order. Please refresh or check your connection.")
      setLoading(false)
    }
  }

  const handleIssueOrder = async () => {
    if (!order) return
    openConfirm({
      title: "Issue order",
      description: "Are you sure you want to issue this order? Once issued, the order cannot be edited directly (revisions can be created).",
      onConfirm: () => runIssueOrder(),
    })
  }

  const runIssueOrder = async () => {
    if (!order) return
    try {
      setIssuing(true)
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "issued",
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setToast({ message: "Order issued successfully", type: "success" })
        await loadOrder() // Reload to get updated status
      } else {
        setToast({ message: data.error || "Failed to issue order", type: "error" })
      }
    } catch (err: any) {
      setToast({ message: err.message || "Error issuing order", type: "error" })
    } finally {
      setIssuing(false)
    }
  }

  const handleSendConfirmationSuccess = async () => {
    setToast({ message: "Order confirmation sent successfully", type: "success" })
    await loadOrder() // Reload to get updated confirmation metadata
  }

  const handleConvertToInvoice = async () => {
    if (!order) return
    openConfirm({
      title: "Convert to invoice",
      description: "Are you sure you want to convert this order to an invoice? This action cannot be undone.",
      onConfirm: () => runConvertToInvoice(),
    })
  }

  const runConvertToInvoice = async () => {
    if (!order) return
    try {
      setConverting(true)
      const response = await fetch(`/api/orders/${orderId}/convert-to-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })

      // Read raw response body first (can only be read once)
      let raw = ""
      try {
        raw = await response.text()
      } catch (readError) {
        console.error("Failed to read response body:", readError)
        raw = "(failed to read response body)"
      }

      // Log raw response immediately for debugging
      console.log("Raw response:", {
        status: response.status,
        statusText: response.statusText,
        raw: raw,
        rawLength: raw?.length || 0,
        rawType: typeof raw,
      })

      let data: any = {}
      let parseError = null
      
      // Try to parse as JSON
      try {
        if (raw && raw.trim()) {
          data = JSON.parse(raw)
        } else {
          // Empty response body
          data = { 
            error: `Empty response from server (${response.status})`,
            message: `Server returned empty response with status ${response.status}` 
          }
        }
      } catch (e) {
        parseError = e
        // If JSON parse fails, use raw text as message
        const rawText = raw || "(empty response body)"
        data = { 
          error: rawText, 
          message: rawText,
          parseError: parseError instanceof Error ? parseError.message : String(parseError)
        }
      }

      if (response.ok) {
        setToast({ message: "Order converted to invoice successfully! Redirecting...", type: "success" })
        // Reload order data first to get updated status
        await loadOrder()
        // Redirect: draft → edit (pre-filled form); sent/issued → view
        const redirectPath =
          data.invoiceId
            ? (data.invoice?.status === "draft"
                ? `/service/invoices/${data.invoiceId}/edit`
                : `/service/invoices/${data.invoiceId}/view`)
            : data.invoiceUrl
              ? (String(data.invoiceUrl).startsWith("/service/")
                  ? String(data.invoiceUrl)
                  : String(data.invoiceUrl).replace(/^\/invoices\//, "/service/invoices/"))
              : "/service/invoices"
        console.log("Order conversion response JSON:", data)
        console.log("Order->Invoice redirect path:", redirectPath)
        setTimeout(() => {
          router.push(redirectPath)
        }, 500)
      } else {
        // Log full error details for debugging - log each property separately
        console.error("=== CONVERSION ERROR ===")
        console.error("Status:", response.status)
        console.error("Status Text:", response.statusText)
        console.error("Raw Response:", raw)
        console.error("Raw Length:", raw?.length || 0)
        console.error("Parsed Data:", JSON.stringify(data, null, 2))
        console.error("Parse Error:", parseError)
        console.error("Full Error Object:", {
          status: response.status,
          statusText: response.statusText,
          raw: raw,
          rawLength: raw?.length || 0,
          parsed: data,
          parseError: parseError,
        })
        
        // Show best available error message
        const errorMessage = 
          data.error_message || 
          data.error || 
          data.message || 
          (raw && raw.trim()) || 
          `Failed to convert order (${response.status} ${response.statusText})`
        
        setToast({ message: errorMessage, type: "error" })
        setConverting(false)
      }
    } catch (err: any) {
      console.error("Error converting order:", err)
      setToast({ 
        message: err.message || "Error converting order. Please check your connection and try again.", 
        type: "error" 
      })
      setConverting(false)
    }
  }

  const handleExecutionStatusChange = async (newExecutionStatus: string) => {
    if (!order) return

    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execution_status: newExecutionStatus }),
      })

      if (response.ok) {
        setToast({ message: "Order execution status updated successfully!", type: "success" })
        loadOrder() // Refresh order data
      } else {
        const data = await response.json()
        setToast({ message: data.error || "Failed to update execution status", type: "error" })
      }
    } catch (err: any) {
      setToast({ message: "Error updating execution status. Please try again.", type: "error" })
    }
  }

  const getCommercialStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
      issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      converted: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
      cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    }
    const statusLabels: Record<string, string> = {
      draft: "Draft",
      issued: "Issued",
      converted: "Converted",
      cancelled: "Cancelled",
    }
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status] || "bg-gray-100 text-gray-800"}`}>
        {statusLabels[status] || status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const getExecutionStatusBadge = (executionStatus: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
    }
    const statusLabels: Record<string, string> = {
      pending: "Pending",
      active: "Active",
      completed: "Completed",
    }
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[executionStatus] || "bg-gray-100 text-gray-800"}`}>
        {statusLabels[executionStatus] || executionStatus.charAt(0).toUpperCase() + executionStatus.slice(1)}
      </span>
    )
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || (!loading && !order)) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Unable to load this order."}
          </div>
          <button
            onClick={() => router.push("/service/orders")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Orders
          </button>
        </div>
      </ProtectedLayout>
    )
  }

  // Extra check for TypeScript
  if (!order) return null

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Order #{order.id.substring(0, 8).toUpperCase()}</h1>
            <p className="text-gray-600 dark:text-gray-400">View and manage your order</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Issue Order button - Show for draft orders */}
            {order.status === "draft" && !order.invoice_id && (
              <button
                onClick={handleIssueOrder}
                disabled={issuing}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {issuing ? "Issuing..." : "Issue Order"}
              </button>
            )}
            {/* Edit button - Show for draft and issued (issued creates revision) */}
            {(order.status === "draft" || order.status === "issued") && !order.invoice_id && (
              <button
                onClick={() => router.push(`/service/orders/${orderId}/edit`)}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
              >
                Edit{order.status === "issued" ? " (Creates Revision)" : ""}
              </button>
            )}
            {/* Send Order Confirmation - Show for issued orders */}
            {!order.invoice_id && order.status === "issued" && (
              <button
                onClick={() => setShowSendModal(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
              >
                Send Order Confirmation
              </button>
            )}
            {/* Convert to Invoice - Show for issued orders (any execution status) */}
            {!order.invoice_id && order.status === "issued" && (
              <button
                onClick={handleConvertToInvoice}
                disabled={converting}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {converting ? "Converting..." : "Convert to Invoice"}
              </button>
            )}
            {/* Show View Invoice button if order has been converted to invoice */}
            {order.invoice_id && order.invoices && (
              <button
                onClick={() => router.push(`/service/invoices/${order.invoice_id}/view`)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                View Invoice ({order.invoices.invoice_number})
              </button>
            )}
            {/* Show read-only indicator for converted/cancelled orders */}
            {(order.status === "converted" || order.status === "cancelled") && (
              <div className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Read-only ({order.status})</span>
              </div>
            )}
          </div>
        </div>

        {/* Status Badges - Commercial and Execution */}
        <div className="mb-6 flex gap-4 items-center">
          <div>
            <span className="text-xs text-gray-500 mb-1 block">Commercial Status</span>
            {getCommercialStatusBadge(order.status)}
          </div>
          {order.status === "issued" && order.execution_status && (
            <div>
              <span className="text-xs text-gray-500 mb-1 block">Execution Status</span>
              {getExecutionStatusBadge(order.execution_status)}
            </div>
          )}
        </div>

        {/* Execution Status Change Buttons - Only for issued orders */}
        {order.status === "issued" && order.execution_status !== "completed" && (
          <div className="mb-6 flex gap-2 flex-wrap">
            {order.execution_status !== "active" && order.execution_status === "pending" && (
              <button
                onClick={() => handleExecutionStatusChange("active")}
                className="bg-green-100 text-green-800 px-3 py-1 rounded-lg hover:bg-green-200 text-sm"
              >
                Mark as Active
              </button>
            )}
            {order.execution_status === "active" && (
              <button
                onClick={() => handleExecutionStatusChange("completed")}
                className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-lg hover:bg-emerald-200 text-sm"
              >
                Mark as Completed
              </button>
            )}
          </div>
        )}

        {/* Order Details */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Customer</h3>
              <p className="text-lg font-semibold dark:text-white">{order.customers?.name || "No Customer"}</p>
              {order.customers?.email && (
                <p className="text-sm text-gray-600 dark:text-gray-400">{order.customers.email}</p>
              )}
              {order.customers?.phone && (
                <p className="text-sm text-gray-600 dark:text-gray-400">{order.customers.phone}</p>
              )}
              {order.customers?.address && (
                <p className="text-sm text-gray-600 dark:text-gray-400">{order.customers.address}</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Order Details</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Created: {new Date(order.created_at).toLocaleDateString()}
              </p>
              {order.estimates && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Source Quote:{" "}
                  <button
                    onClick={() => router.push(`/service/estimates/${order.estimates!.id}/view`)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    {order.estimates.estimate_number}
                  </button>
                </p>
              )}
            </div>
          </div>

          {/* Line Items */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">Line Items</h3>
            {items && items.length > 0 ? (
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Description</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">Quantity</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">Unit Price</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item, index) => (
                    <tr key={item.id || index}>
                      <td className="px-4 py-3 dark:text-white">{item.description || "No description"}</td>
                      <td className="px-4 py-3 text-right dark:text-white">{Number(item.quantity) || 0}</td>
                      <td className="px-4 py-3 text-right dark:text-white">₵{Number(item.unit_price || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium dark:text-white">₵{Number(item.line_total || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
                <p>No line items found for this order.</p>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                  <span className="font-medium dark:text-white">₵{Number(order.subtotal).toFixed(2)}</span>
                </div>
                {order.total_tax > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                    <span className="font-medium dark:text-white">₵{Number(order.total_tax).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg pt-2 border-t-2 border-gray-300 dark:border-gray-600">
                  <span className="font-bold dark:text-white">Total:</span>
                  <span className="font-bold dark:text-white">₵{Number(order.total_amount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Notes</h3>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}

        {/* Send Order Confirmation Modal */}
        {showSendModal && order && (
          <SendOrderConfirmationModal
            order={order}
            orderId={orderId}
            onClose={() => setShowSendModal(false)}
            onSuccess={handleSendConfirmationSuccess}
            defaultMethod="whatsapp"
          />
        )}
      </div>
    </ProtectedLayout>
  )
}

