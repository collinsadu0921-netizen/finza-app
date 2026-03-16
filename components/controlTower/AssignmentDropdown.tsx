"use client"

import { useState, useRef, useEffect } from "react"
import type { ControlTowerWorkItem } from "@/lib/controlTower/types"

const STORAGE_KEY = "finza.controlTower.assignments"

function getStoredAssignments(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setAssignment(itemId: string, staffId: string | null) {
  const next = { ...getStoredAssignments() }
  if (staffId) next[itemId] = staffId
  else delete next[itemId]
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

/** Placeholder staff list — in production would come from firm members API */
const PLACEHOLDER_STAFF = [
  { id: "unassigned", label: "Unassigned" },
  { id: "staff-1", label: "Staff 1" },
  { id: "staff-2", label: "Staff 2" },
  { id: "partner", label: "Partner" },
]

export interface AssignmentDropdownProps {
  workItem: ControlTowerWorkItem
  onAssignmentChange?: (itemId: string, staffId: string | null) => void
}

export default function AssignmentDropdown({ workItem, onAssignmentChange }: AssignmentDropdownProps) {
  const [open, setOpen] = useState(false)
  const [assignments, setAssignments] = useState<Record<string, string>>(getStoredAssignments)
  const ref = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  const current = assignments[workItem.id] ?? null

  useEffect(() => {
    mountedRef.current = true
    const stored = getStoredAssignments()
    if (mountedRef.current) setAssignments(stored)
    return () => {
      mountedRef.current = false
    }
  }, [workItem.id])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [open])

  const handleSelect = (staffId: string) => {
    const value = staffId === "unassigned" ? null : staffId
    setAssignment(workItem.id, value)
    setAssignments((prev) => {
      const next = { ...prev }
      if (value) next[workItem.id] = value
      else delete next[workItem.id]
      return next
    })
    onAssignmentChange?.(workItem.id, value)
    setOpen(false)
    // Activity log (fire-and-forget)
    fetch("/api/accounting/control-tower/log-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionType: "CONTROL_TOWER_ASSIGNMENT",
        entityType: "work_item",
        entityId: workItem.id,
        metadata: { workItemType: workItem.work_item_type, assignedTo: value ?? "unassigned" },
      }),
    }).catch(() => {})
  }

  const label = current
    ? PLACEHOLDER_STAFF.find((s) => s.id === current)?.label ?? current
    : "Assign"

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <span className="truncate max-w-[100px]">{label}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[140px] py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
          {PLACEHOLDER_STAFF.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSelect(s.id)}
              className={`block w-full text-left px-3 py-1.5 text-sm ${
                (s.id === "unassigned" ? !current : current === s.id)
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200"
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function getAssignment(itemId: string): string | null {
  return getStoredAssignments()[itemId] ?? null
}
