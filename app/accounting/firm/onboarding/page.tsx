"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter } from "next/navigation"
import { getActiveFirmId } from "@/lib/firmSession"

type FirmOnboardingData = {
  id: string
  name: string
  onboarding_status: "pending" | "in_progress" | "completed"
  onboarding_completed_at: string | null
  legal_name: string | null
  jurisdiction: string | null
  reporting_standard: string | null
  default_accounting_standard: string | null
}

type OnboardingFormData = {
  legal_name: string
  jurisdiction: string
  reporting_standard: string
  default_accounting_standard: string
}

/**
 * Firm Onboarding Page
 * Allows Partners to complete firm onboarding with required details
 */
export default function FirmOnboardingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [firm, setFirm] = useState<FirmOnboardingData | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState<OnboardingFormData>({
    legal_name: "",
    jurisdiction: "",
    reporting_standard: "",
    default_accounting_standard: "",
  })

  useEffect(() => {
    loadFirmData()
  }, [])

  const loadFirmData = async () => {
    try {
      setLoading(true)
      setError("")

      const firmId = getActiveFirmId()
      if (!firmId) {
        setError("No firm selected")
        setLoading(false)
        return
      }

      const response = await fetch(
        `/api/accounting/firm/onboarding/complete?firm_id=${firmId}`
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load firm data")
      }

      const data = await response.json()
      setFirm(data.firm)
      setUserRole(data.user_role)

      // Pre-fill form if already started
      if (data.firm.legal_name) {
        setFormData({
          legal_name: data.firm.legal_name || "",
          jurisdiction: data.firm.jurisdiction || "",
          reporting_standard: data.firm.reporting_standard || "",
          default_accounting_standard: data.firm.default_accounting_standard || "",
        })
      }

      // If already completed, redirect to firm dashboard
      if (data.firm.onboarding_status === "completed") {
        router.push("/accounting/firm")
        return
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
      const firmId = getActiveFirmId()
      if (!firmId) {
        throw new Error("No firm selected")
      }

      // Validate required fields
      if (!formData.legal_name || !formData.jurisdiction || !formData.reporting_standard) {
        throw new Error("Legal name, jurisdiction, and reporting standard are required")
      }

      const response = await fetch("/api/accounting/firm/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firm_id: firmId,
          ...formData,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to complete onboarding")
      }

      // Redirect to firm dashboard
      router.push("/accounting/firm")
    } catch (err: any) {
      setError(err.message || "Failed to complete onboarding")
    } finally {
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

  // Check if user is Partner
  if (userRole !== "partner") {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
              <h2 className="text-xl font-bold text-red-800 dark:text-red-200 mb-2">
                Access Denied
              </h2>
              <p className="text-red-600 dark:text-red-300">
                Only Partners can complete firm onboarding. Please contact a Partner to complete this process.
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
              Firm Onboarding
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Complete your firm setup to start managing clients
            </p>
          </div>

          {firm && (
            <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-blue-800 dark:text-blue-200 text-sm">
                <strong>Firm:</strong> {firm.name}
              </p>
            </div>
          )}

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Firm Details
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="legal_name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="legal_name"
                  required
                  value={formData.legal_name}
                  onChange={(e) =>
                    setFormData({ ...formData, legal_name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter legal name of the firm"
                />
              </div>

              <div>
                <label
                  htmlFor="jurisdiction"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Jurisdiction <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="jurisdiction"
                  required
                  value={formData.jurisdiction}
                  onChange={(e) =>
                    setFormData({ ...formData, jurisdiction: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., United States, United Kingdom, Nigeria"
                />
              </div>

              <div>
                <label
                  htmlFor="reporting_standard"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Reporting Standard <span className="text-red-500">*</span>
                </label>
                <select
                  id="reporting_standard"
                  required
                  value={formData.reporting_standard}
                  onChange={(e) =>
                    setFormData({ ...formData, reporting_standard: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select reporting standard</option>
                  <option value="IFRS">IFRS (International Financial Reporting Standards)</option>
                  <option value="US GAAP">US GAAP (Generally Accepted Accounting Principles)</option>
                  <option value="UK GAAP">UK GAAP</option>
                  <option value="Local GAAP">Local GAAP</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="default_accounting_standard"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Default Accounting Standard <span className="text-gray-500 text-xs">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="default_accounting_standard"
                  value={formData.default_accounting_standard}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      default_accounting_standard: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., IFRS, US GAAP, UK GAAP (leave empty to set per client)"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  💡 <strong>What this does:</strong> When you create new client engagements, this standard will be automatically selected as the default. You can still change it per client if needed. If left empty, you'll choose the standard when creating each client.
                </p>
              </div>

              <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
                <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>What happens next:</strong> After completing onboarding, you'll be able to add clients and start managing their accounting. You can update these settings later in Firm Settings.
                  </p>
                </div>
                
                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {submitting ? "Completing..." : "Complete Onboarding"}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/accounting/firm")}
                    className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                </div>
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  <strong>Complete Onboarding:</strong> Saves your firm details and enables client management. <strong>Cancel:</strong> Returns to the firm dashboard without saving. You can complete onboarding later.
                </p>
              </div>
            </form>
          </div>

          <div className="mt-8 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
              Important Notes
            </h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-yellow-700 dark:text-yellow-300">
              <li>Only Partners can complete firm onboarding</li>
              <li>Clients cannot be added until onboarding is completed</li>
              <li>Accounting actions are blocked until onboarding is completed</li>
              <li>This information can be updated later in firm settings</li>
            </ul>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
