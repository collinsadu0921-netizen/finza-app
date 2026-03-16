"use client"

import { useState, useEffect } from "react"

export interface TerminateEngagementModalProps {
  open: boolean
  onClose: () => void
  clientName: string
  onConfirm: (reason?: string) => void | Promise<void>
  loading?: boolean
}

export default function TerminateEngagementModal({
  open,
  onClose,
  clientName,
  onConfirm,
  loading = false,
}: TerminateEngagementModalProps) {
  const [typedName, setTypedName] = useState("")
  const [reason, setReason] = useState("")

  useEffect(() => {
    if (!open) {
      setTypedName("")
      setReason("")
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, loading, onClose])

  const match = clientName.trim() !== "" && typedName.trim().toLowerCase() === clientName.trim().toLowerCase()

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="terminate-title"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/40" onClick={() => !loading && onClose()} />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="terminate-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Terminate engagement
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Termination immediately blocks firm access. <strong className="text-red-600 dark:text-red-400">This action is irreversible.</strong>
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Type the client name <strong className="text-gray-900 dark:text-white">{clientName}</strong> to confirm:
        </p>
        <input
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="Client name"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm mb-3"
          disabled={loading}
        />
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Client requested termination"
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm mb-4 resize-none"
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
            onClick={async () => {
              if (!match) return
              await onConfirm(reason.trim() || undefined)
            }}
            disabled={!match || loading}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Terminating…" : "Terminate"}
          </button>
        </div>
      </div>
    </div>
  )
}
