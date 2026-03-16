"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { setActiveStoreId } from "@/lib/storeSession"
import { initializeStoreStock } from "@/lib/productsStock"

interface RetailOnboardingStoreProps {
  business: any
  businessId: string
  onComplete: () => void
}

export default function RetailOnboardingStore({
  business,
  businessId,
  onComplete
}: RetailOnboardingStoreProps) {
  // ONBOARDING FIX: Pre-fill phone/email from business if available to avoid duplicate collection
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    phone: business?.phone || "",
    email: business?.email || ""
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    
    if (!formData.name.trim()) {
      setError("Store name is required")
      return
    }

    setLoading(true)

    try {
      // Create store
      const { data: newStore, error: insertError } = await supabase
        .from("stores")
        .insert({
          business_id: businessId,
          name: formData.name.trim(),
          location: formData.location.trim() || null,
          phone: formData.phone.trim() || null,
          email: formData.email.trim() || null,
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Initialize products_stock rows for all products in the new store
      await initializeStoreStock(supabase, businessId, newStore.id)

      // Set store as active
      setActiveStoreId(newStore.id, newStore.name)

      // Proceed to next step
      onComplete()
    } catch (err: any) {
      console.error("Error creating store:", err)
      setError(err.message || "Failed to create store")
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Step 2: Create Your First Store
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Create a store location to start managing inventory and sales. You can add more stores later.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Store Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            required
            placeholder="e.g., Main Store"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Location
          </label>
          <input
            type="text"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            placeholder="e.g., Accra, Osu"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Phone
            </label>
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="e.g., 0551234567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="store@example.com"
            />
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating..." : "Create Store"}
          </button>
          <button
            type="button"
            onClick={onComplete}
            className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
          >
            Skip for Now
          </button>
        </div>
      </form>
    </div>
  )
}



















