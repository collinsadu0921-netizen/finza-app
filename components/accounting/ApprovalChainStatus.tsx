"use client"

import { useEffect, useState } from "react"

type ApprovalItem = {
  scope_type: string
  scope_id: string
  proposal_hash: string
  delta: number
  approval_count: number
  first_approver: {
    approved_by: string
    approved_at: string
    approver_role: string
  }
}

type ApprovalChainStatusProps = {
  businessId: string
  scopeType?: string
  scopeId?: string
  proposalHash?: string
}

export default function ApprovalChainStatus({
  businessId,
  scopeType,
  scopeId,
  proposalHash,
}: ApprovalChainStatusProps) {
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function fetchPending() {
      try {
        const res = await fetch(
          `/api/accounting/reconciliation/pending-approvals?businessId=${encodeURIComponent(businessId)}`
        )
        if (!res.ok) {
          setError("Failed to load approvals")
          return
        }
        const data = await res.json()
        let list = data.pending ?? []
        if (scopeType && scopeId) {
          list = list.filter(
            (p: ApprovalItem) => p.scope_type === scopeType && p.scope_id === scopeId
          )
        }
        if (proposalHash) {
          list = list.filter((p: ApprovalItem) => p.proposal_hash === proposalHash)
        }
        if (!cancelled) setItems(list)
      } catch {
        if (!cancelled) setError("Failed to load approvals")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPending()
    return () => {
      cancelled = true
    }
  }, [businessId, scopeType, scopeId, proposalHash])

  if (loading) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Loading approval status…
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-sm text-amber-600 dark:text-amber-400">
        {error}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No pending approvals for this scope.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Approval chain
      </h4>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li
            key={`${item.scope_type}-${item.scope_id}-${item.proposal_hash}-${idx}`}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="text-gray-600 dark:text-gray-400">
              {item.scope_type}:{item.scope_id.slice(0, 8)}…
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Pending
            </span>
            <span className="text-gray-500 dark:text-gray-400 text-xs">
              1 approver · {item.first_approver.approver_role} at{" "}
              {new Date(item.first_approver.approved_at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
