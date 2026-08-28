"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { setActiveFirmId } from "@/lib/accounting/firm/session"
import { FinzaLogo } from "@/components/FinzaLogo"
import { PRACTICE_HOME_PATH } from "@/lib/auth/signupWorkspace"

const COUNTRY_OPTIONS = [
  { value: "Ghana", label: "Ghana" },
  { value: "Other", label: "Other" },
] as const

const DEFAULT_COUNTRY = "Ghana"

/**
 * Firm Setup — create accounting firm for new Practice partners.
 */
export default function FirmSetupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [firmName, setFirmName] = useState("")
  const [country, setCountry] = useState(DEFAULT_COUNTRY)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.replace("/login")
        return
      }
      setLoading(false)
    })()
  }, [router])

  const handleCreateFirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError("")
    setSubmitting(true)

    try {
      const trimmed = firmName.trim()
      if (!trimmed) {
        throw new Error("Firm name is required")
      }

      const response = await fetch("/api/accounting/firm/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          jurisdiction: country || DEFAULT_COUNTRY,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to create firm")
      }

      setActiveFirmId(data.firm_id, data.firm_name ?? trimmed)
      router.push(PRACTICE_HOME_PATH)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create firm")
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

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <FinzaLogo width={200} className="max-w-[min(200px,100%)]" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Create your accounting firm</h1>
          <p className="text-sm text-gray-600 mb-6">
            Set up your firm on Finza Practice to manage client work and books.
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleCreateFirm} className="space-y-5">
            <div>
              <label htmlFor="firm_name" className="block text-sm font-medium text-gray-700 mb-1.5">
                Firm name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="firm_name"
                required
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                placeholder="Your firm name"
                disabled={submitting}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="country" className="block text-sm font-medium text-gray-700 mb-1.5">
                Country <span className="text-red-500">*</span>
              </label>
              <select
                id="country"
                required
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60"
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
              disabled={submitting || !firmName.trim()}
              className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Creating…" : "Create firm"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
