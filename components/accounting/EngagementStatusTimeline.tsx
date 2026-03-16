"use client"

/**
 * Lifecycle timeline: pending → accepted → active → suspended → terminated.
 * Highlights current status.
 */

const STAGES = [
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
  { key: "terminated", label: "Terminated" },
] as const

export type EngagementStatusForTimeline = (typeof STAGES)[number]["key"]

export interface EngagementStatusTimelineProps {
  currentStatus: string
}

export default function EngagementStatusTimeline({ currentStatus }: EngagementStatusTimelineProps) {
  const current = (currentStatus || "").toLowerCase()
  const currentIndex = STAGES.findIndex((s) => s.key === current)

  return (
    <div className="flex items-center justify-between gap-0">
      {STAGES.map((stage, i) => {
        const isActive = stage.key === current
        const isPast = currentIndex >= 0 && i < currentIndex
        const isFuture = currentIndex >= 0 && i > currentIndex
        const isLast = i === STAGES.length - 1

        return (
          <div key={stage.key} className="flex flex-1 items-center">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                  isActive
                    ? "bg-blue-600 border-blue-600 text-white"
                    : isPast
                      ? "bg-green-500 border-green-500 text-white"
                      : "bg-gray-200 dark:bg-gray-600 border-gray-300 dark:border-gray-500 text-gray-500 dark:text-gray-400"
                }`}
              >
                {isPast ? "✓" : i + 1}
              </div>
              <span
                className={`mt-1.5 text-xs font-medium ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : isPast
                      ? "text-green-600 dark:text-green-400"
                      : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {stage.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`flex-1 h-0.5 mx-0.5 ${
                  isPast ? "bg-green-500" : "bg-gray-200 dark:bg-gray-600"
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
