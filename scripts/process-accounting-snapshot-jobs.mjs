#!/usr/bin/env node
/**
 * Process accounting snapshot refresh jobs (522) via service-role RPC.
 *
 *   node scripts/process-accounting-snapshot-jobs.mjs
 *   node scripts/process-accounting-snapshot-jobs.mjs --batch 25
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, "../.env.local") })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const batchIdx = process.argv.indexOf("--batch")
const batchSize = batchIdx >= 0 ? parseInt(process.argv[batchIdx + 1], 10) : 10

if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: jobs, error: claimError } = await supabase.rpc(
    "claim_accounting_snapshot_refresh_jobs",
    { p_limit: Number.isFinite(batchSize) ? batchSize : 10 }
  )
  if (claimError) {
    console.error("claim failed:", claimError.message)
    process.exit(1)
  }

  const claimed = jobs ?? []
  let completed = 0
  let failed = 0
  const errors = []

  for (const job of claimed) {
    try {
      if (job.job_type === "dashboard" || job.job_type === "both") {
        const { error } = await supabase.rpc("finza_worker_refresh_dashboard_period_summary", {
          p_business_id: job.business_id,
          p_period_start: job.period_start,
          p_period_end: job.period_end,
        })
        if (error) throw new Error(`dashboard: ${error.message}`)
      }
      if (job.job_type === "pnl" || job.job_type === "both") {
        const { error } = await supabase.rpc("finza_worker_refresh_pnl_snapshot", {
          p_business_id: job.business_id,
          p_period_start: job.period_start,
          p_period_end: job.period_end,
        })
        if (error) throw new Error(`pnl: ${error.message}`)
      }
      const { error: completeError } = await supabase.rpc(
        "complete_accounting_snapshot_refresh_job",
        { p_job_id: job.id }
      )
      if (completeError) throw new Error(completeError.message)
      completed++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : "unknown"
      errors.push({ jobId: job.id, error: message })
      await supabase.rpc("fail_accounting_snapshot_refresh_job", {
        p_job_id: job.id,
        p_error: message,
        p_max_attempts: 5,
        p_backoff_seconds: 60,
      })
    }
  }

  console.log(JSON.stringify({ claimed: claimed.length, completed, failed, errors }, null, 2))
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
