"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import type { PlatformAnnouncementRow } from "@/lib/platform/announcementsTypes"
import { isWorkspaceDashboardPath } from "@/lib/platform/announcementAudience"

const SESSION_MODAL_KEY = "platform_announcement_modal_session_ok"

function readSessionModalOk(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = sessionStorage.getItem(SESSION_MODAL_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function writeSessionModalOk(ids: Set<string>) {
  try {
    sessionStorage.setItem(SESSION_MODAL_KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

function severityBannerClass(severity: PlatformAnnouncementRow["severity"]): string {
  switch (severity) {
    case "success":
      return "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50"
    case "warning":
      return "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
    case "critical":
      return "border-red-600 bg-red-50 text-red-950 dark:bg-red-950/50 dark:text-red-50"
    case "info":
    default:
      return "border-sky-600 bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-50"
  }
}

type Props = {
  /** Current business industry (e.g. service, retail) for "core" route audience matching */
  businessIndustry: string | null | undefined
  children?: ReactNode
}

export default function PlatformAnnouncementsHost({ businessIndustry, children }: Props) {
  const pathname = usePathname() || "/"
  const [rows, setRows] = useState<PlatformAnnouncementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sessionModalOk, setSessionModalOk] = useState<Set<string>>(() => readSessionModalOk())

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const qs = new URLSearchParams({
        pathname,
        businessIndustry: businessIndustry || "",
      })
      const res = await fetch(`/api/platform/announcements/active?${qs.toString()}`, {
        credentials: "same-origin",
      })
      if (!res.ok) {
        setRows([])
        return
      }
      const json = (await res.json()) as { announcements?: PlatformAnnouncementRow[] }
      setRows(json.announcements ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [pathname, businessIndustry])

  useEffect(() => {
    void load()
  }, [load])

  const byPlacement = useMemo(() => {
    const banner = rows.filter((r) => r.placement === "global_banner")
    const modal = rows.filter((r) => r.placement === "modal")
    const card = rows.filter((r) => r.placement === "dashboard_card")
    return { banner, modal, card }
  }, [rows])

  const dashboardPath = isWorkspaceDashboardPath(pathname)
  const cardsToShow = dashboardPath ? byPlacement.card : []

  const modalsPending = useMemo(() => {
    const ordered = [...byPlacement.modal].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))
    )
    return ordered.filter((r) => {
      if (r.dismissible) return true
      return !sessionModalOk.has(r.id)
    })
  }, [byPlacement.modal, sessionModalOk])

  const activeModal = modalsPending[0] ?? null

  const dismissRemote = async (id: string) => {
    const res = await fetch(`/api/platform/announcements/${id}/dismiss`, {
      method: "POST",
      credentials: "same-origin",
    })
    if (!res.ok) return
    await load()
  }

  const acknowledgeModalSessionOnly = (id: string) => {
    const next = new Set(sessionModalOk)
    next.add(id)
    setSessionModalOk(next)
    writeSessionModalOk(next)
  }

  if (loading && rows.length === 0) {
    return <>{children}</>
  }

  return (
    <>
      {byPlacement.banner.length > 0 && (
        <div className="sticky top-0 z-[45] w-full border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
          <div className="mx-auto max-w-5xl space-y-2 px-3 py-2 sm:px-4">
            {byPlacement.banner.map((a) => (
              <div
                key={a.id}
                className={`flex gap-3 rounded-md border-l-4 px-3 py-2 text-sm ${severityBannerClass(a.severity)}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{a.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug opacity-95">{a.body}</p>
                </div>
                {a.dismissible && (
                  <button
                    type="button"
                    className="shrink-0 self-start rounded border border-current/20 px-2 py-0.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => void dismissRemote(a.id)}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {dashboardPath && cardsToShow.length > 0 && (
        <div className="mx-auto mb-4 max-w-5xl space-y-3 px-3 pt-4 sm:px-4 lg:px-6">
          {cardsToShow.map((a) => (
            <div
              key={a.id}
              className={`rounded-lg border border-gray-200 p-4 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-900/60 ${severityBannerClass(a.severity)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold">{a.title}</p>
                {a.dismissible && (
                  <button
                    type="button"
                    className="rounded border border-current/20 px-2 py-0.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => void dismissRemote(a.id)}
                  >
                    Dismiss
                  </button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-snug opacity-95">{a.body}</p>
            </div>
          ))}
        </div>
      )}

      {children}

      {activeModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className={`max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900 ${severityBannerClass(activeModal.severity)}`}
          >
            <h2 className="text-lg font-semibold">{activeModal.title}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed opacity-95">{activeModal.body}</p>
            <div className="mt-5 flex justify-end gap-2">
              {activeModal.dismissible ? (
                <button
                  type="button"
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                  onClick={() => void dismissRemote(activeModal.id)}
                >
                  Dismiss
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                  onClick={() => acknowledgeModalSessionOnly(activeModal.id)}
                >
                  Continue
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
