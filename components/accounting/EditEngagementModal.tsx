"use client"

import { useState, useEffect } from "react"

export type AccessLevel = "read" | "write" | "approve"

export interface EditEngagementModalProps {
  open: boolean
  onClose: () => void
  currentAccessLevel: AccessLevel
  currentEffectiveFrom: string
  currentEffectiveTo: string | null
  onSave: (payload: { access_level: AccessLevel; effective_from: string; effective_to: string | null }) => Promise<void>
  loading?: boolean
}

export default function EditEngagementModal({
  open,
  onClose,
  currentAccessLevel,
  currentEffectiveFrom,
  currentEffectiveTo,
  onSave,
  loading = false,
}: EditEngagementModalProps) {
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(currentAccessLevel)
  const [effectiveFrom, setEffectiveFrom] = useState(currentEffectiveFrom)
  const [effectiveTo, setEffectiveTo] = useState(currentEffectiveTo ?? "")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setAccessLevel(currentAccessLevel)
      setEffectiveFrom(currentEffectiveFrom)
      setEffectiveTo(currentEffectiveTo ?? "")
      setError(null)
    }
  }, [open, currentAccessLevel, currentEffectiveFrom, currentEffectiveTo])

  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, loading, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const from = effectiveFrom.trim()
    const to = effectiveTo.trim() || null
    if (!from) {
      setError("Effective from is required.")
      return
    }
    if (to && from && to <= from) {
      setError("Effective to must be after effective from.")
      return
    }
    try {
      await onSave({
        access_level: accessLevel,
        effective_from: from,
        effective_to: to,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="edit-engagement-title"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/40" onClick={() => !loading && onClose()} />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-engagement-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Edit engagement
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Access level
            </label>
            <div className="flex gap-2">
              {(["read", "write", "approve"] as const).map((level) => (
                <label key={level} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="access_level"
                    value={level}
                    checked={accessLevel === level}
                    onChange={() => setAccessLevel(level)}
                    disabled={loading}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm capitalize text-gray-700 dark:text-gray-300">{level}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="effective_from" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Effective from
            </label>
            <input
              id="effective_from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <div>
            <label htmlFor="effective_to" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Effective to (optional)
            </label>
            <input
              id="effective_to"
              type="date"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
