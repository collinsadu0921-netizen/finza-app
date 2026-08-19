export const CLIENT_REQUEST_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_client",
  "completed",
  "cancelled",
] as const

export type ClientRequestStatus = (typeof CLIENT_REQUEST_STATUSES)[number]

export const CLIENT_REQUEST_STATUS_SET = new Set<string>(CLIENT_REQUEST_STATUSES)

export function isClientRequestStatus(value: string): value is ClientRequestStatus {
  return CLIENT_REQUEST_STATUS_SET.has(value)
}

export function isOpenClientRequestStatus(status: string): boolean {
  return status === "open" || status === "in_progress" || status === "waiting_on_client"
}
