"use client"

import { useState, useEffect } from "react"

export interface SuspendEngagementModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (reason?: string) => void | Promise<void>
  loading?: boolean
}

export default function SuspendEngagementModal({
  open,
  onClose,
  onConfirm,
  loading = false,
}: SuspendEngagementModalProps) {
  const [reason, setReason] = useState("")

  useEffect(() => {
    if (!open) setReason("")
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, loading, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="suspend-title"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/40" onClick={() => !loading && onClose()} />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="suspend-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Suspend engagement
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Suspending will block firm access until reactivated.
        </p>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Reason (optional)
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional reason"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm mb-4"
          disabled={loading}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => await onConfirm(reason || undefined)}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {loading ? "Suspending…" : "Suspend"}
          </button>
        </div>
      </div>
    </div>
  )
}
