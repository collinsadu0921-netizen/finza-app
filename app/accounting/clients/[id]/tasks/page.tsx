"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"

// ---------- types ------------------------------------------------------------

type TaskStatus   = "pending" | "in_progress" | "blocked" | "completed" | "cancelled"
type TaskPriority = "low" | "normal" | "high" | "urgent"

type ClientTask = {
  id: string
  firm_id: string
  client_business_id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigned_to_user_id: string | null
  created_by_user_id: string
  due_at: string | null
  completed_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ---------- constants --------------------------------------------------------

const VALID_STATUSES: TaskStatus[]     = ["pending", "in_progress", "blocked", "completed", "cancelled"]
const VALID_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"]

// ---------- helpers ----------------------------------------------------------

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })
      .format(new Date(iso))
  } catch { return iso }
}

function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso))
  } catch { return iso }
}

function isOverdue(task: ClientTask): boolean {
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
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
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
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[priority]}`}>
      {PRIORITY_ICONS[priority]} {priority}
    </span>
  )
}

// ---------- status transition map --------------------------------------------

const NEXT_STATUSES: Record<TaskStatus, TaskStatus[]> = {
  pending:     ["in_progress", "cancelled"],
  in_progress: ["completed", "blocked", "pending", "cancelled"],
  blocked:     ["in_progress", "pending", "cancelled"],
  completed:   ["in_progress"],
  cancelled:   ["pending"],
}

// ---------- task card --------------------------------------------------------

function TaskCard({
  task,
  businessId,
  onUpdated,
}: {
  task: ClientTask
  businessId: string
  onUpdated: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [editingPriority, setEditingPriority] = useState(false)
  const overdue = isOverdue(task)
  const base = `/api/accounting/clients/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(task.id)}`

  async function patch(payload: Record<string, unknown>) {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Failed (${res.status})`); return }
      onUpdated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  const nextStatuses = NEXT_STATUSES[task.status] ?? []
  const isDone = task.status === "completed"
  const isCancelled = task.status === "cancelled"

  return (
    <div className={`rounded-lg border bg-white dark:bg-gray-800 p-4 transition-colors ${
      overdue
        ? "border-red-200 dark:border-red-800"
        : isDone
        ? "border-gray-200 dark:border-gray-700 opacity-70"
        : "border-gray-200 dark:border-gray-700"
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {/* Quick-complete checkbox */}
          <button
            onClick={() => patch({ status: isDone ? "pending" : "completed" })}
            disabled={saving || isCancelled}
            aria-label={isDone ? "Mark pending" : "Mark completed"}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40 ${
              isDone
                ? "border-green-500 bg-green-500 text-white"
                : "border-gray-300 dark:border-gray-600 hover:border-green-400"
            }`}
          >
            {isDone && (
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            )}
          </button>

          <div className="min-w-0">
            <p className={`text-sm font-medium leading-snug ${isDone || isCancelled ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-white"}`}>
              {task.title}
            </p>
            {task.description && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{task.description}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 ml-6 text-xs text-gray-400 dark:text-gray-500">
        {task.due_at && (
          <span className={overdue ? "text-red-600 dark:text-red-400 font-medium" : ""}>
            {overdue ? "⚠ Overdue · " : "Due "}
            {fmtDate(task.due_at)}
          </span>
        )}
        {task.completed_at && (
          <span className="text-green-600 dark:text-green-400">
            Completed {fmtDate(task.completed_at)}
          </span>
        )}
        <span>Created {fmtDate(task.created_at)}</span>
        <span>Updated {fmtDateTime(task.updated_at)}</span>
      </div>

      {/* Actions row */}
      {(nextStatuses.length > 0 || true) && (
        <div className="mt-3 ml-6 flex flex-wrap items-center gap-2">
          {/* Status transitions */}
          {nextStatuses.map((next) => (
            <button
              key={next}
              disabled={saving}
              onClick={() => patch({ status: next })}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                next === "cancelled"
                  ? "border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  : next === "completed"
                  ? "border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                  : next === "blocked"
                  ? "border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                  : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {saving ? <span className="inline-block h-2.5 w-2.5 rounded-full border-b-2 border-current animate-spin" /> : null}
              {next.replace(/_/g, " ")}
            </button>
          ))}

          {/* Priority quick-change */}
          {!editingPriority ? (
            <button
              onClick={() => setEditingPriority(true)}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-1"
            >
              ↕ priority
            </button>
          ) : (
            <div className="flex items-center gap-1">
              {VALID_PRIORITIES.map((p) => (
                <button
                  key={p}
                  disabled={saving}
                  onClick={() => { patch({ priority: p }); setEditingPriority(false) }}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    p === task.priority
                      ? "ring-2 ring-blue-400"
                      : ""
                  } ${PRIORITY_STYLES[p as TaskPriority]}`}
                >
                  {PRIORITY_ICONS[p as TaskPriority]} {p}
                </button>
              ))}
              <button
                onClick={() => setEditingPriority(false)}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 ml-1"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 ml-6 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

// ---------- create task form -------------------------------------------------

function CreateTaskForm({
  businessId,
  onCreated,
}: {
  businessId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<TaskPriority>("normal")
  const [dueAt, setDueAt] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/tasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            priority,
            due_at: dueAt || null,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Failed (${res.status})`); return }
      setOpen(false)
      setTitle("")
      setDescription("")
      setPriority("normal")
      setDueAt("")
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create")
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New task
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">New task</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. Reconcile bank statement for October"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Description <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Additional context…"
            className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {VALID_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_ICONS[p]} {p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Due date <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <span className="inline-block h-3.5 w-3.5 rounded-full border-b-2 border-white animate-spin" />}
            {saving ? "Creating…" : "Create task"}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setError("") }}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- filter bar -------------------------------------------------------

function FilterBar({
  statusFilter,
  priorityFilter,
  onStatus,
  onPriority,
}: {
  statusFilter: string
  priorityFilter: string
  onStatus: (v: string) => void
  onPriority: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Status:</span>
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
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Priority:</span>
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
    </div>
  )
}

// ---------- page -------------------------------------------------------------

export default function ClientTasksPage() {
  const params = useParams()
  const businessId = params.id as string

  const [tasks, setTasks] = useState<ClientTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError("")
    try {
      const qs = new URLSearchParams()
      if (statusFilter)   qs.set("status",   statusFilter)
      if (priorityFilter) qs.set("priority", priorityFilter)
      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/tasks${qs.toString() ? `?${qs}` : ""}`
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Failed (${res.status})`); return }
      setTasks(data.tasks ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [businessId, statusFilter, priorityFilter])

  useEffect(() => { load() }, [load])

  const open      = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
  const overdueCt = tasks.filter(isOverdue).length
  const done      = tasks.filter((t) => t.status === "completed").length

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Tasks</h2>
          {!loading && !error && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {open} open
              {overdueCt > 0 && <span className="ml-1 text-red-600 dark:text-red-400">· {overdueCt} overdue</span>}
              {done > 0 && <span> · {done} completed</span>}
            </p>
          )}
        </div>
        <CreateTaskForm businessId={businessId} onCreated={load} />
      </div>

      {/* Filters */}
      <div className="mb-5 overflow-x-auto pb-1">
        <FilterBar
          statusFilter={statusFilter}
          priorityFilter={priorityFilter}
          onStatus={setStatusFilter}
          onPriority={setPriorityFilter}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
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
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {statusFilter || priorityFilter ? "No matching tasks" : "No tasks yet"}
          </p>
          {!statusFilter && !priorityFilter && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Create a task to start tracking work for this client.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              businessId={businessId}
              onUpdated={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}
