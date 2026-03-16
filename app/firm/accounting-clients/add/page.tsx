"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter } from "next/navigation"
import { getActiveFirmId } from "@/lib/firmSession"

/**
 * Add External Client (Books-Only) Page
 * Step 9.2 Batch C
 * 
 * Minimal form to create a books-only client:
 * - Client legal name
 * - Currency
 * - First accounting period start date
 * 
 * Behind the scenes (atomic):
 * 1. Create Business (books_only = true)
 * 2. Create Accounting Period (first open period)
 * 3. Create Engagement (firm ↔ client, active immediately)
 * 4. Redirect to Accounting Workspace
 */
export default function AddExternalClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [firmId, setFirmId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    legal_name: "",
    currency: "GHS",
    period_start: new Date().toISOString().split("T")[0].substring(0, 7) + "-01", // First day of current month
  })

  useEffect(() => {
    loadFirmData()
  }, [])

  const loadFirmData = async () => {
    try {
      setLoading(true)
      const activeFirmId = getActiveFirmId()
      if (!activeFirmId) {
        setError("No firm selected")
        setLoading(false)
        return
      }

      setFirmId(activeFirmId)

      // Get user's role in firm
      const response = await fetch("/api/accounting/firm/firms")
      if (response.ok) {
        const data = await response.json()
        const firm = data.firms?.find((f: any) => f.firm_id === activeFirmId)
        if (firm) {
          setUserRole(firm.role)
          if (firm.role !== "partner" && firm.role !== "senior") {
            setError("Only Partners and Seniors can add external clients")
            setLoading(false)
            return
          }
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to load firm data")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      if (!firmId) {
        throw new Error("No firm selected")
      }

      if (!formData.legal_name.trim()) {
        throw new Error("Client legal name is required")
      }

      if (!formData.period_start) {
        throw new Error("First accounting period start date is required")
      }

      // Validate period_start is first day of month
      const periodDate = new Date(formData.period_start)
      if (periodDate.getDate() !== 1) {
        throw new Error("Period start date must be the first day of the month")
      }

      // Call API to create books-only client
      const response = await fetch("/api/firm/accounting-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firm_id: firmId,
          legal_name: formData.legal_name.trim(),
          currency: formData.currency,
          period_start: formData.period_start,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to create external client")
      }

      const result = await response.json()

      router.push(`/accounting/control-tower/${result.business_id}`)
    } catch (err: any) {
      setError(err.message || "Failed to create external client")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (userRole && userRole !== "partner" && userRole !== "senior") {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
              <h2 className="text-xl font-bold text-red-800 dark:text-red-200 mb-2">
                Access Denied
              </h2>
              <p className="text-red-600 dark:text-red-300">
                Only Partners and Seniors can add external clients. Please contact a Partner or Senior.
              </p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Add External Client (Books-Only)
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Create a new books-only client for accounting services
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Legal Name */}
              <div>
                <label
                  htmlFor="legal_name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Client Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="legal_name"
                  required
                  value={formData.legal_name}
                  onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
                  placeholder="Enter client's legal business name"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  The official legal name of the client business
                </p>
              </div>

              {/* Currency */}
              <div>
                <label
                  htmlFor="currency"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Currency <span className="text-red-500">*</span>
                </label>
                <select
                  id="currency"
                  required
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="GHS">GHS - Ghana Cedi</option>
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Primary currency for this client's accounting
                </p>
              </div>

              {/* First Accounting Period Start */}
              <div>
                <label
                  htmlFor="period_start"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  First Accounting Period Start <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  id="period_start"
                  required
                  value={formData.period_start}
                  onChange={(e) => {
                    // Ensure it's the first day of the month
                    const date = new Date(e.target.value)
                    date.setDate(1)
                    setFormData({ ...formData, period_start: date.toISOString().split("T")[0] })
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  The first day of the first accounting period. This will be automatically set to the 1st of the selected month.
                </p>
              </div>

              {/* Info Box */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-2">
                  What happens next?
                </h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-blue-700 dark:text-blue-300">
                  <li>A new business will be created (books-only, no service/POS setup)</li>
                  <li>An accounting period will be created starting from the selected date</li>
                  <li>An active engagement will be created with approve access</li>
                  <li>You'll be redirected to the Accounting Workspace for this client</li>
                </ul>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {submitting ? "Creating..." : "Create Client & Enter Accounting"}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/firm/accounting-clients")}
                    className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
