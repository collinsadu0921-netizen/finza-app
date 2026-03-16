"use client"

import { useEffect } from "react"

export type AccessLevel = "read" | "write" | "approve"

export interface EngagementAccessModalProps {
  open: boolean
  onClose: () => void
  currentLevel: AccessLevel
  onConfirm: (level: AccessLevel) => void | Promise<void>
  loading?: boolean
}

export default function EngagementAccessModal({
  open,
  onClose,
  currentLevel,
  onConfirm,
  loading = false,
}: EngagementAccessModalProps) {
  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, loading, onClose])

  if (!open) return null

  const levels: AccessLevel[] = ["read", "write", "approve"]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="access-modal-title"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/40" onClick={() => !loading && onClose()} />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="access-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Change access level
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Current: <strong>{currentLevel}</strong>. Select new level:
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onConfirm(level)}
              disabled={loading || level === currentLevel}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed capitalize"
            >
              {level}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
