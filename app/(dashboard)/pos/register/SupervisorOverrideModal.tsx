"use client"

import { useState, useEffect, useRef } from "react"
import { formatMoney } from "@/lib/money"

interface SupervisorOverrideModalProps {
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

export default function SupervisorOverrideModal({
  isOpen,
  onClose,
  registerId,
  sessionId,
  cashierId,
  varianceAmount,
  countedCash,
  expectedCash,
  currencyCode = null,
  onSuccess,
}: SupervisorOverrideModalProps) {
  const homeCode = currencyCode ?? "GHS"
  const [supervisorEmail, setSupervisorEmail] = useState("")
  const [supervisorPassword, setSupervisorPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const emailInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus first field when modal opens
  useEffect(() => {
    if (isOpen && emailInputRef.current) {
      emailInputRef.current.focus()
    }
  }, [isOpen])

  // Clear form when modal closes
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

    // Validate fields
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

      // Success - close modal and call onSuccess
      onSuccess?.()
    } catch (err: any) {
      setError(err.message || "Invalid supervisor authorization.")
      setLoading(false)
    }
  }

  const handleEmailChange = (value: string) => {
    setSupervisorEmail(value)
    if (error) setError("") // Clear error when user types
  }

  const handlePasswordChange = (value: string) => {
    setSupervisorPassword(value)
    if (error) setError("") // Clear error when user types
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-xl font-bold mb-4 text-red-600">
          Supervisor Override Required
        </h2>

        <div className="bg-red-50 border-2 border-red-300 rounded p-4 mb-4">
          <p className="text-sm text-gray-700 mb-2">
            A variance of{" "}
            <span className="font-bold text-red-700 text-lg">
              {varianceAmount > 0 ? "+" : ""}
              {formatMoney(varianceAmount, homeCode)}
            </span>{" "}
            was detected.
          </p>
          <p className="text-sm text-gray-700">
            Supervisor approval is required to close the register.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Supervisor Email/Username *
            </label>
            <input
              ref={emailInputRef}
              type="text"
              value={supervisorEmail}
              onChange={(e) => handleEmailChange(e.target.value)}
              className="border p-3 rounded w-full"
              placeholder="supervisor@example.com"
              required
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Supervisor Password *
            </label>
            <input
              type="password"
              value={supervisorPassword}
              onChange={(e) => handlePasswordChange(e.target.value)}
              className="border p-3 rounded w-full"
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
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded flex-1"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-red-600 text-white px-4 py-2 rounded flex-1 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={loading || !supervisorEmail.trim() || !supervisorPassword}
            >
              {loading ? "Verifying..." : "Approve Override"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


