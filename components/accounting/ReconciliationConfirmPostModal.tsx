"use client"

import Modal from "@/components/ui/Modal"
import Button from "@/components/ui/Button"

interface ReconciliationConfirmPostModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isPosting: boolean
  /** When true, records approval only (two-person rule first approver); no JE posted. */
  approveOnly?: boolean
}

export default function ReconciliationConfirmPostModal({
  isOpen,
  onClose,
  onConfirm,
  isPosting,
  approveOnly = false,
}: ReconciliationConfirmPostModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={approveOnly ? "Confirm approval (first approver)" : "Confirm post"}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPosting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} isLoading={isPosting}>
            {approveOnly ? "Approve only" : "Post ledger adjustment (immutable)"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {approveOnly
            ? "Record your approval only. A second approver must then post the ledger adjustment."
            : "Are you sure you want to post this ledger adjustment?"}
        </p>
        {!approveOnly && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
            <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-1">What happens:</p>
            <ul className="text-xs text-blue-700 dark:text-blue-300 list-disc list-inside space-y-0.5">
              <li>A new journal entry will be created</li>
              <li>No existing entry is modified</li>
              <li>This action is immutable and attributable to your user</li>
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
