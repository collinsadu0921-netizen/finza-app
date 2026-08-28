"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useActiveFirm } from "@/lib/accounting/firm/useActiveFirm"
import { FinzaLogo } from "@/components/FinzaLogo"
import { PRACTICE_HOME_PATH } from "@/lib/auth/signupWorkspace"

const COUNTRY_OPTIONS = [
  { value: "Ghana", label: "Ghana" },
  { value: "Other", label: "Other" },
] as const

/**
 * Legacy firm onboarding — for firms created before minimum setup was merged into firm creation.
 */
export default function FirmOnboardingPage() {
  const router = useRouter()
  const {
    firmId: activeFirmId,
    loading: firmLoading,
    error: firmResolveError,
    requiresSelection,
  } = useActiveFirm()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [firmName, setFirmName] = useState("")
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [legalName, setLegalName] = useState("")
  const [jurisdiction, setJurisdiction] = useState("Ghana")

  useEffect(() => {
    if (firmLoading) return
    void loadFirmData()
  }, [firmLoading, activeFirmId, firmResolveError, requiresSelection])

  const loadFirmData = async () => {
    try {
      setLoading(true)
      setError("")

      if (firmResolveError) {
        setError(firmResolveError)
        setLoading(false)
        return
      }
      if (requiresSelection || !activeFirmId) {
        setError(
          requiresSelection
            ? "Select a firm to continue. You belong to more than one firm."
            : "Select a firm to continue."
        )
        setLoading(false)
        return
      }

      const firmId = activeFirmId

      const response = await fetch(`/api/accounting/firm/onboarding/complete?firm_id=${firmId}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load firm data")
      }

      const data = await response.json()
      setFirmName(data.firm.name ?? "")
      setUserRole(data.user_role)
      setLegalName(data.firm.legal_name || data.firm.name || "")
      setJurisdiction(data.firm.jurisdiction || "Ghana")

      if (data.firm.onboarding_status === "completed") {
        router.push(PRACTICE_HOME_PATH)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load firm data")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      const firmId = activeFirmId
      if (!firmId) {
        throw new Error(
          requiresSelection
            ? "Select a firm to continue. You belong to more than one firm."
            : "Select a firm to continue."
        )
      }

      if (!legalName.trim() || !jurisdiction.trim()) {
        throw new Error("Legal name and country are required")
      }

      const response = await fetch("/api/accounting/firm/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firm_id: firmId,
          legal_name: legalName.trim(),
          jurisdiction: jurisdiction.trim(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to complete onboarding")
      }

      router.push(PRACTICE_HOME_PATH)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-slate-700" />
      </div>
    )
  }

  if (userRole !== "partner") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          Only partners can complete firm setup. Contact a partner in your firm.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <FinzaLogo width={200} className="max-w-[min(200px,100%)]" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Firm details</h1>
          {firmName && (
            <p className="text-sm text-gray-600 mb-6">
              Finish setup for <span className="font-medium">{firmName}</span>
            </p>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="legal_name" className="block text-sm font-medium text-gray-700 mb-1.5">
                Legal name <span className="text-red-500">*</span>
              </label>
              <input
                id="legal_name"
                required
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="jurisdiction" className="block text-sm font-medium text-gray-700 mb-1.5">
                Country <span className="text-red-500">*</span>
              </label>
              <select
                id="jurisdiction"
                required
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {COUNTRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Continue to Practice"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
