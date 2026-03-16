"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type Category = {
  id: string
  name: string
  vat_type?: string
  created_at?: string
  product_count?: number
}

export default function CategoriesPage() {
  const router = useRouter()
  const { openConfirm } = useConfirm()
  const [categories, setCategories] = useState<Category[]>([])
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    loadCategories()
  }, [])

  const loadCategories = async () => {
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

      // Fetch categories with product counts
      const { data: cats, error: catsError } = await supabase
        .from("categories")
        .select("id, name, vat_type, created_at")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (catsError) {
        setError(`Error loading categories: ${catsError.message}`)
        setLoading(false)
        return
      }

      // Get product count for each category
      const categoriesWithCounts = await Promise.all(
        (cats || []).map(async (cat) => {
          const { count } = await supabase
            .from("products")
            .select("*", { count: "exact", head: true })
            .eq("business_id", business.id)
            .eq("category_id", cat.id)

          return {
            ...cat,
            product_count: count || 0,
          }
        })
      )

      setCategories(categoriesWithCounts)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load categories")
      setLoading(false)
    }
  }

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "N/A"
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const formatVatType = (vatType: string | undefined) => {
    if (!vatType) return "Standard"
    const types: Record<string, string> = {
      standard: "Standard",
      zero: "Zero Rate",
      exempt: "Exempt",
    }
    return types[vatType] || vatType
  }

  const deleteCategory = async (id: string) => {
    openConfirm({
      title: "Delete category",
      description: "Are you sure you want to delete this category? Products in this category will have their category removed.",
      onConfirm: () => runDeleteCategory(id),
    })
  }

  const runDeleteCategory = async (id: string) => {
    try {
      // First, remove category from all products
      await supabase
        .from("products")
        .update({ category_id: null })
        .eq("category_id", id)

      // Then delete the category
      await supabase.from("categories").delete().eq("id", id)
      loadCategories()
    } catch (err: any) {
      setError(err.message || "Failed to delete category")
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
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Categories</h1>
          <div className="flex gap-2">
            <a
              href="/categories/new"
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              + Add Category
            </a>
            <a
              href="/products"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Products
            </a>
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              Dashboard
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Category List Table */}
        {categories.length === 0 ? (
          <div className="border p-8 rounded-lg text-center bg-gray-50">
            <p className="text-gray-600 mb-4">No categories added yet.</p>
            <a
              href="/categories/new"
              className="bg-green-600 text-white px-6 py-2 rounded inline-block hover:bg-green-700"
            >
              + Create Your First Category
            </a>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold">Category Name</th>
                  <th className="text-left py-3 px-4 font-semibold">VAT Type</th>
                  <th className="text-left py-3 px-4 font-semibold">Products</th>
                  <th className="text-left py-3 px-4 font-semibold">Created Date</th>
                  <th className="text-right py-3 px-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium">{category.name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800">
                        {formatVatType(category.vat_type)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {category.product_count || 0}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {formatDate(category.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end gap-2">
                        <a
                          href={`/categories/${category.id}/edit`}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                        >
                          Edit
                        </a>
                        <button
                          onClick={() => deleteCategory(category.id)}
                          className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}

