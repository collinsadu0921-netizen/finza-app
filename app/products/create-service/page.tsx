"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"

type Category = {
  id: string
  name: string
}

export default function CreateServicePage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    name: "",
    unit_price: "",
    tax_applicable: true,
    category_id: "",
    description: "",
  })
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
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

      if (business.industry !== "service") {
        router.replace("/products")
        return
      }

      setBusinessId(business.id)

      const { data: cats, error: catsError } = await supabase
        .from("categories")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (catsError) throw catsError
      setCategories(cats || [])
    } catch (err: any) {
      console.error("Error loading data:", err)
      setError(err.message || "Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.name.trim()) {
      setError("Service name is required")
      return
    }

    const price = parseFloat(formData.unit_price)
    if (isNaN(price) || price < 0) {
      setError("Valid price is required")
      return
    }

    setSaving(true)

    try {
      // Phase 0: service creation ONLY via API — no direct Supabase insert into products_services
      const res = await fetch("/api/products/create-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          create_as: "service",
          business_id: businessId,
          name: formData.name.trim(),
          unit_price: price,
          tax_applicable: formData.tax_applicable,
          category_id: formData.category_id || null,
          description: formData.description.trim() || null,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          data?.error === "SERVICE_CREATION_BOUNDARY_VIOLATION"
            ? data?.message ?? "Create Service must write to products_services only."
            : data?.error ?? "Failed to create service"
        throw new Error(msg)
      }

      router.push("/products")
    } catch (err: any) {
      console.error("Error creating service:", err)
      setError(err.message || "Failed to create service")
      setSaving(false)
    }
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

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Create Service</h1>
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Service Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
              placeholder="e.g., Consultation"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Price <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.unit_price}
              onChange={(e) => setFormData({ ...formData, unit_price: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Optional"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tax_applicable"
              checked={formData.tax_applicable}
              onChange={(e) => setFormData({ ...formData, tax_applicable: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="tax_applicable" className="text-sm font-medium text-gray-700">
              Tax applicable
            </label>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Creating..." : "Create Service"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/products")}
              className="bg-gray-300 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-400 font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}
