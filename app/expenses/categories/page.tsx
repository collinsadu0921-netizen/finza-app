"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type ExpenseCategory = {
  id: string
  name: string
  description: string | null
  created_at: string
  is_default?: boolean
}

export default function ExpenseCategoriesPage() {
  const router = useRouter()
  const { openConfirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null)
  const [categoryName, setCategoryName] = useState("")
  const [categoryDescription, setCategoryDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const [searchInput, setSearchInput] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [isSearching, setIsSearching] = useState(false)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  // Debounced search effect - updates searchQuery after user stops typing
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (searchInput.trim()) {
      setIsSearching(true)
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchInput])

  const loadData = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)

      // Ensure default categories are seeded for this business
      await supabase.rpc("seed_default_expense_categories", {
        business_uuid: business.id,
      })

      // Load categories (explicitly select is_default to ensure it's included)
      const { data: categoriesData, error: categoriesError } = await supabase
        .from("expense_categories")
        .select("id, name, description, created_at, is_default")
        .eq("business_id", business.id)
        .order("is_default", { ascending: false }) // Defaults first
        .order("name", { ascending: true })

      if (categoriesError) {
        throw categoriesError
      }

      setCategories(categoriesData || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load categories")
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!categoryName.trim() || !businessId) return

    try {
      setSaving(true)
      const response = await fetch("/api/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          name: categoryName.trim(),
          description: categoryDescription.trim() || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to create category")
      }

      // Reload categories
      await loadData()
      
      // Reset form
      setCategoryName("")
      setCategoryDescription("")
      setShowCreateModal(false)
      setSaving(false)
    } catch (err: any) {
      setError(err.message || "Failed to create category")
      setSaving(false)
    }
  }

  const handleEdit = (category: ExpenseCategory) => {
    setEditingCategory(category)
    setCategoryName(category.name)
    setCategoryDescription(category.description || "")
    setShowEditModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!categoryName.trim() || !editingCategory) return

    try {
      setSaving(true)
      const response = await fetch(`/api/expense-categories/${editingCategory.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: categoryName.trim(),
          description: categoryDescription.trim() || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to update category")
      }

      // Reload categories
      await loadData()
      
      // Reset form
      setEditingCategory(null)
      setCategoryName("")
      setCategoryDescription("")
      setShowEditModal(false)
      setSaving(false)
    } catch (err: any) {
      setError(err.message || "Failed to update category")
      setSaving(false)
    }
  }

  const handleDelete = async (categoryId: string) => {
    openConfirm({
      title: "Delete category",
      description: "Are you sure you want to delete this category? Expenses using this category will have their category removed.",
      onConfirm: () => runDelete(categoryId),
    })
  }

  const runDelete = async (categoryId: string) => {
    try {
      const response = await fetch(`/api/expense-categories/${categoryId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to delete category")
      }

      // Reload categories
      await loadData()
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
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Expenses
            </button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                  Expense Categories
                </h1>
                <p className="text-gray-600 dark:text-gray-400">Manage your expense categories</p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Category
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Search Bar */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Search Categories
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Type category name or description..."
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-colors"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          </div>

          {/* Filter categories based on search query */}
          {(() => {
            const filteredCategories = searchQuery.trim()
              ? categories.filter((cat) =>
                  cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (cat.description && cat.description.toLowerCase().includes(searchQuery.toLowerCase()))
                )
              : categories

            if (categories.length === 0) {
              return (
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-12 border border-gray-100 dark:border-gray-700 text-center">
                  <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  <p className="text-gray-600 dark:text-gray-400 text-lg mb-2">No categories yet</p>
                  <p className="text-gray-500 dark:text-gray-500 text-sm mb-4">Create your first category to organize expenses</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Add Category
                  </button>
                </div>
              )
            }

            if (filteredCategories.length === 0) {
              return (
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-12 border border-gray-100 dark:border-gray-700 text-center">
                  <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-gray-600 dark:text-gray-400 text-lg mb-2">No categories found</p>
                  <p className="text-gray-500 dark:text-gray-500 text-sm mb-4">Try adjusting your search terms</p>
                  <button
                    onClick={() => setSearchInput("")}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    Clear search
                  </button>
                </div>
              )
            }

            return (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredCategories.map((category) => (
                  <div key={category.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                          {category.name}
                        </h3>
                        {category.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {category.description}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                          Created {new Date(category.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleEdit(category)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-3 py-1 rounded transition-colors"
                        >
                          Edit
                        </button>
                        {category.is_default === true ? (
                          <span className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1 italic">
                            Default
                          </span>
                        ) : (
                          <button
                            onClick={() => handleDelete(category.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-3 py-1 rounded transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Create Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Add New Category</h2>
                <form onSubmit={handleCreate}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Category Name *
                      </label>
                      <input
                        type="text"
                        value={categoryName}
                        onChange={(e) => setCategoryName(e.target.value)}
                        required
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        placeholder="e.g., Fuel, Materials, Office Supplies"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Description (optional)
                      </label>
                      <textarea
                        value={categoryDescription}
                        onChange={(e) => setCategoryDescription(e.target.value)}
                        rows={3}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        placeholder="Optional description..."
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false)
                        setCategoryName("")
                        setCategoryDescription("")
                      }}
                      className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !categoryName.trim()}
                      className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "Creating..." : "Create Category"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Edit Modal */}
          {showEditModal && editingCategory && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Edit Category</h2>
                <form onSubmit={handleUpdate}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Category Name *
                      </label>
                      <input
                        type="text"
                        value={categoryName}
                        onChange={(e) => setCategoryName(e.target.value)}
                        required
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        placeholder="e.g., Fuel, Materials, Office Supplies"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Description (optional)
                      </label>
                      <textarea
                        value={categoryDescription}
                        onChange={(e) => setCategoryDescription(e.target.value)}
                        rows={3}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        placeholder="Optional description..."
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditModal(false)
                        setEditingCategory(null)
                        setCategoryName("")
                        setCategoryDescription("")
                      }}
                      className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !categoryName.trim()}
                      className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "Updating..." : "Update Category"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

