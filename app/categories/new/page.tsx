"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"

export default function NewCategoryPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState("")
  const [name, setName] = useState("")
  const [vatType, setVatType] = useState<"standard" | "zero" | "exempt">("standard")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    loadBusiness()
  }, [])

  const loadBusiness = async () => {
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

      setBusinessId(business.id)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load business")
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSaving(true)

    if (!name.trim()) {
      setError("Category name is required")
      setSaving(false)
      return
    }

    if (!businessId) {
      setError("Business not found. Please refresh the page.")
      setSaving(false)
      return
    }

    try {
      const { error: insertError } = await supabase.from("categories").insert({
        business_id: businessId,
        name: name.trim(),
        vat_type: vatType,
      })

      if (insertError) {
        setError(insertError.message || "Failed to create category")
        setSaving(false)
        return
      }

      router.push("/categories")
    } catch (err: any) {
      setError(err.message || "Failed to create category")
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
      <div className="p-6 max-w-2xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Create New Category</h1>
          <a
            href="/categories"
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
          >
            Back to Categories
          </a>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="border p-6 rounded-lg bg-white">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Category Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="border p-2 w-full rounded"
                placeholder="e.g., Electronics, Clothing, Food"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                VAT Type <span className="text-red-500">*</span>
              </label>
              <select
                className="border p-2 w-full rounded"
                value={vatType}
                onChange={(e) => setVatType(e.target.value as "standard" | "zero" | "exempt")}
                required
              >
                <option value="standard">Standard Rate</option>
                <option value="zero">Zero Rate</option>
                <option value="exempt">Exempt</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Select the VAT treatment for products in this category
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <a
              href="/categories"
              className="bg-gray-300 text-gray-800 px-6 py-2 rounded hover:bg-gray-400"
            >
              Cancel
            </a>
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {saving ? "Creating..." : "Create Category"}
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}


















