/**
 * Orchestrates forensic alert delivery (Slack + Email).
 * Only runs when FORENSIC_ALERT_ENABLED === 'true'.
 * Server-side only.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { buildForensicAlert } from "./forensicAlertBuilder"
import { sendSlackForensicAlert } from "./sendSlackForensicAlert"
import { sendEmailForensicAlert } from "./sendEmailForensicAlert"

export type TriggerResult = { sent: boolean; error?: string }

/**
 * Query open alert-level failures for the run, build payload, send Slack and/or Email.
 * Returns { sent: true } if at least one channel succeeded; otherwise { sent: false, error }.
 * Does not throw; errors are logged and returned.
 */
export async function triggerForensicEscalation(
  supabase: SupabaseClient,
  runId: string
): Promise<TriggerResult> {
  const enabled = process.env.FORENSIC_ALERT_ENABLED === "true"
  if (!enabled) {
    return { sent: false, error: "FORENSIC_ALERT_ENABLED is not true" }
  }

  const { data: run, error: runError } = await supabase
    .from("accounting_invariant_runs")
    .select("id, summary")
    .eq("id", runId)
    .maybeSingle()

  if (runError || !run) {
    const err = runError?.message ?? "Run not found"
    console.error("triggerForensicEscalation: run fetch failed", err)
    return { sent: false, error: err }
  }

  const { data: failures, error: failError } = await supabase
    .from("accounting_invariant_failures")
    .select("check_id, business_id, created_at")
    .eq("run_id", runId)
    .eq("severity", "alert")
    .eq("status", "open")

  if (failError) {
    console.error("triggerForensicEscalation: failures fetch failed", failError)
    return { sent: false, error: failError.message }
  }

  const list = failures ?? []
  if (list.length === 0) {
    return { sent: false, error: "No open alert failures" }
  }

  const payload = buildForensicAlert(
    { id: run.id, summary: run.summary as Record<string, unknown> | null },
    list
  )

  let slackOk = false
  let emailOk = false
  const webhook = process.env.FORENSIC_ALERT_SLACK_WEBHOOK
  const emailTo = process.env.FORENSIC_ALERT_EMAIL

  if (webhook?.trim()) {
    slackOk = await sendSlackForensicAlert(webhook.trim(), payload)
  }
  if (emailTo?.trim()) {
    emailOk = await sendEmailForensicAlert(emailTo.trim(), payload)
  }

  if (slackOk || emailOk) {
    return { sent: true }
  }
  return {
    sent: false,
    error: !webhook?.trim() && !emailTo?.trim()
      ? "Neither FORENSIC_ALERT_SLACK_WEBHOOK nor FORENSIC_ALERT_EMAIL configured"
      : "Slack and email delivery both failed",
  }
}
