#!/usr/bin/env ts-node
/**
 * Verification only: run forensic job and confirm no archived tenants in failures.
 * DO NOT change runner logic or SQL. Uses same path as POST /api/cron/forensic-accounting-verification.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Run: npx ts-node scripts/verify-forensic-archived-exclusion.ts
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    console.error("")
    console.error("To run manually in SQL (Supabase SQL Editor or psql):")
    console.error("  1) INSERT INTO accounting_invariant_runs (status) VALUES ('running') RETURNING id;  -- use returned id as <run_id>")
    console.error("  2) SELECT run_forensic_accounting_verification('<run_id>');")
    console.error("  3) UPDATE accounting_invariant_runs SET finished_at = NOW(), status = 'success', summary = <returned_json> WHERE id = '<run_id>';")
    console.error("  4) SELECT f.business_id, b.archived_at, COUNT(*) FROM accounting_invariant_failures f JOIN businesses b ON b.id = f.business_id WHERE f.run_id = '<run_id>' GROUP BY f.business_id, b.archived_at;")
    console.error("  PASS: no rows with archived_at IS NOT NULL. FAIL: any row with archived_at set.")
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Step 1 — Execute verification runner (same as cron endpoint)
  const { data: runInsert, error: runErr } = await supabase
    .from("accounting_invariant_runs")
    .insert({ status: "running" })
    .select("id")
    .single()

  if (runErr || !runInsert?.id) {
    console.error("Failed to create run:", runErr?.message || "no id")
    process.exit(1)
  }

  const runId = runInsert.id
  const { data: summary, error: rpcErr } = await supabase.rpc("run_forensic_accounting_verification", {
    p_run_id: runId,
  })

  if (rpcErr) {
    console.error("RPC error:", rpcErr.message)
    process.exit(1)
  }

  await supabase
    .from("accounting_invariant_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: (summary?.alertable_failures ?? 0) > 0 ? "partial" : "success",
      summary,
    })
    .eq("id", runId)

  // Step 2 — Latest run and failures
  const { data: latestRun } = await supabase
    .from("accounting_invariant_runs")
    .select("*")
    .eq("id", runId)
    .single()

  const { data: failuresGrouped } = await supabase
    .from("accounting_invariant_failures")
    .select("business_id, check_id")
    .eq("run_id", runId)

  // Step 3 — Validate archived exclusion: failures JOIN businesses
  const businessIds = Array.from(new Set((failuresGrouped || []).map((f) => f.business_id).filter(Boolean)))
  let archivedInFailures: { business_id: string; archived_at: string | null; count: number }[] = []

  if (businessIds.length > 0) {
    const { data: businesses } = await supabase
      .from("businesses")
      .select("id, archived_at")
      .in("id", businessIds)

    const countByBiz = (failuresGrouped || []).reduce<Record<string, number>>((acc, f) => {
      const id = f.business_id ?? ""
      acc[id] = (acc[id] || 0) + 1
      return acc
    }, {})

    for (const b of businesses || []) {
      if (b.archived_at != null) {
        archivedInFailures.push({
          business_id: b.id,
          archived_at: b.archived_at,
          count: countByBiz[b.id] ?? 0,
        })
      }
    }
  }

  // Step 4 — Recent runs for comparison
  const { data: recentRuns } = await supabase
    .from("accounting_invariant_runs")
    .select("id, started_at, summary")
    .order("started_at", { ascending: false })
    .limit(5)

  // Step 5 — Output summary
  const totalFailures = summary?.total_failures ?? 0
  const alertableFailures = summary?.alertable_failures ?? 0
  const archivedStillAppear = archivedInFailures.length > 0

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("Forensic verification — archived exclusion check")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("Latest run_id:", runId)
  console.log("Total failures:", totalFailures)
  console.log("Alertable failures:", alertableFailures)
  console.log("Archived tenants in failures:", archivedStillAppear ? "YES" : "NO")
  if (archivedInFailures.length > 0) {
    console.log("Archived business_ids with failures:", archivedInFailures)
  }
  console.log("")
  console.log("Recent runs (id, total_failures from summary):")
  for (const r of recentRuns || []) {
    const tot = (r.summary as any)?.total_failures ?? "—"
    console.log("  ", r.id, " total_failures:", tot)
  }
  console.log("")
  console.log("Conclusion:", archivedStillAppear ? "FAIL" : "PASS")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

  process.exit(archivedStillAppear ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
