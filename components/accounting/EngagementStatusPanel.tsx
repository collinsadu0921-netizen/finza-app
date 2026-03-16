"use client"

/**
 * Engagement status for the current client context.
 * Shows authority source, engagement state, access level, effective window.
 * States: ACTIVE (green), PENDING (orange), SUSPENDED (red), TERMINATED (gray), NOT_EFFECTIVE (amber), NO_ENGAGEMENT (red).
 */

type EngagementState =
  | "ACTIVE"
  | "PENDING"
  | "SUSPENDED"
  | "TERMINATED"
  | "NOT_EFFECTIVE"
  | "NO_ENGAGEMENT"

function deriveState(status: string | null | undefined): EngagementState {
  if (!status) return "NO_ENGAGEMENT"
  const s = String(status).toLowerCase()
  if (s === "active" || s === "accepted") return "ACTIVE"
  if (s === "pending") return "PENDING"
  if (s === "suspended") return "SUSPENDED"
  if (s === "terminated") return "TERMINATED"
  if (s === "not_effective") return "NOT_EFFECTIVE"
  return "PENDING"
}

const STATE_STYLES: Record<
  EngagementState,
  { label: string; className: string }
> = {
  ACTIVE: { label: "Active", className: "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20" },
  PENDING: { label: "Pending", className: "text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20" },
  SUSPENDED: { label: "Suspended", className: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20" },
  TERMINATED: { label: "Terminated", className: "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800" },
  NOT_EFFECTIVE: { label: "Not effective", className: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20" },
  NO_ENGAGEMENT: { label: "No engagement", className: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20" },
}

export interface EngagementStatusPanelProps {
  authoritySource: "owner" | "employee" | "accountant" | null
  engagementState?: EngagementState | null
  engagementStatus?: string | null
  accessLevel?: string | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
}

export default function EngagementStatusPanel({
  authoritySource,
  engagementState: evaluatorState,
  engagementStatus,
  accessLevel,
  effectiveFrom,
  effectiveTo,
}: EngagementStatusPanelProps) {
  const derived =
    authoritySource === "owner" || authoritySource === "employee"
      ? "ACTIVE"
      : evaluatorState ?? deriveState(engagementStatus)
  const state = derived as EngagementState
  const style = STATE_STYLES[state]
  const displayLabel = (authoritySource === "owner" || authoritySource === "employee") && !engagementStatus
    ? "Full access"
    : style.label

  const authLabel =
    authoritySource === "accountant"
      ? "Accountant"
      : authoritySource === "owner"
        ? "Owner"
        : authoritySource === "employee"
          ? "Employee"
          : "—"

  return (
    <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Engagement status
      </h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-600 dark:text-gray-400">Authority: {authLabel}</span>
        <span
          className={`inline-flex px-2 py-0.5 rounded font-medium ${style.className}`}
        >
          {displayLabel}
        </span>
        {accessLevel && (
          <span className="text-gray-600 dark:text-gray-400">
            Access: {accessLevel}
          </span>
        )}
        {effectiveFrom && (
          <span className="text-gray-500 dark:text-gray-500">
            From {effectiveFrom}
            {effectiveTo ? ` → ${effectiveTo}` : " (ongoing)"}
          </span>
        )}
      </div>
    </section>
  )
}
