"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import {
  RetailBackofficeAlert,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeEmpty,
} from "@/components/retail/RetailBackofficeUi"

type Category = {
  id: string
  name: string
  vat_type?: string
  created_at?: string
  product_count?: number
}

export default function RetailCategoriesPage() {
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

      const { data: cats, error: catsError } = await supabase
        .from("categories")
        .select("id, name, vat_type, created_at, products(count)")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (catsError) {
        const { data: catsPlain, error: plainErr } = await supabase
          .from("categories")
          .select("id, name, vat_type, created_at")
          .eq("business_id", business.id)
          .order("name", { ascending: true })
        if (plainErr) {
          setError(`Error loading categories: ${plainErr.message}`)
          setLoading(false)
          return
        }
        const categoriesWithCounts = await Promise.all(
          (catsPlain || []).map(async (cat) => {
            const { count } = await supabase
              .from("products")
              .select("*", { count: "exact", head: true })
              .eq("business_id", business.id)
              .eq("category_id", cat.id)
            return { ...cat, product_count: count || 0 }
          }),
        )
        setCategories(categoriesWithCounts)
        setLoading(false)
        return
      }

      const categoriesWithCounts = (cats || []).map((cat: any) => {
        const raw = cat.products
        const c =
          Array.isArray(raw) && raw[0] && typeof raw[0].count === "number"
            ? raw[0].count
            : Array.isArray(raw) && raw[0] && raw[0].count != null
              ? Number(raw[0].count)
              : 0
        const { products: _p, ...rest } = cat
        return { ...rest, product_count: c }
      })

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
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <p className="text-sm text-slate-500">Loading…</p>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain>
        <RetailBackofficePageHeader
          eyebrow="Product & inventory"
          title="Categories"
          description="Lightweight groups for your catalog and POS filters. Product counts update as you assign items."
          actions={
            <>
              <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.dashboard)}>
                Dashboard
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.products)}>
                Products
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.categoryNew)}>
                New category
              </RetailBackofficeButton>
            </>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-6">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {categories.length === 0 ? (
          <RetailBackofficeEmpty
            title="No categories yet"
            description="Create a category to organize products and speed up filtering at the register."
            action={
              <RetailBackofficeButton variant="primary" onClick={() => router.push(retailPaths.categoryNew)}>
                Create category
              </RetailBackofficeButton>
            }
          />
        ) : (
          <RetailBackofficeCard padding="p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80">
                  <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3.5">Name</th>
                    <th className="px-5 py-3.5">VAT</th>
                    <th className="px-5 py-3.5">Products</th>
                    <th className="px-5 py-3.5">Created</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {categories.map((category) => (
                    <tr key={category.id} className="transition hover:bg-slate-50/80">
                      <td className="px-5 py-4 font-medium text-slate-900">{category.name}</td>
                      <td className="px-5 py-4">
                        <RetailBackofficeBadge tone="info">{formatVatType(category.vat_type)}</RetailBackofficeBadge>
                      </td>
                      <td className="px-5 py-4 tabular-nums text-slate-600">{category.product_count || 0}</td>
                      <td className="px-5 py-4 text-slate-500">{formatDate(category.created_at)}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <a
                            href={retailPaths.categoryEdit(category.id)}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
                          >
                            Edit
                          </a>
                          <button
                            type="button"
                            onClick={() => deleteCategory(category.id)}
                            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50"
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
          </RetailBackofficeCard>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}

