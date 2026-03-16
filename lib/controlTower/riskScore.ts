/**
 * Control Tower — Risk score engine (UI only).
 * Scores clients by work item severity for prioritization.
 * critical = 5 pts, high = 3 pts, medium = 1 pt.
 */

import type { ControlTowerWorkItem, WorkItemSeverity } from "./types"

const SEVERITY_POINTS: Record<WorkItemSeverity, number> = {
  blocker: 5,
  critical: 5,
  high: 3,
  medium: 1,
  low: 1,
}

export function scoreWorkItem(item: ControlTowerWorkItem): number {
  return SEVERITY_POINTS[item.severity] ?? 0
}

export function scoreClient(items: ControlTowerWorkItem[]): number {
  return items.reduce((sum, item) => sum + scoreWorkItem(item), 0)
}

export function getRiskLabel(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 10) return "critical"
  if (score >= 5) return "high"
  if (score >= 1) return "medium"
  return "low"
}
