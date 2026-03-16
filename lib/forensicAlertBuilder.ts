/**
 * Builds payload for forensic escalation (Slack / Email).
 * Alert delivery only. No ledger or invariant logic.
 */

const SAMPLE_FAILURES_MAX = 5

export type ForensicRunForAlert = {
  id: string
  summary?: {
    total_failures?: number
    alertable_failures?: number
    check_counts?: Record<string, number>
  } | null
}

export type ForensicFailureForAlert = {
  check_id: string
  business_id: string | null
  created_at: string
}

export type ForensicAlertPayload = {
  run_id: string
  total_alerts: number
  check_counts: Record<string, number>
  sample_failures: Array<{ check_id: string; business_id: string | null; created_at: string }>
  dashboard_url: string
}

function getDashboardUrl(runId: string): string {
  const base =
    process.env.ADMIN_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  const origin = base.startsWith("http") ? base : `https://${base}`
  return `${origin}/admin/accounting/forensic-runs/${runId}`
}

/**
 * Build alert payload for a run and its open alert-level failures.
 */
export function buildForensicAlert(
  run: ForensicRunForAlert,
  failures: ForensicFailureForAlert[]
): ForensicAlertPayload {
  const runId = run.id
  const total = failures.length
  const check_counts: Record<string, number> = { ...(run.summary?.check_counts ?? {}) }
  for (const f of failures) {
    check_counts[f.check_id] = (check_counts[f.check_id] ?? 0) + 1
  }
  const sample_failures = failures
    .slice(0, SAMPLE_FAILURES_MAX)
    .map((f) => ({
      check_id: f.check_id,
      business_id: f.business_id,
      created_at: f.created_at,
    }))

  return {
    run_id: runId,
    total_alerts: total,
    check_counts,
    sample_failures,
    dashboard_url: getDashboardUrl(runId),
  }
}
