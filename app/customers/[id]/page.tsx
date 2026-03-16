"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Customer = {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  status: "active" | "blocked"
  created_at: string
  updated_at: string
}

type Sale = {
  id: string
  amount: number
  payment_status: string
  payment_method: string
  created_at: string
  store_id?: string | null
}

type LayawayPlan = {
  id: string
  sale_id: string
  total_amount: number
  deposit_amount: number
  outstanding_amount: number
  status: "active" | "completed" | "cancelled"
  created_at: string
  completed_at: string | null
}

export default function CustomerProfilePage() {
  const params = useParams()
  const router = useRouter()
  const customerId = params.id as string

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [sales, setSales] = useState<Sale[]>([])
  const [layawayPlans, setLayawayPlans] = useState<LayawayPlan[]>([])
  const [industry, setIndustry] = useState<string>("service")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editPhone, setEditPhone] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editStatus, setEditStatus] = useState<"active" | "blocked">("active")
  const [saving, setSaving] = useState(false)
  const { currencyCode } = useBusinessCurrency()

  useEffect(() => {
    loadCustomer()
  }, [customerId])

  const loadCustomer = async () => {
    try {
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
      setIndustry(business.industry ?? "service")

      const response = await fetch(`/api/customers/${customerId}`)
      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Customer not found")
        setLoading(false)
        return
      }

      const data = await response.json()
      setCustomer(data.customer)
      const ws = data.industry ?? "service"
      setIndustry(ws)
      if (ws === "retail") {
        setSales(data.sales || [])
        const { data: layawayData, error: layawayError } = await supabase
          .from("layaway_plans")
          .select("*")
          .eq("customer_id", customerId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
        if (!layawayError && layawayData) setLayawayPlans(layawayData)
      } else {
        setSales([])
        setLayawayPlans([])
      }
      setEditName(data.customer.name)
      setEditPhone(data.customer.phone || "")
      setEditEmail(data.customer.email || "")
      setEditStatus(data.customer.status)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load customer")
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!editName.trim()) {
      setError("Name is required")
      return
    }

    setSaving(true)
    setError("")

    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          phone: editPhone.trim() || null,
          email: editEmail.trim() || null,
          status: editStatus,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setCustomer(data.customer)
        setEditing(false)
        setToast({ message: "Customer updated", type: "success" })
      } else {
        const errorData = await response.json()
        setError(errorData.error || "Failed to update customer")
      }
    } catch (err: any) {
      setError(err.message || "Failed to update customer")
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatPaymentMethod = (method: string) => {
    const methods: Record<string, string> = {
      cash: "Cash",
      momo: "Mobile Money",
      card: "Card",
    }
    return methods[method] || method
  }

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading customer...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || !customer) {
    const isRetail = industry === "retail"
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Customer not found"}
          </div>
          <button
            onClick={() => router.push(isRetail ? "/pos" : "/customers")}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            {isRetail ? "Back to POS" : "Back to Customers"}
          </button>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Customer Profile</h1>
            <p className="text-gray-600">Customer ID: {customer.id.substring(0, 8)}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/customers/${customerId}/360`)}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              View 360
            </button>
            <button
              onClick={() => router.push(`/customers/${customerId}/statement`)}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              View Statement
            </button>
            {industry === "retail" && (
              <button
                onClick={() => router.push("/pos")}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
              >
                Back to POS
              </button>
            )}
          </div>
        </div>

        {/* Customer Details */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-semibold">Customer Information</h2>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border p-2 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Optional"
                  className="w-full border p-2 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Optional"
                  className="w-full border p-2 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as "active" | "blocked")}
                  className="w-full border p-2 rounded"
                >
                  <option value="active">Active</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !editName.trim()}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false)
                    setEditName(customer.name)
                    setEditPhone(customer.phone || "")
                    setEditEmail(customer.email || "")
                    setEditStatus(customer.status)
                    setError("")
                  }}
                  className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-600">Name</label>
                <p className="text-lg font-semibold">{customer.name}</p>
              </div>
              {customer.phone && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Phone</label>
                  <p className="text-lg">{customer.phone}</p>
                </div>
              )}
              {customer.email && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Email</label>
                  <p className="text-lg">{customer.email}</p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-600">Status</label>
                <p className="text-lg">
                  <span
                    className={`px-2 py-1 rounded text-sm font-semibold ${
                      customer.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {customer.status === "active" ? "Active" : "Blocked"}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Created</label>
                <p className="text-sm text-gray-600">{formatDate(customer.created_at)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Active Layaways (retail only) */}
        {industry === "retail" && layawayPlans.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Active Layaway Plans</h2>
            <div className="space-y-3">
              {layawayPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="border border-gray-200 rounded-lg p-4 bg-orange-50"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-semibold">Layaway Plan</div>
                      <div className="text-sm text-gray-600">
                        Created: {formatDate(plan.created_at)}
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded text-xs font-semibold bg-orange-100 text-orange-800">
                      {plan.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-3">
                    <div>
                      <div className="text-xs text-gray-600">Total Amount</div>
                      <div className="font-semibold">
                        {formatMoney(plan.total_amount, currencyCode)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600">Deposit Paid</div>
                      <div className="font-semibold text-green-600">
                        {formatMoney(plan.deposit_amount, currencyCode)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600">Outstanding</div>
                      <div className="font-semibold text-orange-600">
                        {formatMoney(plan.outstanding_amount, currencyCode)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t">
                    <button
                      onClick={() => router.push(`/sales/${plan.sale_id}/receipt`)}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      View Sale Receipt →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sales History (retail only) */}
        {industry === "retail" && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Sales History</h2>
          {sales.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No sales found for this customer.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Sale ID</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-left p-2">Payment Method</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} className="border-b hover:bg-gray-50">
                      <td className="p-2 text-sm">{formatDate(sale.created_at)}</td>
                      <td className="p-2 text-sm font-mono">{sale.id.substring(0, 8)}</td>
                      <td className="p-2 text-right font-semibold">
                        {formatMoney(sale.amount, currencyCode)}
                      </td>
                      <td className="p-2 text-sm">{formatPaymentMethod(sale.payment_method)}</td>
                      <td className="p-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${
                            sale.payment_status === "paid"
                              ? "bg-green-100 text-green-800"
                              : sale.payment_status === "refunded"
                              ? "bg-red-100 text-red-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {sale.payment_status}
                        </span>
                      </td>
                      <td className="p-2">
                        <button
                          onClick={() => router.push(`/sales/${sale.id}/receipt`)}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          View Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div
            className={`fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg ${
              toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
            }`}
          >
            {toast.message}
            <button
              onClick={() => setToast(null)}
              className="ml-4 font-bold"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
