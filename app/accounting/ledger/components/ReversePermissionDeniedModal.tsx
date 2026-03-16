"use client"

import { useEffect } from "react"

/**
 * Shown when accountant tries to reverse but access_level !== "approve".
 * Does not lock body scroll (no overflow hidden) so user can dismiss without feeling trapped.
 */

interface ReversePermissionDeniedModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function ReversePermissionDeniedModal({
  isOpen,
  onClose,
}: ReversePermissionDeniedModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="reverse-permission-title"
      aria-modal="false"
    >
      {/* Backdrop - click to close; no body overflow lock */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="reverse-permission-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Reverse requires Approval level engagement
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Contact client or upgrade engagement access.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
