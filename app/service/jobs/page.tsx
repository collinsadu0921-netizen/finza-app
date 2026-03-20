"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"

type JobRow = {
  id: string
  customer_id: string | null
  status: string
  start_date: string | null
  end_date: string | null
  customers: { name: string } | null
}

export default function ServiceJobsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<JobRow[]>([])
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
        .from("service_jobs")
        .select("*, customers(name)")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
      if (qErr) {
        setError(qErr.message || "Failed to load projects")
        setLoading(false)
        return
      }
      setRows((data ?? []) as JobRow[])
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
          <button
            onClick={() => router.push("/service/jobs/new")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            Create Project
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
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Start date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">End date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      No projects yet. Create your first project to get started.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                        {row.customers?.name ?? "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{row.status}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {row.start_date ? new Date(row.start_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {row.end_date ? new Date(row.end_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => router.push(`/service/jobs/${row.id}`)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                        >
                          Open
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
