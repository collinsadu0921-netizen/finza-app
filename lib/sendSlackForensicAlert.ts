/**
 * Sends forensic alert to Slack via webhook.
 * Server-side only. Do not expose webhook URL to frontend.
 */

import type { ForensicAlertPayload } from "./forensicAlertBuilder"

function formatSlackMessage(payload: ForensicAlertPayload): string {
  const lines: string[] = [
    "🚨 *Finza Forensic Alert*",
    "",
    `Run ID: \`${payload.run_id}\``,
    `Alertable Failures: ${payload.total_alerts}`,
    "",
    "*Breakdown:*",
  ]
  const counts = payload.check_counts
  const order = [
    "je_imbalanced",
    "period_id_null",
    "invoice_je_date_mismatch",
    "trial_balance_snapshot_mismatch",
  ]
  const seen = new Set<string>()
  for (const id of order) {
    if (id in counts && counts[id] != null) {
      lines.push(`- ${id}: ${counts[id]}`)
      seen.add(id)
    }
  }
  for (const id of Object.keys(counts).sort()) {
    if (!seen.has(id)) {
      lines.push(`- ${id}: ${counts[id]}`)
    }
  }
  lines.push("")
  lines.push("*View Dashboard:*")
  lines.push(payload.dashboard_url)
  return lines.join("\n")
}

/**
 * POST to Slack webhook. Returns true on success, false on failure.
 * Does not throw; logs errors.
 */
export async function sendSlackForensicAlert(
  webhookUrl: string,
  payload: ForensicAlertPayload
): Promise<boolean> {
  const text = formatSlackMessage(payload)
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      console.error("Slack forensic alert failed:", res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error("Slack forensic alert error:", err)
    return false
  }
}
