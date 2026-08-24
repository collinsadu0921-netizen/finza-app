import { SERVICE_LIST_REMOUNT_TTL_MS, sharedJsonGet } from "@/lib/client/sharedJsonGet"

/** Same short remount TTL as list pages — not a long-lived financial cache. */
export const SERVICE_REPORT_REMOUNT_TTL_MS = SERVICE_LIST_REMOUNT_TTL_MS

export async function fetchAccountingReportJson<T = unknown>(
  url: string,
  opts?: { fresh?: boolean }
): Promise<{ ok: boolean; status: number; json: T }> {
  return sharedJsonGet<T>(url, {
    ttlMs: SERVICE_REPORT_REMOUNT_TTL_MS,
    fresh: opts?.fresh,
  })
}
