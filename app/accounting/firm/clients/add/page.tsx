"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter } from "next/navigation"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import {
  shouldClearPracticeClientSelection,
  shouldRunPracticeClientSearch,
} from "@/lib/accounting/firm/practiceClientSearch"

type Business = {
  id: string
  name: string
  industry: string | null
}

type EngagementFormData = {
  business_id: string
  access_level: "read" | "write" | "approve"
  effective_from: string
  effective_to: string | null
}

/**
 * Add Client Page
 * Allows Partners and Seniors to create new firm-client engagements
 */
export default function AddClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [firmId, setFirmId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
  const [formData, setFormData] = useState<EngagementFormData>({
    business_id: "",
    access_level: "read",
    effective_from: new Date().toISOString().split("T")[0],
    effective_to: null,
  })

  useEffect(() => {
    loadFirmData()
  }, [])

  useEffect(() => {
    if (
      !shouldRunPracticeClientSearch({
        query: searchQuery,
        selectedName: selectedBusiness?.name,
      })
    ) {
      setBusinesses([])
      setSearching(false)
      setSearchError("")
      return
    }

    const handle = window.setTimeout(() => {
      void searchBusinesses(searchQuery)
    }, 200)
    return () => window.clearTimeout(handle)
  }, [searchQuery, selectedBusiness, firmId])

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

      const response = await fetch("/api/accounting/firm/firms")
      if (response.ok) {
        const data = await response.json()
        const firm = data.firms?.find((f: any) => f.firm_id === activeFirmId)
        if (firm) {
          setUserRole(firm.role)
          if (firm.role !== "partner" && firm.role !== "senior") {
            setError("Only Partners and Seniors can add clients")
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

  const searchBusinesses = async (query: string) => {
    const activeFirmId = getActiveFirmId() || firmId
    if (!activeFirmId) {
      setSearchError("No firm selected")
      setBusinesses([])
      return
    }

    try {
      setSearching(true)
      setSearchError("")
      const response = await fetch(
        `/api/accounting/firm/clients/search?q=${encodeURIComponent(query)}&firm_id=${encodeURIComponent(activeFirmId)}`
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setBusinesses([])
        setSearchError(data.error || "Search failed. Try again.")
        return
      }
      const data = await response.json()
      setBusinesses(data.businesses || [])
    } catch (err) {
      console.error("Error searching businesses:", err)
      setBusinesses([])
      setSearchError("Search failed. Try again.")
    } finally {
      setSearching(false)
    }
  }

  const handleSearchInputChange = (value: string) => {
    setSearchQuery(value)
    if (
      shouldClearPracticeClientSelection({
        selectedName: selectedBusiness?.name,
        nextQuery: value,
      })
    ) {
      setSelectedBusiness(null)
      setFormData((prev) => ({ ...prev, business_id: "" }))
    }
  }

  const handleBusinessSelect = (business: Business) => {
    setSelectedBusiness(business)
    setFormData((prev) => ({ ...prev, business_id: business.id }))
    setSearchQuery(business.name)
    setBusinesses([])
    setSearchError("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      const activeFirmId = getActiveFirmId() || firmId

      if (!activeFirmId) {
        throw new Error("No firm selected. Please select a firm from the firm selector.")
      }

      if (!formData.business_id || !selectedBusiness) {
        throw new Error("Please select a business")
      }

      const effectiveFromDate = new Date(formData.effective_from)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (effectiveFromDate < today) {
        throw new Error("Effective date cannot be in the past")
      }

      if (formData.effective_to) {
        const effectiveToDate = new Date(formData.effective_to)
        if (effectiveToDate < effectiveFromDate) {
          throw new Error("End date must be >= start date")
        }
      }

      const response = await fetch("/api/accounting/firm/engagements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firm_id: activeFirmId,
          business_id: formData.business_id,
          access_level: formData.access_level,
          effective_from: formData.effective_from,
          effective_to: formData.effective_to || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to create engagement")
      }

      router.push("/accounting/firm")
    } catch (err: any) {
      setError(err.message || "Failed to create engagement")
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
                Only Partners and Seniors can add clients. Please contact a Partner or Senior to add clients.
              </p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const showNoMatch =
    !searching &&
    !searchError &&
    !selectedBusiness &&
    searchQuery.trim().length >= 2 &&
    businesses.length === 0

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Add client
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Connect a Finza Service business as your client.
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-xl">
              The client must already have a Finza Service business. The business owner will approve your
              firm&apos;s access request.
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="business_search"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Select Business <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="business_search"
                    value={searchQuery}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    placeholder="Search for business by name..."
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoComplete="off"
                  />
                  {businesses.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                      {businesses.map((business) => (
                        <button
                          key={business.id}
                          type="button"
                          onClick={() => handleBusinessSelect(business)}
                          className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-900 dark:text-white"
                        >
                          <div className="font-medium">{business.name}</div>
                          {business.industry && (
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {business.industry}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {searching && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Searching Finza businesses…
                  </p>
                )}
                {searchError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{searchError}</p>
                )}
                {showNoMatch && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <p>No eligible Finza Service businesses found.</p>
                    <p className="mt-1 text-gray-500 dark:text-gray-500">
                      The client must already have a Finza Service business.
                    </p>
                  </div>
                )}
                {selectedBusiness && (
                  <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                    Selected: {selectedBusiness.name}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="access_level"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Access Level <span className="text-red-500">*</span>
                </label>
                <select
                  id="access_level"
                  required
                  value={formData.access_level}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      access_level: e.target.value as "read" | "write" | "approve",
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="read">Read (View only)</option>
                  <option value="write">Write (Can modify)</option>
                  <option value="approve">Approve (Can approve actions)</option>
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This determines what actions the firm can perform for this client
                </p>
              </div>

              <div>
                <label
                  htmlFor="effective_from"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Effective From <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  id="effective_from"
                  required
                  value={formData.effective_from}
                  onChange={(e) =>
                    setFormData({ ...formData, effective_from: e.target.value })
                  }
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Date from which this engagement becomes effective (cannot be in the past)
                </p>
              </div>

              <div>
                <label
                  htmlFor="effective_to"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Effective To (Optional)
                </label>
                <input
                  type="date"
                  id="effective_to"
                  value={formData.effective_to || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      effective_to: e.target.value || null,
                    })
                  }
                  min={formData.effective_from}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Leave empty for ongoing engagement
                </p>
              </div>

              {selectedBusiness && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-2">
                    Engagement Summary
                  </h3>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    This firm will have <strong>{formData.access_level}</strong> access to{" "}
                    <strong>{selectedBusiness.name}</strong> starting{" "}
                    <strong>{new Date(formData.effective_from).toLocaleDateString()}</strong>
                    {formData.effective_to
                      ? ` until ${new Date(formData.effective_to).toLocaleDateString()}`
                      : " (ongoing)"}
                    . The client must accept this engagement before it becomes active.
                  </p>
                </div>
              )}

              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={submitting || !selectedBusiness}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {submitting ? "Creating..." : "Create Engagement"}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/accounting/firm")}
                    className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div className="mt-8 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
              Important Notes
            </h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-yellow-700 dark:text-yellow-300">
              <li>Engagements start in &quot;pending&quot; status and require client acceptance</li>
              <li>No client data will be visible until the engagement is accepted and active</li>
              <li>Only Partners and Seniors can create engagements</li>
              <li>Effective dates cannot be in the past</li>
            </ul>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
