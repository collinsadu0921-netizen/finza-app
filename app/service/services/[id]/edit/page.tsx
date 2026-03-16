"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

type ServiceCatalogRow = {
  id: string
  business_id: string
  name: string
  description: string | null
  default_price: number
  tax_code: string | null
  is_active: boolean
}

export default function ServiceServiceEditPage() {
  const router = useRouter()
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : ""
  const [row, setRow] = useState<ServiceCatalogRow | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [default_price, setDefaultPrice] = useState("")
  const [tax_code, setTaxCode] = useState("")
  const [is_active, setIsActive] = useState(true)

  useEffect(() => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }
    load()
  }, [id])

  const load = async () => {
    try {
      setError("")
      const { data: { user } } = await supabase.auth.getUser()
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
      const { data, error: qErr } = await supabase
        .from("service_catalog")
        .select("*")
        .eq("id", id)
        .eq("business_id", business.id)
        .maybeSingle()
      if (qErr) {
        setError(qErr.message || "Failed to load service")
        setLoading(false)
        return
      }
      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }
      const r = data as ServiceCatalogRow
      setRow(r)
      setName(r.name)
      setDescription(r.description ?? "")
      setDefaultPrice(String(r.default_price ?? 0))
      setTaxCode(r.tax_code ?? "")
      setIsActive(r.is_active)
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!businessId || !row) return
    if (!name.trim()) {
      setError("Name is required")
      return
    }
    const price = parseFloat(default_price)
    if (isNaN(price) || price < 0) {
      setError("Default price must be a non-negative number")
      return
    }
    setSaving(true)
    try {
      const { error: uErr } = await supabase
        .from("service_catalog")
        .update({
          name: name.trim(),
          description: description.trim() || null,
          default_price: price,
          tax_code: tax_code.trim() || null,
          is_active,
        })
        .eq("id", id)
        .eq("business_id", businessId)
      if (uErr) {
        setError(uErr.message || "Failed to update service")
        setSaving(false)
        return
      }
      router.push("/service/services")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update")
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen />

  if (notFound || (!loading && !row)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Service not found</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This service does not exist or you do not have access to it.
            </p>
            <button
              onClick={() => router.push("/service/services")}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Back to Services
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="Edit Service"
          subtitle={row.name}
          actions={
            <Button variant="outline" onClick={() => router.push("/service/services")}>
              Back
            </Button>
          }
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="Service name"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="Optional"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={default_price}
              onChange={(e) => setDefaultPrice(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tax code</label>
            <input
              type="text"
              value={tax_code}
              onChange={(e) => setTaxCode(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="Optional"
              disabled={saving}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={is_active}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={saving}
              className="rounded border-gray-300"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Active
            </label>
          </div>
          <div className="flex gap-4 pt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/service/services")} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
