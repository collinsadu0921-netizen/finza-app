"use client"

import { useState } from "react"
import type { ControlTowerWorkItem, WorkItemType } from "@/lib/controlTower/types"
import Modal from "@/components/ui/Modal"

type BulkActionType =
  | "journal_approve"
  | "journal_post"
  | "ob_approve"
  | "ob_post"

const BULK_ACTION_LABELS: Record<BulkActionType, string> = {
  journal_approve: "Approve journals",
  journal_post: "Post journals",
  ob_approve: "Approve opening balances",
  ob_post: "Post opening balances",
}

function appliesTo(type: WorkItemType, action: BulkActionType): boolean {
  switch (action) {
    case "journal_approve":
      return type === "journal_approval"
    case "journal_post":
      return type === "journal_post"
    case "ob_approve":
      return type === "ob_approval"
    case "ob_post":
      return type === "ob_post"
    default:
      return false
  }
}

export interface BulkActionResult {
  success: number
  failed: number
  errors: { id: string; message: string }[]
}

async function runBulkAction(
  action: BulkActionType,
  items: ControlTowerWorkItem[]
): Promise<BulkActionResult> {
  const applicable = items.filter((w) => appliesTo(w.work_item_type, action))
  const errors: { id: string; message: string }[] = []
  let success = 0

  for (const w of applicable) {
    const entityId = w.reference_entity?.id
    const businessId = w.business_id
    if (!entityId) {
      errors.push({ id: w.id, message: "Missing reference entity" })
      continue
    }
    try {
      let url: string
      let options: RequestInit = { method: "POST" }
      if (action === "journal_approve") {
        url = `/api/accounting/journals/drafts/${entityId}/approve?business_id=${encodeURIComponent(businessId)}`
      } else if (action === "journal_post") {
        url = `/api/accounting/journals/drafts/${entityId}/post?business_id=${encodeURIComponent(businessId)}`
      } else if (action === "ob_approve") {
        url = `/api/accounting/opening-balances/${entityId}/approve`
        options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
      } else if (action === "ob_post") {
        url = `/api/accounting/opening-balances/${entityId}/post`
      } else {
        errors.push({ id: w.id, message: "Unknown action" })
        continue
      }
      const res = await fetch(url, options)
      if (res.ok) {
        success++
      } else {
        const data = await res.json().catch(() => ({}))
        errors.push({
          id: w.id,
          message: (data.message || data.error || `HTTP ${res.status}`) as string,
        })
      }
    } catch (e) {
      errors.push({ id: w.id, message: e instanceof Error ? e.message : "Request failed" })
    }
  }

  return {
    success,
    failed: errors.length,
    errors,
  }
}

export interface BulkActionBarProps {
  selectedItems: ControlTowerWorkItem[]
  onClearSelection: () => void
  onComplete: () => void
}

export default function BulkActionBar({
  selectedItems,
  onClearSelection,
  onComplete,
}: BulkActionBarProps) {
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<BulkActionType | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BulkActionResult | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)

  const applicableActions = (["journal_approve", "journal_post", "ob_approve", "ob_post"] as const).filter(
    (action) => selectedItems.some((w) => appliesTo(w.work_item_type, action))
  )

  const handleRun = async () => {
    const action = confirmAction
    if (!action || selectedItems.length === 0) return
    setRunning(true)
    setConfirmAction(null)
    try {
      const res = await runBulkAction(action, selectedItems)
      setResult(res)
      setSummaryOpen(true)
      onComplete()
      // Activity log (fire-and-forget)
      fetch("/api/accounting/control-tower/log-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "CONTROL_TOWER_BULK_ACTION",
          entityType: "bulk_action",
          metadata: {
            action,
            success: res.success,
            failed: res.failed,
            errorCount: res.errors.length,
          },
        }),
      }).catch(() => {})
    } finally {
      setRunning(false)
    }
  }

  if (selectedItems.length === 0) return null

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {selectedItems.length} selected
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setActionDropdownOpen((o) => !o)}
            disabled={applicableActions.length === 0 || running}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Bulk action ▾
          </button>
          {actionDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 min-w-[200px] py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
              {applicableActions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  No bulk actions for selected types
                </div>
              ) : (
                applicableActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => {
                      setConfirmAction(action)
                      setActionDropdownOpen(false)
                    }}
                    className="block w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {BULK_ACTION_LABELS[action]}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
        >
          Clear selection
        </button>
        {running && (
          <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
            <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            Running…
          </span>
        )}
      </div>

      {/* Confirmation modal */}
      <Modal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title="Confirm bulk action"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRun}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Run
            </button>
          </div>
        }
      >
        {confirmAction && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Run <strong>{BULK_ACTION_LABELS[confirmAction]}</strong> on{" "}
            {selectedItems.filter((w) => appliesTo(w.work_item_type, confirmAction)).length} item(s)?
            Failures will be reported after completion.
          </p>
        )}
      </Modal>

      {/* Summary modal */}
      <Modal
        isOpen={summaryOpen}
        onClose={() => { setSummaryOpen(false); setResult(null) }}
        title="Bulk action result"
        size="md"
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => { setSummaryOpen(false); setResult(null) }}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        }
      >
        {result && (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-green-600 dark:text-green-400 font-medium">{result.success} succeeded</span>
              {result.failed > 0 && (
                <span className="text-red-600 dark:text-red-400 font-medium"> · {result.failed} failed</span>
              )}
            </p>
            {result.errors.length > 0 && (
              <div className="rounded border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20 p-3 max-h-48 overflow-y-auto">
                <p className="font-medium text-red-800 dark:text-red-200 mb-2">Failure reasons:</p>
                <ul className="list-disc list-inside space-y-1 text-red-700 dark:text-red-300">
                  {result.errors.slice(0, 10).map((e) => (
                    <li key={e.id}>{e.message}</li>
                  ))}
                  {result.errors.length > 10 && (
                    <li>… and {result.errors.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
