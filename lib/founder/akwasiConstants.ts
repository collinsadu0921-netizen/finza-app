export const FOUNDER_TASK_AREAS = [
  "product",
  "sales",
  "partnership",
  "website",
  "payments",
  "e_vat",
  "support",
  "strategy",
  "technical",
  "finance",
  "operations",
] as const

export type FounderTaskArea = (typeof FOUNDER_TASK_AREAS)[number]

export const FOUNDER_TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const
export type FounderTaskPriority = (typeof FOUNDER_TASK_PRIORITIES)[number]

export const FOUNDER_TASK_STATUSES = [
  "not_started",
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "cancelled",
] as const
export type FounderTaskStatus = (typeof FOUNDER_TASK_STATUSES)[number]

export const FOUNDER_EXTRACT_TASK_STATUSES = ["not_started", "in_progress", "waiting", "blocked"] as const
export type FounderExtractTaskStatus = (typeof FOUNDER_EXTRACT_TASK_STATUSES)[number]

export function isFounderTaskArea(v: unknown): v is FounderTaskArea {
  return typeof v === "string" && (FOUNDER_TASK_AREAS as readonly string[]).includes(v)
}

export function isFounderTaskPriority(v: unknown): v is FounderTaskPriority {
  return typeof v === "string" && (FOUNDER_TASK_PRIORITIES as readonly string[]).includes(v)
}

export function isFounderTaskStatus(v: unknown): v is FounderTaskStatus {
  return typeof v === "string" && (FOUNDER_TASK_STATUSES as readonly string[]).includes(v)
}

export function isFounderExtractTaskStatus(v: unknown): v is FounderExtractTaskStatus {
  return typeof v === "string" && (FOUNDER_EXTRACT_TASK_STATUSES as readonly string[]).includes(v)
}
