#!/usr/bin/env node
/**
 * Production-safe targeted migration runner (Finza Pro).
 *
 * Dry-run (read-only):
 *   node scripts/apply-production-migrations.mjs --dry-run 535 537 539
 *
 * Execute (writes; requires interactive production-ref confirmation):
 *   node scripts/apply-production-migrations.mjs --execute-production 535 537 539
 *
 * Safety:
 * - Uses PRODUCTION_DATABASE_URL only (no DATABASE_URL / .env / staging fallbacks)
 * - Refuses staging ref adonhhtooawkeemdqqeo
 * - Requires production ref qjxhibvbmzogyzbhswjj on a verified pooler/direct host
 * - Applies only explicitly listed versions, one transaction each
 * - Does not fabricate skipped migration history rows
 * - Never runs supabase db push
 */
import { createRequire } from "module"
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const runner = require(resolve(__dirname, "lib/productionMigrationRunner.cjs"))

async function cli() {
  try {
    await runner.main(process.argv.slice(2))
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    // Avoid dumping objects that may contain connection details.
    console.error(`ERROR: ${msg}`)
    if (err && err.code) {
      console.error(`CODE: ${err.code}`)
    }
    process.exit(1)
  }
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(__filename)

if (isDirectRun) {
  await cli()
}

export {}
