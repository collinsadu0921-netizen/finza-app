"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"

export default function NewCustomerPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [address, setAddress] = useState("")
  const [tin, setTin] = useState("")
  const [whatsappPhone, setWhatsappPhone] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name.trim()) {
      setError("Name is required")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          tin: tin.trim() || null,
          whatsapp_phone: whatsappPhone.trim() || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to create customer")
      }

      // Redirect to customer detail page
      router.push(`/customers/${data.customer.id}`)
    } catch (err: any) {
      console.error("Error creating customer:", err)
      setError(err.message || "Failed to create customer")
      setLoading(false)
    }
  }

  return (
    <ProtectedLayout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">New Customer</h1>
          <p className="text-gray-600 mt-1">
            Add a new customer to your system
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

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
                disabled={loading}
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
                disabled={loading}
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
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">
                Address
              </label>
              <textarea
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={3}
                className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Billing address"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="tin" className="block text-sm font-medium text-gray-700 mb-1">
                TIN
              </label>
              <input
                type="text"
                id="tin"
                value={tin}
                onChange={(e) => setTin(e.target.value)}
                className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Customer tax identification number"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="whatsapp" className="block text-sm font-medium text-gray-700 mb-1">
                WhatsApp
              </label>
              <input
                type="tel"
                id="whatsapp"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. 233XXXXXXXXX (optional if same as phone)"
                disabled={loading}
              />
            </div>
          </div>

          <div className="mt-6 flex gap-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Customer"}
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}
