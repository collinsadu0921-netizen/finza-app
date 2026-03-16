"use client"

import { useState } from "react"

interface DiscountOverrideModalProps {
  isOpen: boolean
  onClose: () => void
  saleId: string
  cashierId: string
  discountPercent: number
  onSuccess?: () => void
}

export default function DiscountOverrideModal({
  isOpen,
  onClose,
  saleId,
  cashierId,
  discountPercent,
  onSuccess,
}: DiscountOverrideModalProps) {
  const [supervisorEmail, setSupervisorEmail] = useState("")
  const [supervisorPassword, setSupervisorPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const response = await fetch("/api/override/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supervisor_email: supervisorEmail,
          supervisor_password: supervisorPassword,
          sale_id: saleId,
          cashier_id: cashierId,
          discount_percent: discountPercent,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Invalid supervisor authorization.")
      }

      onSuccess?.()
    } catch (err: any) {
      setError(err.message || "Invalid supervisor authorization.")
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4 shadow-xl my-8 relative">
        <h2 className="text-xl font-bold mb-4 text-red-600">
          Supervisor Override Required
        </h2>

        <div className="bg-red-50 border-2 border-red-300 rounded p-4 mb-4">
          <p className="text-sm text-gray-700 mb-2">
            A discount of{" "}
            <span className="font-bold text-red-700 text-lg">
              {discountPercent.toFixed(1)}%
            </span>{" "}
            exceeds the 10% limit.
          </p>
          <p className="text-sm text-gray-700 mb-2">
            Supervisor approval is required to apply this discount.
          </p>
          <p className="text-xs text-gray-600">
            This action will be recorded in the system.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-2 border-red-400 text-red-700 px-4 py-3 rounded mb-4 relative z-10">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="font-semibold">Error:</p>
                <p>{error}</p>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Supervisor Email/Username *
            </label>
            <input
              type="text"
              value={supervisorEmail}
              onChange={(e) => setSupervisorEmail(e.target.value)}
              className="border p-3 rounded w-full"
              placeholder="supervisor@example.com"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Supervisor Password *
            </label>
            <input
              type="password"
              value={supervisorPassword}
              onChange={(e) => setSupervisorPassword(e.target.value)}
              className="border p-3 rounded w-full"
              placeholder="Enter password"
              required
              disabled={loading}
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
              className="bg-red-600 text-white px-4 py-2 rounded flex-1"
              disabled={loading}
            >
              {loading ? "Verifying..." : "Approve Discount"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}



