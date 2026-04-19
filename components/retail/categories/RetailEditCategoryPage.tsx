"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useParams } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { RetailMenuSelect, type MenuSelectOption } from "@/components/retail/RetailBackofficeUi"

const CATEGORY_VAT_OPTIONS: MenuSelectOption[] = [
  { value: "standard", label: "Standard Rate" },
  { value: "zero", label: "Zero Rate" },
  { value: "exempt", label: "Exempt" },
]
import { retailPaths } from "@/lib/retail/routes"

export default function RetailEditCategoryPage() {
  const router = useRouter()
  const params = useParams()
  const categoryId = params.id as string

  const [businessId, setBusinessId] = useState("")
  const [name, setName] = useState("")
  const [vatType, setVatType] = useState<"standard" | "zero" | "exempt">("standard")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    loadCategory()
  }, [categoryId])

  const loadCategory = async () => {
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

      // Load category
      const { data: category, error: categoryError } = await supabase
        .from("categories")
        .select("*")
        .eq("id", categoryId)
        .eq("business_id", business.id)
        .single()

      if (categoryError || !category) {
        setError("Category not found")
        setLoading(false)
        return
      }

      setName(category.name)
      setVatType((category.vat_type as "standard" | "zero" | "exempt") || "standard")
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load category")
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

    try {
      const { error: updateError } = await supabase
        .from("categories")
        .update({
          name: name.trim(),
          vat_type: vatType,
        })
        .eq("id", categoryId)

      if (updateError) {
        setError(updateError.message || "Failed to update category")
        setSaving(false)
        return
      }

      router.push(retailPaths.categories)
    } catch (err: any) {
      setError(err.message || "Failed to update category")
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
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
        <a
          href={retailPaths.categories}
          className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
        >
          Back to Categories
        </a>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Edit Category</h1>
          <a
            href={retailPaths.categories}
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
              <RetailMenuSelect
                value={vatType}
                onValueChange={(v) => setVatType(v as "standard" | "zero" | "exempt")}
                options={CATEGORY_VAT_OPTIONS}
              />
              <p className="text-xs text-gray-500 mt-1">
                Select the VAT treatment for products in this category
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <a
              href={retailPaths.categories}
              className="bg-gray-300 text-gray-800 px-6 py-2 rounded hover:bg-gray-400"
            >
              Cancel
            </a>
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
  )
}


















