"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import type { PracticeDashboard } from "@/lib/practice/dashboard/types"
import { statusGroupLabel, urgencyLabel } from "@/lib/practice/work/normalize"
import type { PracticeWorkItem } from "@/lib/practice/work/types"

function workHref(params: Record<string, string | undefined> = {}): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value)
  }
  const next = qs.toString()
  return next ? `/accounting/work?${next}` : "/accounting/work"
}

function formatDue(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function formatCreated(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function Stat({
  label,
  value,
  href,
  tone = "neutral",
}: {
  label: string
  value: number
  href?: string
  tone?: "neutral" | "red" | "amber" | "blue"
}) {
  const toneClass =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "blue"
          ? "text-blue-600"
          : "text-gray-900"
  const inner = (
    <>
      <div className={`text-2xl font-semibold tabular-nums leading-tight ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-gray-500">{label}</div>
    </>
  )
  return (
    <div className="min-w-0 rounded-xl border border-gray-200 bg-white px-4 py-3">
      {href ? (
        <Link href={href} className="block hover:underline">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  )
}

function Panel({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-gray-500">{text}</p>
}

function WorkRow({ item }: { item: PracticeWorkItem }) {
  return (
    <li>
      <Link
        href={item.action_url}
        className="flex flex-col gap-2 px-4 py-3 hover:bg-gray-50 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{item.business_name}</p>
          <p className="mt-0.5 text-sm text-gray-700">{item.title}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {item.type}
            {item.assigned_user_name ? ` · ${item.assigned_user_name}` : item.assignment_supported ? " · Unassigned" : " · No owner"}
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <span className="inline-flex rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600">
            {statusGroupLabel(item.status_group)}
          </span>
          <p
            className={`mt-1 text-xs ${
              item.urgency === "overdue" ? "font-medium text-red-700" : "text-gray-500"
            }`}
          >
            {item.due_at ? formatDue(item.due_at) : "—"} · {urgencyLabel(item.urgency)}
          </p>
        </div>
      </Link>
    </li>
  )
}

export default function PracticeDashboardPage() {
  const [data, setData] = useState<PracticeDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const firmId = getActiveFirmId()
      const qs = firmId ? `?firm_id=${encodeURIComponent(firmId)}` : ""
      const res = await fetch(`/api/accounting/dashboard${qs}`, { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Failed to load dashboard")
      }
      setData(body as PracticeDashboard)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : "Failed to load dashboard")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onFirm = () => {
      void load()
    }
    window.addEventListener("firmChanged", onFirm)
    return () => window.removeEventListener("firmChanged", onFirm)
  }, [load])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error || "Dashboard unavailable."}
        </div>
      </div>
    )
  }

  const partner = data.show.team
  const summary = data.summary

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Practice</h1>
          {data.firm_name ? (
            <p className="mt-0.5 text-sm font-medium text-gray-700">{data.firm_name}</p>
          ) : null}
          <p className="mt-1 text-sm text-gray-500">
            {partner
              ? "How the firm is doing today, and where attention needs to go."
              : "Your assigned clients and work that needs attention."}
          </p>
        </div>
        <Link
          href={workHref({ view: "all" })}
          className="inline-flex rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          View all work
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={partner ? "Clients" : "My clients"}
          value={summary.clients}
          href="/accounting/clients"
          tone="blue"
        />
        <Stat label="Open work" value={summary.open_work} href="/accounting/work" tone={summary.open_work ? "amber" : "neutral"} />
        <Stat
          label="Overdue"
          value={summary.overdue}
          href={workHref({ due: "overdue" })}
          tone={summary.overdue ? "red" : "neutral"}
        />
        <Stat
          label="Waiting on client"
          value={summary.waiting_on_client}
          href={workHref({ status: "waiting" })}
          tone={summary.waiting_on_client ? "amber" : "neutral"}
        />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label="Due today" value={summary.due_today} href={workHref({ due: "today" })} />
        {partner ? (
          <Stat
            label="Unassigned"
            value={summary.unassigned}
            href={workHref({ view: "unassigned" })}
          />
        ) : (
          <Stat label="My work" value={summary.my_work} href={workHref({ view: "my" })} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {data.show.team && (
          <Panel title="Team workload">
            {data.team.length === 0 ? (
              <Empty text="No firm staff to show." />
            ) : (
              <>
                <div className="hidden md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                        <th className="px-4 py-2 font-medium">Staff</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 text-right font-medium">Clients</th>
                        <th className="px-3 py-2 text-right font-medium">Open</th>
                        <th className="px-3 py-2 text-right font-medium">Overdue</th>
                        <th className="px-3 py-2 text-right font-medium">Due soon</th>
                        <th className="px-4 py-2 text-right font-medium">Waiting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.team.map((row) => (
                        <tr key={row.user_id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2 font-medium text-gray-900">{row.name}</td>
                          <td className="px-3 py-2 text-gray-500">{roleLabel(row.role)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.assigned_clients}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.open_work}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "font-medium text-red-700" : "text-gray-700"}`}>
                            {row.overdue}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.due_soon}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.waiting}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50/80">
                        <td className="px-4 py-2 font-medium text-gray-900" colSpan={2}>
                          Unassigned
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-400">—</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{data.unassigned.open_work}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${data.unassigned.overdue ? "font-medium text-red-700" : "text-gray-700"}`}>
                          {data.unassigned.overdue}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-400">—</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-400">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-gray-100 md:hidden">
                  {data.team.map((row) => (
                    <li key={row.user_id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{row.name}</p>
                          <p className="text-xs text-gray-400">{roleLabel(row.role)}</p>
                        </div>
                        <p className="text-xs text-gray-500">{row.assigned_clients} clients</p>
                      </div>
                      <p className="mt-2 text-xs text-gray-600">
                        {row.open_work} open · {row.overdue} overdue · {row.due_soon} due soon · {row.waiting} waiting
                      </p>
                    </li>
                  ))}
                  <li className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">Unassigned</p>
                    <p className="mt-1 text-xs text-gray-600">
                      {data.unassigned.open_work} open · {data.unassigned.overdue} overdue
                    </p>
                  </li>
                </ul>
              </>
            )}
          </Panel>
        )}

        <Panel
          title="Needs attention"
          action={
            <Link href={workHref({ view: "all" })} className="text-xs text-blue-600 hover:underline">
              View all work
            </Link>
          }
        >
          {data.needs_attention.length === 0 ? (
            <Empty text="Nothing needs attention." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.needs_attention.map((item) => (
                <WorkRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </Panel>

        {partner && (
          <Panel
            title="Clients at risk"
            action={
              <Link href="/accounting/clients" className="text-xs text-blue-600 hover:underline">
                All clients
              </Link>
            }
          >
            {data.clients_at_risk.length === 0 ? (
              <Empty text="No clients with active work." />
            ) : (
              <>
                <div className="hidden md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                        <th className="px-4 py-2 font-medium">Client</th>
                        <th className="px-3 py-2 text-right font-medium">Overdue</th>
                        <th className="px-3 py-2 text-right font-medium">Due today</th>
                        <th className="px-3 py-2 text-right font-medium">Due soon</th>
                        <th className="px-3 py-2 text-right font-medium">Waiting</th>
                        <th className="px-4 py-2 text-right font-medium">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.clients_at_risk.map((row) => (
                        <tr key={row.business_id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2">
                            <Link
                              href={`/accounting/clients/${row.business_id}/overview`}
                              className="font-medium text-gray-900 hover:underline"
                            >
                              {row.business_name}
                            </Link>
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "font-medium text-red-700" : "text-gray-700"}`}>
                            {row.overdue}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.due_today}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.due_soon}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.waiting_on_client}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.open_work}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-gray-100 md:hidden">
                  {data.clients_at_risk.map((row) => (
                    <li key={row.business_id} className="px-4 py-3">
                      <Link
                        href={`/accounting/clients/${row.business_id}/overview`}
                        className="text-sm font-medium text-gray-900 hover:underline"
                      >
                        {row.business_name}
                      </Link>
                      <p className="mt-1 text-xs text-gray-600">
                        {row.overdue} overdue · {row.due_today} today · {row.waiting_on_client} waiting · {row.open_work} open
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        )}

        <Panel
          title="Waiting on client"
          action={
            <Link href={workHref({ status: "waiting" })} className="text-xs text-blue-600 hover:underline">
              View waiting
            </Link>
          }
        >
          {data.waiting_on_client.items.length === 0 ? (
            <Empty text="No work is waiting on a client." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.waiting_on_client.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.action_url}
                    className="block px-4 py-3 hover:bg-gray-50"
                  >
                    <p className="text-sm font-medium text-gray-900">{item.business_name}</p>
                    <p className="mt-0.5 text-sm text-gray-700">{item.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Created {formatCreated(item.created_at)}
                      {item.due_at ? ` · Due ${formatDue(item.due_at)}` : ""}
                      {" · "}
                      waiting on client
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
            Waiting duration is not tracked yet — showing created and due dates only. When the client
            responds outside Finza, open the request and set status to In progress.
          </p>
        </Panel>

        {data.show.review && (
          <Panel
            title="Needs review"
            action={
              <Link href={workHref({ status: "needs_action" })} className="text-xs text-blue-600 hover:underline">
                Open review work
              </Link>
            }
          >
            {data.review.count === 0 ? (
              <Empty text="No journals or opening balances awaiting review." />
            ) : (
              <>
                <p className="px-4 pt-3 text-sm text-gray-600">
                  {data.review.count} item{data.review.count === 1 ? "" : "s"} awaiting review
                </p>
                <ul className="divide-y divide-gray-100">
                  {data.review.items.map((item) => (
                    <WorkRow key={item.id} item={item} />
                  ))}
                </ul>
              </>
            )}
          </Panel>
        )}

        {data.show.unassigned && (
          <Panel
            title="Unassigned work"
            action={
              <Link href={workHref({ view: "unassigned" })} className="text-xs text-blue-600 hover:underline">
                View unassigned
              </Link>
            }
          >
            {data.unassigned.open_work === 0 ? (
              <Empty text="All assignable work has an owner." />
            ) : (
              <>
                <p className="px-4 pt-3 text-xs text-gray-500">
                  {data.unassigned.assignable} task{data.unassigned.assignable === 1 ? "" : "s"} can be assigned.
                  {data.unassigned.without_owner > 0
                    ? ` ${data.unassigned.without_owner} other item${data.unassigned.without_owner === 1 ? "" : "s"} have no owner because the source does not support assignment.`
                    : ""}
                </p>
                <ul className="divide-y divide-gray-100">
                  {data.unassigned.items.map((item) => (
                    <WorkRow key={item.id} item={item} />
                  ))}
                </ul>
              </>
            )}
          </Panel>
        )}

        {data.show.coverage && (
          <Panel
            title="Client coverage"
            action={
              <Link href="/accounting/clients" className="text-xs text-blue-600 hover:underline">
                Review client assignments
              </Link>
            }
          >
            {data.coverage.enforcement_active ? (
              <div className="grid grid-cols-3 gap-3 px-4 py-4 text-center">
                <div>
                  <p className="text-xl font-semibold tabular-nums text-gray-900">{data.coverage.effective_clients}</p>
                  <p className="mt-1 text-xs text-gray-500">Effective clients</p>
                </div>
                <div>
                  <p className="text-xl font-semibold tabular-nums text-gray-900">{data.coverage.with_staff}</p>
                  <p className="mt-1 text-xs text-gray-500">Have assigned staff</p>
                </div>
                <div>
                  <p className="text-xl font-semibold tabular-nums text-gray-900">{data.coverage.without_staff}</p>
                  <p className="mt-1 text-xs text-gray-500">No staff assignment</p>
                </div>
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-gray-600">
                <p>Client assignment controls are not enabled.</p>
                <Link href="/accounting/clients" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
                  Review client assignments
                </Link>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
