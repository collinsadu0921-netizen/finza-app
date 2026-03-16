"use client"

import { useEffect } from "react"

/**
 * Shown when user attempts an action they do not have engagement access for.
 * Title: "Action not allowed"; body: message + contact client to upgrade.
 */

interface BlockedActionModalProps {
  message: string
  open: boolean
  onClose: () => void
}

export default function BlockedActionModal({
  message,
  open,
  onClose,
}: BlockedActionModalProps) {
  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="blocked-action-title"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="blocked-action-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Action not allowed
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          {message}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
          Contact the client to upgrade engagement access.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
