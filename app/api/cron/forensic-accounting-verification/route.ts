import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const authHeader = request.headers.get("authorization")
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const token = authHeader.slice(7).trim()
  if (!token || token !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let runId: string
  try {
    const { data: run, error: runError } = await supabase
      .from("accounting_invariant_runs")
      .insert({ status: "running" })
      .select("id")
      .single()
    if (runError || !run?.id) {
      return NextResponse.json(
        { error: "Failed to create run record", details: runError?.message },
        { status: 500 }
      )
    }
    runId = run.id
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to create run record", details: String(e) },
      { status: 500 }
    )
  }

  let summary: { total_failures?: number; alertable_failures?: number; check_counts?: Record<string, number> }
  try {
    const { data, error } = await supabase.rpc("run_forensic_accounting_verification", {
      p_run_id: runId,
    })
    if (error) {
      await supabase
        .from("accounting_invariant_runs")
        .update({ status: "error", finished_at: new Date().toISOString(), summary: { error: error.message } })
        .eq("id", runId)
      return NextResponse.json(
        { error: "RPC failed", details: error.message },
        { status: 500 }
      )
    }
    summary = data ?? {}
  } catch (e) {
    await supabase
      .from("accounting_invariant_runs")
      .update({ status: "error", finished_at: new Date().toISOString(), summary: { error: String(e) } })
      .eq("id", runId)
    return NextResponse.json(
      { error: "RPC failed", details: String(e) },
      { status: 500 }
    )
  }

  const alertable = Number(summary.alertable_failures ?? 0)
  const status = alertable > 0 ? "partial" : "success"
  await supabase
    .from("accounting_invariant_runs")
    .update({
      finished_at: new Date().toISOString(),
      status,
      summary,
    })
    .eq("id", runId)

  if (alertable > 0) {
    console.error(
      JSON.stringify({
        event: "forensic_accounting_alert",
        run_id: runId,
        alertable_failures: alertable,
        total_failures: summary.total_failures,
        check_counts: summary.check_counts,
      })
    )
  }

  // Escalation: only when FORENSIC_ALERT_ENABLED, open alert failures exist, and alert_sent = false
  if (
    process.env.FORENSIC_ALERT_ENABLED === "true" &&
    alertable > 0
  ) {
    try {
      const { data: runRow } = await supabase
        .from("accounting_invariant_runs")
        .select("alert_sent")
        .eq("id", runId)
        .maybeSingle()

      const alreadySent = runRow?.alert_sent === true
      if (!alreadySent) {
        const { data: openAlerts } = await supabase
          .from("accounting_invariant_failures")
          .select("id")
          .eq("run_id", runId)
          .eq("severity", "alert")
          .eq("status", "open")

        const openCount = openAlerts?.length ?? 0
        if (openCount > 0) {
          const { triggerForensicEscalation } = await import("@/lib/triggerForensicEscalation")
          const result = await triggerForensicEscalation(supabase, runId)
          if (result.sent) {
            await supabase
              .from("accounting_invariant_runs")
              .update({ alert_sent: true })
              .eq("id", runId)
          } else if (result.error) {
            console.error("Forensic escalation did not send:", result.error)
          }
        }
      }
    } catch (err) {
      console.error("Forensic escalation error (cron still returns 200):", err)
    }
  }

  return NextResponse.json({ run_id: runId, summary })
}
