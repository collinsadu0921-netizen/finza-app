"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import { statusGroupLabel, urgencyLabel } from "@/lib/practice/work/normalize"
import type {
  PracticeWorkDueState,
  PracticeWorkItem,
  PracticeWorkStaffMember,
  PracticeWorkStatusGroup,
  PracticeWorkView,
} from "@/lib/practice/work/types"

const VIEWS: { id: PracticeWorkView; label: string }[] = [
  { id: "my", label: "My work" },
  { id: "unassigned", label: "Unassigned" },
  { id: "all", label: "All work" },
]

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All types" },
  { value: "task", label: "Task" },
  { value: "request", label: "Request" },
  { value: "filing", label: "Filing" },
  { value: "journal_approval", label: "Journal approval" },
  { value: "journal_post", label: "Journal post" },
  { value: "ob_approval", label: "Opening balance review" },
  { value: "ob_post", label: "Opening balance post" },
  { value: "engagement_pending", label: "Engagement pending" },
  { value: "engagement_suspended", label: "Engagement suspended" },
  { value: "engagement_terminated", label: "Engagement terminated" },
  { value: "engagement_not_effective", label: "Engagement not effective" },
]

const STATUS_OPTIONS: { value: PracticeWorkStatusGroup | ""; label: string }[] = [
  { value: "", label: "Active" },
  { value: "needs_action", label: "Needs action" },
  { value: "waiting", label: "Waiting" },
  { value: "done", label: "Done" },
]

const DUE_OPTIONS: { value: PracticeWorkDueState | ""; label: string }[] = [
  { value: "", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "soon", label: "Next 7 days" },
  { value: "none", label: "No due date" },
]

function formatDue(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function statusChipClass(item: PracticeWorkItem): string {
  if (item.status_group === "waiting") {
    return "bg-amber-50 text-amber-800 border-amber-200"
  }
  if (item.status_group === "done") {
    return "bg-gray-100 text-gray-600 border-gray-200"
  }
  return "bg-blue-50 text-blue-800 border-blue-200"
}

function urgencyClass(item: PracticeWorkItem): string {
  if (item.urgency === "overdue") return "text-red-700 font-medium"
  if (item.urgency === "today") return "text-amber-700 font-medium"
  return "text-gray-500"
}

function sourceStatusLabel(status: string): string {
  return status.replace(/_/g, " ")
}

export default function PracticeWorkPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [items, setItems] = useState<PracticeWorkItem[]>([])
  const [staff, setStaff] = useState<PracticeWorkStaffMember[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [counts, setCounts] = useState({ all: 0, my: 0, unassigned: 0, waiting: 0, needs_action: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)

  const viewParam = searchParams.get("view")
  const clientId = searchParams.get("client") ?? ""
  const type = searchParams.get("type") ?? ""
  const statusGroup = searchParams.get("status") ?? ""
  const assignee = searchParams.get("assignee") ?? ""
  const due = searchParams.get("due") ?? ""
  const q = searchParams.get("q") ?? ""

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString())
      if (value) next.set(key, value)
      else next.delete(key)
      const qs = next.toString()
      router.replace(qs ? `/accounting/work?${qs}` : "/accounting/work", { scroll: false })
    },
    [router, searchParams]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const firmId = getActiveFirmId()
      const params = new URLSearchParams()
      if (firmId) params.set("firm_id", firmId)
      if (viewParam === "my" || viewParam === "unassigned" || viewParam === "all") {
        params.set("view", viewParam)
      }
      if (clientId) params.set("client", clientId)
      if (type) params.set("type", type)
      if (statusGroup === "needs_action" || statusGroup === "waiting" || statusGroup === "done") {
        params.set("status_group", statusGroup)
      }
      if (statusGroup === "done") params.set("include_done", "1")
      if (assignee) params.set("assignee", assignee)
      if (due) params.set("due", due)
      if (q) params.set("q", q)

      const res = await fetch(`/api/accounting/work?${params.toString()}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load work (${res.status})`)
        setItems([])
        return
      }
      setItems(data.items ?? [])
      setStaff(data.staff ?? [])
      setClients(data.clients ?? [])
      setCounts(data.counts ?? { all: 0, my: 0, unassigned: 0, waiting: 0, needs_action: 0 })
      if (typeof data.role === "string") setRole(data.role)

      // Sync role-aware default into the URL when view was omitted.
      if (
        viewParam == null &&
        (data.view === "my" || data.view === "unassigned" || data.view === "all")
      ) {
        const next = new URLSearchParams(searchParams.toString())
        next.set("view", data.view)
        router.replace(`/accounting/work?${next.toString()}`, { scroll: false })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [viewParam, clientId, type, statusGroup, assignee, due, q, router, searchParams])

  useEffect(() => {
    load()
  }, [load])

  const view: PracticeWorkView =
    viewParam === "my" || viewParam === "unassigned" || viewParam === "all"
      ? viewParam
      : role && role !== "partner"
        ? "my"
        : "all"

  const hasActiveFilters = Boolean(clientId || type || statusGroup || assignee || due || q)
  const emptyMessage =
    view === "my" && !hasActiveFilters
      ? "No items are assigned directly to you. Requests, filings, and some reviews may not have an individual assignee — check All work for those."
      : hasActiveFilters
        ? "No work matches these filters."
        : "No work needs your attention."

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Work</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Across all clients, what needs attention today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>{counts.needs_action} need action</span>
          <span>{counts.waiting} waiting</span>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {VIEWS.map((option) => {
          const count =
            option.id === "my" ? counts.my : option.id === "unassigned" ? counts.unassigned : counts.all
          const active = view === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setParam("view", option.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {option.label}
              <span className={`ml-1.5 tabular-nums ${active ? "text-gray-300" : "text-gray-400"}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {view === "my" && !hasActiveFilters ? (
        <p className="text-xs text-gray-500">
          My work shows items assigned directly to you. Other work for your clients is available under
          All work.
        </p>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={q}
            onChange={(e) => setParam("q", e.target.value)}
            placeholder="Search client or work title"
            className="h-9 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:max-w-sm"
          />
          <button
            type="button"
            className="text-sm text-gray-600 hover:text-gray-900 sm:hidden"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filtersOpen ? "Hide filters" : "Filters"}
          </button>
        </div>

        <div className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-3 border-b border-gray-100 p-3 sm:grid sm:grid-cols-2 lg:grid-cols-5`}>
          <FilterSelect
            label="Client"
            value={clientId}
            onChange={(value) => setParam("client", value)}
            options={[{ value: "", label: "All clients" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <FilterSelect label="Type" value={type} onChange={(value) => setParam("type", value)} options={TYPE_OPTIONS} />
          <FilterSelect
            label="Status"
            value={statusGroup}
            onChange={(value) => setParam("status", value)}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            label="Assignee"
            value={assignee}
            onChange={(value) => setParam("assignee", value)}
            options={[
              { value: "", label: "Anyone" },
              { value: "unassigned", label: "Unassigned" },
              ...staff.map((member) => ({ value: member.user_id, label: member.name })),
            ]}
          />
          <FilterSelect label="Due" value={due} onChange={(value) => setParam("due", value)} options={DUE_OPTIONS} />
        </div>

        {error && (
          <div className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-blue-600" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="text-sm font-medium text-gray-900">{emptyMessage}</p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={() => router.replace("/accounting/work")}
                className="mt-3 text-sm text-blue-700 hover:underline"
              >
                Clear filters
              </button>
            ) : (
              <Link href="/accounting/clients" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
                Open clients
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 font-medium">Work</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Owner</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/80">
                      <td className="px-3 py-2 align-top">
                        <Link
                          href={`/accounting/clients/${item.business_id}/overview`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {item.business_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Link href={item.action_url} className="text-gray-900 hover:underline">
                          {item.title}
                        </Link>
                        <div className="mt-0.5 text-xs text-gray-400">{item.type}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusChipClass(item)}`}>
                          {statusGroupLabel(item.status_group)}
                        </span>
                        <div className="mt-0.5 text-xs capitalize text-gray-400">
                          {sourceStatusLabel(item.source_status)}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-gray-600">
                        {item.assigned_user_name ?? "Unassigned"}
                      </td>
                      <td className={`px-3 py-2 align-top ${urgencyClass(item)}`}>
                        <div>{item.due_at ? formatDue(item.due_at) : "—"}</div>
                        <div className="text-xs">{urgencyLabel(item.urgency)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-gray-100 md:hidden">
              {items.map((item) => (
                <li key={item.id} className="px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/accounting/clients/${item.business_id}/overview`}
                        className="text-sm font-semibold text-gray-900 hover:underline"
                      >
                        {item.business_name}
                      </Link>
                      <Link href={item.action_url} className="mt-0.5 block text-sm text-gray-800 hover:underline">
                        {item.title}
                      </Link>
                      <p className="mt-1 text-xs text-gray-400">{item.type}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${statusChipClass(item)}`}>
                      {statusGroupLabel(item.status_group)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span className={urgencyClass(item)}>
                      {item.due_at ? formatDue(item.due_at) : "—"} · {urgencyLabel(item.urgency)}
                    </span>
                    <span>{item.assigned_user_name ?? "Unassigned"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((option) => (
          <option key={option.value || label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
