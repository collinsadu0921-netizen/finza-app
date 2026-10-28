/**
 * Read-only difference report for paid/locked Ghana payroll runs that used
 * provisional SSNIT limits.
 *
 * Run it after the official annual SSNIT version is configured:
 *   node scripts/ghana-ssnit-provisional-diff.mjs --official-version=gh-pension-2027-01
 *
 * Optional:
 *   --period-start=2027-01-01 --period-end=2027-12-31
 *
 * It never writes to the database. Differences on already-paid runs must go
 * through the existing reversal -> correction-draft workflow; never edit the
 * historical journal or create a duplicate payment.
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import pg from "pg"

pg.types.setTypeParser(1082, (value) => value)

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"

function loadEnvFile(filename) {
  const path = resolve(REPO_ROOT, filename)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvFile(".env.staging")

const officialVersion = process.argv
  .find((a) => a.startsWith("--official-version="))
  ?.split("=")[1]
  ?.trim()
const periodStart =
  process.argv.find((a) => a.startsWith("--period-start="))?.split("=")[1]?.trim() ||
  "2027-01-01"
const periodEnd =
  process.argv.find((a) => a.startsWith("--period-end="))?.split("=")[1]?.trim() ||
  "2027-12-31"

if (!officialVersion) {
  console.error("--official-version=gh-pension-YYYY-01 is required")
  process.exit(1)
}

const password = process.env.SUPABASE_DB_PASSWORD
if (!password) {
  console.error("SUPABASE_DB_PASSWORD required (staging only)")
  process.exit(1)
}
const conn = `postgresql://postgres.${STAGING_REF}:${encodeURIComponent(
  password
)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
if (!conn.includes(STAGING_REF) || conn.includes(PRODUCTION_REF)) {
  console.error("Refused: this report is staging-only")
  process.exit(1)
}

function formatDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || "").slice(0, 10)
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  const runs = await client.query(
    `select id, payroll_month, status, pension_rate_version,
            pension_limits_provisional, pension_minimum_insurable_earnings,
            pension_maximum_insurable_earnings, pension_limits_effective_from,
            total_paye, total_net_salary
     from public.payroll_runs
     where deleted_at is null
       and pension_limits_provisional = true
       and payroll_month between $1 and $2
     order by payroll_month, id`,
    [periodStart, periodEnd]
  )

  const report = []
  for (const run of runs.rows) {
    const entries = await client.query(
      `select pe.id, pe.staff_id, s.name as staff_name, pe.basic_salary,
              pe.gross_salary, pe.deductions_total, pe.taxable_income,
              pe.ssnit_employee, pe.ssnit_employer, pe.paye, pe.net_salary,
              pe.pensionable_base, pe.tier1_ssnit_remittance,
              pe.tier2_pension_remittance, pe.income_tax_method,
              pe.paye_rate_version, pe.bonus_concessional_amount,
              pe.bonus_tax_5, pe.overtime_tax_5, pe.overtime_tax_10,
              pe.payroll_tax_profile,
              public.payroll_ghana_expected_pension(
                pe.basic_salary,
                $2,
                COALESCE((pe.payroll_tax_profile->>'staff_is_pensionable')::boolean, true)
              ) as expected
       from public.payroll_entries pe
       join public.staff s on s.id = pe.staff_id
       where pe.payroll_run_id = $1
         and pe.is_included is distinct from false
       order by s.name`,
      [run.id, officialVersion]
    )

    const differences = []
    for (const e of entries.rows) {
      const expected = e.expected || {}
      const newEmployee = Number(expected.employee ?? 0)
      const oldEmployee = Number(e.ssnit_employee ?? 0)
      const employeeDelta = Math.round((oldEmployee - newEmployee) * 100) / 100
      if (Math.abs(employeeDelta) < 0.005) continue

      const newTaxable = Math.round((Number(e.gross_salary) - newEmployee) * 100) / 100
      let newPaye = Number(e.paye ?? 0)
      if (e.income_tax_method === "gh_resident_graduated") {
        const otAt5 = Math.round((Number(e.overtime_tax_5 || 0) / 0.05) * 100) / 100
        const otAt10 = Math.round((Number(e.overtime_tax_10 || 0) / 0.1) * 100) / 100
        const graduatedBase =
          newTaxable -
          Number(e.bonus_concessional_amount || 0) -
          otAt5 -
          otAt10
        const bandTax = await client.query(
          `select public.payroll_ghana_calculate_paye_from_bands($1, $2) as tax`,
          [graduatedBase, e.paye_rate_version]
        )
        newPaye =
          Number(bandTax.rows[0].tax || 0) +
          Number(e.bonus_tax_5 || 0) +
          Number(e.overtime_tax_5 || 0) +
          Number(e.overtime_tax_10 || 0)
        newPaye = Math.round(newPaye * 100) / 100
      }
      const newNet =
        Math.round(
          (Number(e.gross_salary) - newEmployee - newPaye - Number(e.deductions_total || 0)) *
            100
        ) / 100

      differences.push({
        staffId: e.staff_id,
        staffName: e.staff_name,
        oldEmployeeSsnit: oldEmployee,
        newEmployeeSsnit: newEmployee,
        employeeSsnitDelta: employeeDelta,
        oldEmployerSsnit: Number(e.ssnit_employer || 0),
        newEmployerSsnit: Number(expected.employer ?? 0),
        oldTier1: Number(e.tier1_ssnit_remittance || 0),
        newTier1: Number(expected.tier1 ?? 0),
        oldTier2: Number(e.tier2_pension_remittance || 0),
        newTier2: Number(expected.tier2 ?? 0),
        oldPaye: Number(e.paye || 0),
        newPaye,
        oldNet: Number(e.net_salary || 0),
        newNet,
        netDelta: Math.round((Number(e.net_salary || 0) - newNet) * 100) / 100,
      })
    }

    report.push({
      runId: run.id,
      payrollMonth: formatDate(run.payroll_month),
      status: run.status,
      provisionalVersion: run.pension_rate_version,
      provisionalLimits: `${run.pension_minimum_insurable_earnings}–${run.pension_maximum_insurable_earnings}`,
      limitsEffectiveFrom: formatDate(run.pension_limits_effective_from),
      differenceCount: differences.length,
      differences,
    })
  }

  console.log(
    JSON.stringify(
      {
        officialVersion,
        periodStart,
        periodEnd,
        provisionalRunCount: report.length,
        runsWithDifferences: report.filter((r) => r.differenceCount > 0).length,
        report,
        adjustmentPath:
          "For paid/locked runs: reverse through the existing controlled reversal flow, create the correction draft, approve with official SSNIT limits, and pay only the resulting adjustment. Do not edit historical journals or duplicate payments.",
      },
      null,
      2
    )
  )
} finally {
  await client.end()
}
