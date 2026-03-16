"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

type Customer = { id: string; name: string }

export default function ServiceJobsNewPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerId, setCustomerId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [status, setStatus] = useState("draft")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business || cancelled) return
      const { data } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name")
      if (!cancelled && data) setCustomers(data as Customer[])
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) throw new Error("Business not found")
      const payload: {
        business_id: string
        customer_id: string | null
        status: string
        start_date: string | null
        end_date: string | null
      } = {
        business_id: business.id,
        customer_id: customerId.trim() || null,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
      }
      const { data: job, error: err } = await supabase
        .from("service_jobs")
        .insert(payload)
        .select("id")
        .single()
      if (err) throw err
      if (job) router.push(`/service/jobs/${job.id}`)
    } catch (e: any) {
      setError(e.message || "Failed to create job")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="New Job"
          subtitle="Create a service engagement"
          actions={
            <Button variant="outline" onClick={() => router.push("/service/jobs")}>
              Back to Jobs
            </Button>
          }
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer (optional)</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
            >
              <option value="">No customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-gray-700 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Job"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/service/jobs")}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
