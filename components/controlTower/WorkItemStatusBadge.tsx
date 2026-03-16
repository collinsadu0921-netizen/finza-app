"use client"

import { useState, useRef, useEffect } from "react"

const STORAGE_KEY = "finza.controlTower.workItemStatus"

export type WorkItemStatus = "pending" | "in_progress" | "blocked" | "completed"

function getStoredStatuses(): Record<string, WorkItemStatus> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setStatus(itemId: string, status: WorkItemStatus) {
  const next = { ...getStoredStatuses() }
  next[itemId] = status
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

const LABELS: Record<WorkItemStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  blocked: "Blocked",
  completed: "Completed",
}

const CLASSES: Record<WorkItemStatus, string> = {
  pending: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  blocked: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
}

export interface WorkItemStatusBadgeProps {
  workItemId: string
  onStatusChange?: (status: WorkItemStatus) => void
}

export default function WorkItemStatusBadge({ workItemId, onStatusChange }: WorkItemStatusBadgeProps) {
  const [status, setStatusState] = useState<WorkItemStatus>(() => getStoredStatuses()[workItemId] ?? "pending")
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const next = getStoredStatuses()[workItemId] ?? "pending"
    if (mountedRef.current) setStatusState(next)
    return () => {
      mountedRef.current = false
    }
  }, [workItemId])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [open])

  const handleSelect = (s: WorkItemStatus) => {
    setStatus(workItemId, s)
    setStatusState(s)
    onStatusChange?.(s)
    setOpen(false)
  }

  const statuses: WorkItemStatus[] = ["pending", "in_progress", "blocked", "completed"]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${CLASSES[status]}`}
        title="✔ Completed · ⏳ In Progress · ⚠ Blocked"
      >
        {status === "completed" && "✔ "}
        {status === "in_progress" && "⏳ "}
        {status === "blocked" && "⚠ "}
        {LABELS[status]}
        <span className="opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[120px] py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSelect(s)}
              className={`block w-full text-left px-3 py-1.5 text-xs ${status === s ? "bg-blue-50 dark:bg-blue-900/30" : ""} hover:bg-gray-50 dark:hover:bg-gray-700`}
            >
              {LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function getWorkItemStatus(itemId: string): WorkItemStatus {
  return getStoredStatuses()[itemId] ?? "pending"
}
