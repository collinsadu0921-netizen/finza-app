"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

type Customer = {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  status: "active" | "blocked"
}

export default function RetailCustomerEditPage() {
  const params = useParams()
  const router = useRouter()
  const customerId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"active" | "blocked">("active")

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

      const response = await fetch(`/api/customers/${customerId}`)
      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Customer not found")
        setLoading(false)
        return
      }

      const data = await response.json()
      const c: Customer = data.customer
      setName(c.name)
      setPhone(c.phone || "")
      setEmail(c.email || "")
      setStatus(c.status)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load customer")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
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
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          status,
        }),
      })

      if (response.ok) {
        router.push(`/retail/customers/${customerId}`)
        return
      }
      const errorData = await response.json()
      setError(errorData.error || "Failed to update customer")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update customer")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  if (error && !name) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
        <button onClick={() => router.push("/retail/customers")} className="bg-blue-600 text-white px-4 py-2 rounded">
          Back to Customers
        </button>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Edit Customer</h1>
        <p className="text-gray-600 mt-1">Update customer details</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
        <div className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Customer name"
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
              Phone
            </label>
            <input
              type="tel"
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Phone number"
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Email address"
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "blocked")}
              className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={saving}
            >
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex gap-4">
          <button
            type="button"
            onClick={() => router.push(`/retail/customers/${customerId}`)}
            className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  )
}
