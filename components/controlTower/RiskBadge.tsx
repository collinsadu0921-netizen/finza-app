"use client"

import { getRiskLabel } from "@/lib/controlTower/riskScore"

const LABEL_CLASSES: Record<string, string> = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
}

export default function RiskBadge({ score }: { score: number }) {
  const label = getRiskLabel(score)
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${LABEL_CLASSES[label] ?? LABEL_CLASSES.low}`}>
      Risk {score}
    </span>
  )
}
