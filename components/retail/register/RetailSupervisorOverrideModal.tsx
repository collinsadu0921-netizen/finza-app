"use client"

import { useState, useEffect, useRef } from "react"
import { formatMoney } from "@/lib/money"

interface RetailSupervisorOverrideModalProps {
  isOpen: boolean
  onClose: () => void
  registerId: string
  sessionId: string
  cashierId: string
  varianceAmount: number
  countedCash: number
  expectedCash: number
  /** ISO currency code for display; defaults to GHS (₵) */
  currencyCode?: string | null
  onSuccess?: () => void
}

/**
 * Retail-owned copy of the supervisor variance modal (calls shared `/api/register/override`).
 */
export default function RetailSupervisorOverrideModal({
  isOpen,
  onClose,
  registerId,
  sessionId,
  cashierId: _cashierId,
  varianceAmount,
  countedCash,
  expectedCash,
  currencyCode = null,
  onSuccess,
}: RetailSupervisorOverrideModalProps) {
  const homeCode = currencyCode ?? "GHS"
  const [supervisorEmail, setSupervisorEmail] = useState("")
  const [supervisorPassword, setSupervisorPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const emailInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && emailInputRef.current) {
      emailInputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setSupervisorEmail("")
      setSupervisorPassword("")
      setError("")
      setLoading(false)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!supervisorEmail.trim()) {
      setError("Please enter supervisor email/username")
      return
    }

    if (!supervisorPassword) {
      setError("Please enter supervisor password")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/register/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supervisor_email: supervisorEmail.trim(),
          supervisor_password: supervisorPassword,
          register_id: registerId,
          session_id: sessionId,
          variance_amount: varianceAmount,
          counted_cash: countedCash,
          expected_cash: expectedCash,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Invalid supervisor authorization.")
      }

      onSuccess?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid supervisor authorization.")
      setLoading(false)
    }
  }

  const handleEmailChange = (value: string) => {
    setSupervisorEmail(value)
    if (error) setError("")
  }

  const handlePasswordChange = (value: string) => {
    setSupervisorPassword(value)
    if (error) setError("")
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-bold text-red-600">Supervisor override required</h2>

        <div className="mb-4 rounded border-2 border-red-300 bg-red-50 p-4">
          <p className="mb-2 text-sm text-gray-700">
            A variance of{" "}
            <span className="text-lg font-bold text-red-700">
              {varianceAmount > 0 ? "+" : ""}
              {formatMoney(varianceAmount, homeCode)}
            </span>{" "}
            was detected.
          </p>
          <p className="text-sm text-gray-700">Supervisor approval is required to close the register.</p>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Supervisor email / username *</label>
            <input
              ref={emailInputRef}
              type="text"
              value={supervisorEmail}
              onChange={(e) => handleEmailChange(e.target.value)}
              className="w-full rounded border p-3"
              placeholder="supervisor@example.com"
              required
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Supervisor password *</label>
            <input
              type="password"
              value={supervisorPassword}
              onChange={(e) => handlePasswordChange(e.target.value)}
              className="w-full rounded border p-3"
              placeholder="Enter password"
              required
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded bg-gray-300 px-4 py-2 text-gray-800"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded bg-red-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
              disabled={loading || !supervisorEmail.trim() || !supervisorPassword}
            >
              {loading ? "Verifying…" : "Approve override"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
