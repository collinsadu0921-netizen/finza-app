#!/usr/bin/env node
/**
 * Process accounting snapshot refresh jobs via service-role RPC.
 *
 *   node scripts/process-accounting-snapshot-jobs.mjs
 *   node scripts/process-accounting-snapshot-jobs.mjs --env .env.staging --batch 25 --batches 20
 *
 * Prefers .env.staging when --env is omitted and file exists.
 */
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"

const envIdx = process.argv.indexOf("--env")
const envPath =
  envIdx >= 0
    ? resolve(REPO_ROOT, process.argv[envIdx + 1])
    : existsSync(resolve(REPO_ROOT, ".env.staging"))
      ? resolve(REPO_ROOT, ".env.staging")
      : resolve(REPO_ROOT, ".env.local")

config({ path: envPath })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const batchIdx = process.argv.indexOf("--batch")
const batchesIdx = process.argv.indexOf("--batches")
const batchSize = batchIdx >= 0 ? parseInt(process.argv[batchIdx + 1], 10) : 25
const maxBatches = batchesIdx >= 0 ? parseInt(process.argv[batchesIdx + 1], 10) : 40

if (!url || !key) {
  console.error(`Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ${envPath}`)
  process.exit(1)
}

if (url.includes(PRODUCTION_REF)) {
  console.error("Refused: points at production. Use staging only.")
  process.exit(1)
}

if (!url.includes(STAGING_REF)) {
  console.error(`Refused: URL must include staging ref ${STAGING_REF}`)
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function processBatch(limit) {
  const { data: jobs, error: claimError } = await supabase.rpc(
    "claim_accounting_snapshot_refresh_jobs",
    { p_limit: limit, p_lease_seconds: 900 }
  )
  if (claimError) throw new Error(`claim failed: ${claimError.message}`)

  const claimed = jobs ?? []
  let completed = 0
  let failed = 0
  const errors = []

  for (const job of claimed) {
    try {
      const { error } = await supabase.rpc("finza_worker_refresh_period_snapshots", {
        p_business_id: job.business_id,
        p_period_start: job.period_start,
        p_period_end: job.period_end,
        p_job_type: job.job_type,
      })
      if (error) throw new Error(error.message)

      const { error: completeError } = await supabase.rpc(
        "complete_accounting_snapshot_refresh_job",
        { p_job_id: job.id, p_claim_token: job.claim_token ?? null }
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
        p_claim_token: job.claim_token ?? null,
      })
    }
  }

  return { claimed: claimed.length, completed, failed, errors }
}

async function main() {
  console.log(`env=${envPath}`)
  console.log(`target=${url}`)

  const { data: before } = await supabase.rpc("get_accounting_snapshot_queue_diagnostics", {
    p_business_id: null,
  })
  console.log("before", before)

  let totalClaimed = 0
  let totalCompleted = 0
  let totalFailed = 0

  for (let i = 0; i < maxBatches; i++) {
    const result = await processBatch(Number.isFinite(batchSize) ? batchSize : 25)
    totalClaimed += result.claimed
    totalCompleted += result.completed
    totalFailed += result.failed
    console.log(`batch ${i + 1}`, result)
    if (result.claimed === 0) break
  }

  const { data: after } = await supabase.rpc("get_accounting_snapshot_queue_diagnostics", {
    p_business_id: null,
  })
  console.log(
    JSON.stringify(
      { totalClaimed, totalCompleted, totalFailed, before, after },
      null,
      2
    )
  )
  if (totalFailed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
