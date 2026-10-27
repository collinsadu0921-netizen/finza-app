#!/usr/bin/env node
/**
 * Financial RPC overload preflight.
 *
 * Detects "name-subset + defaults" overload pairs that PostgreSQL/PostgREST
 * cannot resolve for the shorter named-argument list (SQLSTATE 42725).
 *
 * Payroll payment RPCs are FATAL (the P0 hotfix scope).
 * Other financial RPCs are ADVISORY (known, separately tracked issues).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/check-financial-rpc-overloads.mjs
 *   DATABASE_URL="postgresql://..." node scripts/check-financial-rpc-overloads.mjs --strict
 *
 * Read-only: every query runs inside BEGIN TRANSACTION READ ONLY.
 */
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const strict = process.argv.includes("--strict")

const connectionString =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.STAGING_DATABASE_URL

if (!connectionString) {
  console.error(
    "Missing DATABASE_URL (or SUPABASE_DB_URL / STAGING_DATABASE_URL). Refusing to run."
  )
  process.exit(2)
}

const OVERLOAD_SQL = `
  WITH protected(proname, critical) AS (
    VALUES
      ('record_payroll_payment_atomic', true),
      ('record_payroll_batch_item_payment_atomic', true),
      ('lock_payroll_run_atomic', true),
      ('record_payroll_obligation_payment_atomic', false),
      ('approve_payroll_run_atomic', false),
      ('reverse_payroll_run_atomic', false),
      ('post_payroll_payment_to_ledger', false),
      ('post_payroll_obligation_payment_to_ledger', false),
      ('get_general_ledger_paginated', false),
      ('get_operational_overdue_invoices_page', false),
      ('post_journal_entry', false),
      ('post_sale_to_ledger', false),
      ('validate_accountant_posting', false)
  )
  SELECT
    p.critical,
    a.proname,
    pg_get_function_identity_arguments(a.oid) AS shorter_args,
    pg_get_function_identity_arguments(b.oid) AS longer_args
  FROM pg_proc a
  JOIN protected p ON p.proname = a.proname
  JOIN pg_proc b
    ON b.proname = a.proname
   AND b.oid <> a.oid
   AND b.pronargs > a.pronargs
   AND b.pronargdefaults >= (b.pronargs - a.pronargs)
   AND a.proargnames IS NOT NULL
   AND b.proargnames IS NOT NULL
   AND a.proargnames <@ b.proargnames
  JOIN pg_namespace n ON n.oid = a.pronamespace
  WHERE n.nspname = 'public'
  ORDER BY p.critical DESC, a.proname, a.pronargs
`

const CANONICAL_SQL = `
  SELECT p.proname, count(*)::int AS overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'record_payroll_payment_atomic',
      'record_payroll_batch_item_payment_atomic',
      'lock_payroll_run_atomic'
    )
  GROUP BY p.proname
  ORDER BY p.proname
`

async function main() {
  let pg
  try {
    pg = require("pg")
  } catch {
    console.error(
      "The 'pg' package is required. Run: npm install (it is a devDependency)."
    )
    process.exit(2)
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30000,
  })

  await client.connect()
  try {
    await client.query("BEGIN TRANSACTION READ ONLY")

    const overloads = (await client.query(OVERLOAD_SQL)).rows
    const canonical = (await client.query(CANONICAL_SQL)).rows

    const critical = overloads.filter((r) => r.critical)
    const advisory = overloads.filter((r) => !r.critical)
    const wrongCounts = canonical.filter((r) => r.overloads !== 1)

    console.log("Financial RPC overload preflight")
    console.log(`  FATAL payroll conflicts: ${critical.length}`)
    for (const r of critical) {
      console.log(`    FATAL   ${r.proname}`)
      console.log(`            shorter: ${r.shorter_args}`)
      console.log(`            longer:  ${r.longer_args}`)
    }
    console.log(`  ADVISORY other financial conflicts: ${advisory.length}`)
    for (const r of advisory) {
      console.log(`    ADVISORY ${r.proname}`)
      console.log(`             shorter: ${r.shorter_args}`)
      console.log(`             longer:  ${r.longer_args}`)
    }
    console.log(`  Canonical payroll RPC counts: ${canonical.length ? "" : "(none)"}`)
    for (const r of canonical) {
      console.log(`    ${r.proname}: ${r.overloads}`)
    }

    const failed =
      critical.length > 0 ||
      wrongCounts.length > 0 ||
      (strict && advisory.length > 0)

    if (failed) {
      console.error("\nPREFLIGHT FAILED")
      if (wrongCounts.length > 0) {
        console.error(
          "  Payroll RPCs must have exactly one overload: " +
            wrongCounts.map((r) => `${r.proname}=${r.overloads}`).join(", ")
        )
      }
      if (strict && advisory.length > 0) {
        console.error("  --strict: advisory conflicts are treated as failures.")
      }
      process.exitCode = 1
    } else {
      console.log("\nPREFLIGHT PASSED")
    }
  } finally {
    try {
      await client.query("ROLLBACK")
    } catch {
      /* ignore */
    }
    await client.end()
  }
}

main().catch((error) => {
  console.error("Preflight error:", error?.message || String(error))
  process.exit(1)
})
