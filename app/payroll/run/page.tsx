"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"

export default function PayrollRunPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    payroll_month: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0],
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch("/api/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payroll_month: formData.payroll_month,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        router.push(`/payroll/${data.payrollRun.id}`)
      } else {
        toast.showToast(data.error || "Error creating payroll run", "error")
      }
    } catch (error) {
      console.error("Error creating payroll run:", error)
      toast.showToast("Error creating payroll run", "error")
    } finally {
      setLoading(false)
    }
  }

  return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => router.push("/payroll")}
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              ← Back to Payroll
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Create Payroll Run</h1>
            <p className="text-gray-600 dark:text-gray-400">Generate payroll for a specific month</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Payroll Month *
              </label>
              <input
                type="date"
                required
                value={formData.payroll_month}
                onChange={(e) => setFormData({ ...formData, payroll_month: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Select the first day of the month for which you want to process payroll
              </p>
            </div>

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Payroll Run"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/payroll")}
                className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
  )
}



