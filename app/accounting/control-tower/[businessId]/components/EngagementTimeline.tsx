"use client"

/**
 * Engagement history timeline from row fields: effective_from, effective_to, accepted_at, status.
 * UI only; no API changes.
 */

export type EngagementTimelineEngagement = {
  status: string
  effective_from: string
  effective_to?: string | null
  accepted_at?: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export interface EngagementTimelineProps {
  engagement: EngagementTimelineEngagement
}

export default function EngagementTimeline({ engagement }: EngagementTimelineProps) {
  const status = (engagement.status ?? "").toLowerCase()
  const showAccepted = engagement.accepted_at != null && engagement.accepted_at !== ""
  const showSuspended = status === "suspended"
  const showTerminated = status === "terminated"

  const items: { label: string; date: string | null; active: boolean }[] = []

  items.push({
    label: "Engagement Created",
    date: engagement.effective_from || null,
    active: true,
  })

  if (showAccepted) {
    items.push({
      label: "Accepted",
      date: engagement.accepted_at ?? null,
      active: true,
    })
  }

  if (showSuspended) {
    items.push({
      label: "Suspended",
      date: null,
      active: true,
    })
  }

  if (showTerminated) {
    items.push({
      label: "Terminated",
      date: engagement.effective_to ?? null,
      active: true,
    })
  }

  if (items.length === 0) return null

  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-3">
        Engagement timeline
      </h4>
      <div className="relative pl-5 space-y-0">
        {/* vertical line */}
        <div
          className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-600"
          aria-hidden
        />
        {items.map((item, idx) => (
          <div key={`${item.label}-${idx}`} className="relative flex gap-3 pb-3 last:pb-0">
            <span
              className="absolute left-0 w-3 h-3 rounded-full border-2 border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 shrink-0 mt-0.5"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.label}
              </p>
              {item.date && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {formatDate(item.date)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
