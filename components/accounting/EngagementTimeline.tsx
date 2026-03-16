"use client"

/**
 * Engagement timeline: Created, Accepted, Suspended, Reactivated, Terminated, Access changes.
 * Uses activity logs if provided; otherwise derives from engagement timestamps.
 */

export type EngagementTimelineEngagement = {
  status: string
  effective_from: string
  effective_to?: string | null
  accepted_at?: string | null
  created_at?: string | null
}

export type ActivityLogEntry = {
  id: string
  action_type: string
  created_at: string
  metadata?: Record<string, unknown> | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const ACTION_LABELS: Record<string, string> = {
  engagement_created: "Created",
  engagement_accepted: "Accepted",
  engagement_suspended: "Suspended",
  engagement_activated: "Reactivated",
  engagement_resumed: "Reactivated",
  engagement_terminated: "Terminated",
  engagement_access_level_changed: "Access changed",
}

export interface EngagementTimelineProps {
  engagement: EngagementTimelineEngagement
  activityLogs?: ActivityLogEntry[] | null
}

export default function EngagementTimeline({ engagement, activityLogs }: EngagementTimelineProps) {
  const items: { label: string; date: string | null }[] = []

  if (activityLogs && activityLogs.length > 0) {
    const sorted = [...activityLogs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    for (const log of sorted) {
      const label = ACTION_LABELS[log.action_type] ?? log.action_type.replace(/_/g, " ")
      items.push({ label, date: log.created_at })
    }
  }

  if (items.length === 0) {
    items.push({
      label: "Engagement created",
      date: engagement.effective_from || engagement.created_at || null,
    })
    if (engagement.accepted_at) {
      items.push({ label: "Accepted", date: engagement.accepted_at })
    }
    const status = (engagement.status ?? "").toLowerCase()
    if (status === "suspended") {
      items.push({ label: "Suspended", date: null })
    }
    if (status === "terminated") {
      items.push({ label: "Terminated", date: engagement.effective_to ?? null })
    }
  }

  if (items.length === 0) return null

  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Engagement timeline
      </h4>
      <div className="relative pl-5 space-y-0">
        <div
          className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-600"
          aria-hidden
        />
        {items.map((item, idx) => (
          <div key={`${item.label}-${idx}-${item.date}`} className="relative flex gap-3 pb-3 last:pb-0">
            <span
              className="absolute left-0 w-3 h-3 rounded-full border-2 border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 shrink-0 mt-0.5"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</p>
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
