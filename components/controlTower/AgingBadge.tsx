"use client"

/**
 * Aging indicator: < 3 days green, 3–7 orange, 7+ red.
 */
export default function AgingBadge({ days }: { days: number }) {
  const bucket = days < 3 ? "green" : days <= 7 ? "orange" : "red"
  const classes = {
    green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
    orange: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
    red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  }
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${classes[bucket]}`}>
      {days}d
    </span>
  )
}
