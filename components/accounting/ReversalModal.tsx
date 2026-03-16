"use client"

import { useState } from "react"
import Modal from "@/components/ui/Modal"
import Button from "@/components/ui/Button"
import ReversalPreview, { type ReversalPreviewLine } from "./ReversalPreview"

const MIN_REASON_LENGTH = 10

export type JournalEntryForReversal = {
  id: string
  date: string
  description: string | null
  reference_type: string | null
  reference_id: string | null
  journal_entry_lines: Array<{
    id: string
    account_id: string
    debit: number
    credit: number
    description: string | null
    accounts: { id: string; name: string; code: string; type: string }
  }>
}

interface ReversalModalProps {
  isOpen: boolean
  onClose: () => void
  entry: JournalEntryForReversal | null
  onConfirm: (payload: { reason: string; reversal_date: string }) => Promise<{ reversal_journal_entry_id: string } | { error: string }>
  onSuccess?: (reversalJeId: string) => void
}

export default function ReversalModal({
  isOpen,
  onClose,
  entry,
  onConfirm,
  onSuccess,
}: ReversalModalProps) {
  const [reason, setReason] = useState("")
  const [reversalDate, setReversalDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH
  const canSubmit = reasonValid && !!entry

  const previewLines: ReversalPreviewLine[] = entry
    ? entry.journal_entry_lines.map((line) => ({
        accountCode: line.accounts?.code ?? "",
        accountName: line.accounts?.name ?? "",
        originalDebit: Number(line.debit) || 0,
        originalCredit: Number(line.credit) || 0,
        reversalDebit: Number(line.credit) || 0,
        reversalCredit: Number(line.debit) || 0,
      }))
    : []

  const handleClose = () => {
    setReason("")
    setReversalDate(new Date().toISOString().slice(0, 10))
    setSubmitError("")
    onClose()
  }

  const handleConfirm = async () => {
    if (!entry || !canSubmit) return
    setSubmitting(true)
    setSubmitError("")
    try {
      const result = await onConfirm({ reason: reason.trim(), reversal_date: reversalDate })
      if ("error" in result) {
        setSubmitError(result.error)
        return
      }
      onSuccess?.(result.reversal_journal_entry_id)
      handleClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Reverse journal entry"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!canSubmit || submitting}
            isLoading={submitting}
          >
            Confirm Reversal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-amber-700 dark:text-amber-200 text-sm font-medium rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          Reversing creates a new journal entry. Original entries remain immutable.
        </p>

        {entry && (
          <>
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Original journal entry</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {entry.date ? new Date(entry.date).toLocaleDateString() : "—"} · {entry.description || "—"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">ID: {entry.id.slice(0, 8)}…</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Reason for reversal <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Duplicate entry; correcting account code."
                rows={3}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Minimum {MIN_REASON_LENGTH} characters. {reason.trim().length < MIN_REASON_LENGTH && `${MIN_REASON_LENGTH - reason.trim().length} more needed.`}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Reversal date
              </label>
              <input
                type="date"
                value={reversalDate}
                onChange={(e) => setReversalDate(e.target.value.slice(0, 10))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white max-w-xs"
              />
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Preview</h4>
              <ReversalPreview lines={previewLines} />
            </div>
          </>
        )}

        {submitError && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {submitError}
          </div>
        )}
      </div>
    </Modal>
  )
}
