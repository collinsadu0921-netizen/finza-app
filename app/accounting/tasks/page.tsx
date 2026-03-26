"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"

// ---------- types ------------------------------------------------------------

type TaskStatus   = "pending" | "in_progress" | "blocked" | "completed" | "cancelled"
type TaskPriority = "low" | "normal" | "high" | "urgent"

type FirmTask = {
  id: string
  firm_id: string
  client_business_id: string
  client_name: string | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigned_to_user_id: string | null
  created_by_user_id: string
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

// ---------- constants --------------------------------------------------------

const VALID_STATUSES:   TaskStatus[]   = ["pending", "in_progress", "blocked", "completed", "cancelled"]
const VALID_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"]

// ---------- helpers ----------------------------------------------------------

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })
      .format(new Date(iso))
  } catch { return iso }
}

function isOverdue(task: FirmTask): boolean {
  if (!task.due_at) return false
  if (task.status === "completed" || task.status === "cancelled") return false
  return new Date(task.due_at) < new Date()
}

// ---------- status badge -----------------------------------------------------

const STATUS_STYLES: Record<TaskStatus, string> = {
  pending:     "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  blocked:     "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  completed:   "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  cancelled:   "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}>
      {status.replace(/_/g, " ")}
    </span>
  )
}

// ---------- priority badge ---------------------------------------------------

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low:    "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  normal: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  high:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

const PRIORITY_ICONS: Record<TaskPriority, string> = {
  low: "↓", normal: "→", high: "↑", urgent: "⚡",
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${PRIORITY_STYLES[priority]}`}>
      {PRIORITY_ICONS[priority]} {priority}
    </span>
  )
}

// ---------- filter bar -------------------------------------------------------

function FilterBar({
  statusFilter,
  priorityFilter,
  clientFilter,
  clients,
  onStatus,
  onPriority,
  onClient,
}: {
  statusFilter: string
  priorityFilter: string
  clientFilter: string
  clients: { id: string; name: string }[]
  onStatus: (v: string) => void
  onPriority: (v: string) => void
  onClient: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Status pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-14 shrink-0">Status</span>
        {["", ...VALID_STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => onStatus(s)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {s === "" ? "All" : s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Priority pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-14 shrink-0">Priority</span>
        {["", ...VALID_PRIORITIES].map((p) => (
          <button
            key={p}
            onClick={() => onPriority(p)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
              priorityFilter === p
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {p === "" ? "All" : `${PRIORITY_ICONS[p as TaskPriority]} ${p}`}
          </button>
        ))}
      </div>

      {/* Client select — only rendered when there are multiple clients */}
      {clients.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-14 shrink-0">Client</span>
          <select
            value={clientFilter}
            onChange={(e) => onClient(e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-0.5 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {clientFilter && (
            <button
              onClick={() => onClient("")}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ✕ clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- summary counts ---------------------------------------------------

function SummaryCounts({ tasks }: { tasks: FirmTask[] }) {
  const open      = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
  const overdue   = tasks.filter(isOverdue).length
  const urgent    = tasks.filter((t) => t.priority === "urgent" && t.status !== "completed" && t.status !== "cancelled").length
  const completed = tasks.filter((t) => t.status === "completed").length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: "Open", value: open, color: "text-gray-900 dark:text-white" },
        { label: "Overdue", value: overdue, color: overdue > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400 dark:text-gray-500" },
        { label: "Urgent", value: urgent, color: urgent > 0 ? "text-orange-600 dark:text-orange-400" : "text-gray-400 dark:text-gray-500" },
        { label: "Completed", value: completed, color: "text-green-600 dark:text-green-400" },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
          <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

// ---------- task table -------------------------------------------------------

function TaskTable({
  tasks,
}: {
  tasks: FirmTask[]
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <svg
          className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
          />
        </svg>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No tasks match your filters</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800/60">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Client
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Task
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Priority
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Due
            </th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Open
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
          {tasks.map((task) => {
            const overdue = isOverdue(task)
            const clientHref = `/accounting/clients/${encodeURIComponent(task.client_business_id)}/tasks`

            return (
              <tr
                key={task.id}
                className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                  task.status === "completed" || task.status === "cancelled"
                    ? "opacity-60"
                    : ""
                }`}
              >
                {/* Client */}
                <td className="px-4 py-3 text-sm">
                  <Link
                    href={clientHref}
                    className="font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                  >
                    {task.client_name ?? task.client_business_id.slice(0, 8) + "…"}
                  </Link>
                </td>

                {/* Task title + optional description */}
                <td className="px-4 py-3">
                  <Link
                    href={clientHref}
                    className="block group"
                  >
                    <p className={`text-sm font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors ${
                      task.status === "completed" || task.status === "cancelled"
                        ? "line-through text-gray-400 dark:text-gray-500"
                        : "text-gray-900 dark:text-white"
                    }`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                        {task.description}
                      </p>
                    )}
                  </Link>
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <StatusBadge status={task.status} />
                </td>

                {/* Priority */}
                <td className="px-4 py-3">
                  <PriorityBadge priority={task.priority} />
                </td>

                {/* Due date */}
                <td className={`px-4 py-3 text-sm whitespace-nowrap ${
                  overdue
                    ? "text-red-600 dark:text-red-400 font-medium"
                    : "text-gray-500 dark:text-gray-400"
                }`}>
                  {overdue && <span className="mr-1">⚠</span>}
                  {fmtDate(task.due_at)}
                </td>

                {/* Open link */}
                <td className="px-4 py-3 text-right">
                  <Link
                    href={clientHref}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    Open
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- page -------------------------------------------------------------

export default function FirmTasksPage() {
  const [allTasks, setAllTasks] = useState<FirmTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [statusFilter,   setStatusFilter]   = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")
  const [clientFilter,   setClientFilter]   = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/tasks?limit=500")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Failed (${res.status})`); return }
      setAllTasks(data.tasks ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Unique client list derived from all tasks
  const clients = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of allTasks) {
      if (!seen.has(t.client_business_id)) {
        seen.set(t.client_business_id, t.client_name ?? t.client_business_id.slice(0, 8))
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allTasks])

  // Client-side filtering (all tasks already loaded)
  const filtered = useMemo(() => {
    return allTasks.filter((t) => {
      if (statusFilter   && t.status   !== statusFilter)          return false
      if (priorityFilter && t.priority !== priorityFilter)        return false
      if (clientFilter   && t.client_business_id !== clientFilter) return false
      return true
    })
  }, [allTasks, statusFilter, priorityFilter, clientFilter])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">All tasks</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Tasks across all your firm&apos;s clients. Create tasks from within each client&apos;s task page.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="h-7 w-7 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary counts — based on all tasks (not filtered) */}
          <SummaryCounts tasks={allTasks} />

          {/* Filters */}
          <div className="mb-5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <FilterBar
              statusFilter={statusFilter}
              priorityFilter={priorityFilter}
              clientFilter={clientFilter}
              clients={clients}
              onStatus={setStatusFilter}
              onPriority={setPriorityFilter}
              onClient={setClientFilter}
            />
          </div>

          {/* Result count */}
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {filtered.length} task{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== allTasks.length && ` (filtered from ${allTasks.length})`}
            </p>
            {(statusFilter || priorityFilter || clientFilter) && (
              <button
                onClick={() => { setStatusFilter(""); setPriorityFilter(""); setClientFilter("") }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Table */}
          <TaskTable tasks={filtered} />
        </>
      )}
    </div>
  )
}
