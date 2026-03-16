"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

export default function ServiceNewServicePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [default_price, setDefaultPrice] = useState("")
  const [tax_code, setTaxCode] = useState("")
  const [is_active, setIsActive] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (business) setBusinessId(business.id)
    })()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!name.trim()) {
      setError("Name is required")
      return
    }
    if (!businessId) {
      setError("Business context not found")
      return
    }
    const price = parseFloat(default_price)
    if (isNaN(price) || price < 0) {
      setError("Default price must be a non-negative number")
      return
    }
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from("service_catalog")
        .insert({
          business_id: businessId,
          name: name.trim(),
          description: description.trim() || null,
          default_price: price,
          tax_code: tax_code.trim() || null,
          is_active,
        })
        .select("id")
        .single()
      if (err) throw err
      router.push("/service/services")
    } catch (err: any) {
      setError(err.message || "Failed to create service")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="New Service"
          subtitle="Add a billable service to your catalog"
          actions={
            <Button variant="outline" onClick={() => router.back()}>
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
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
              placeholder="Optional description"
              disabled={loading}
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
              placeholder="0.00"
              disabled={loading}
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
              disabled={loading}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={is_active}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Active
            </label>
          </div>
          <div className="flex gap-4 pt-4">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Service"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
