"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type ServiceCatalogRow = {
  id: string
  name: string
  default_price: number
  tax_code: string | null
  is_active: boolean
}

export default function ServiceServicesPage() {
  const router = useRouter()
  const { format } = useBusinessCurrency()
  const [rows, setRows] = useState<ServiceCatalogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    load()
  }, [])

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
      const { data, error: qErr } = await supabase
        .from("service_catalog")
        .select("id, name, default_price, tax_code, is_active")
        .eq("business_id", business.id)
        .order("name", { ascending: true })
      if (qErr) {
        setError(qErr.message || "Failed to load services")
        setLoading(false)
        return
      }
      setRows((data ?? []) as ServiceCatalogRow[])
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Services</h1>
          <button
            onClick={() => router.push("/service/services/new")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            Add Service
          </button>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Default price</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Tax code</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Active</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      No services yet. Add your first service to get started.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{row.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{format(Number(row.default_price ?? 0))}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{row.tax_code ?? "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{row.is_active ? "Yes" : "No"}</td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => router.push(`/service/services/${row.id}/edit`)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
