/**
 * Production-safe targeted migration runner core.
 * Used by scripts/apply-production-migrations.mjs
 *
 * Never loads DATABASE_URL, SUPABASE_DB_PASSWORD, .env.local, or staging values.
 */
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const readline = require("readline")

const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const STAGING_REF = "adonhhtooawkeemdqqeo"
/** pg_advisory_lock(key1, key2) — Finza production targeted migrations */
const ADVISORY_LOCK_KEY1 = 872351935
const ADVISORY_LOCK_KEY2 = 1

/** Test-migration filenames rejected unless later allowlisted. */
const TEST_MIGRATION_RE = /(_sql_tests|_test)\.sql$/i
const TEST_MIGRATION_ALLOWLIST = new Set()

const SECRET_PATTERNS = [
  /password\s*=\s*['"][^'"]+['"]/i,
  /secret\s*=\s*['"][^'"]+['"]/i,
  /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
  /bearer\s+[a-z0-9._-]{20,}/i,
  /\bsk_(live|test)_[a-z0-9]+/i,
  /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./,
  /service_role\s*=\s*['"][^'"]+['"]/i,
  /supabase_service_role/i,
]

class RunnerError extends Error {
  constructor(message, code = "RUNNER_ERROR") {
    super(message)
    this.name = "RunnerError"
    this.code = code
  }
}

function createSafeLogger(stream = process.stdout) {
  const forbidden = []
  return {
    trackSecret(value) {
      if (value && typeof value === "string" && value.length > 0) {
        forbidden.push(value)
        if (value.length > 8) {
          forbidden.push(encodeURIComponent(value))
        }
      }
    },
    log(line) {
      let out = String(line)
      for (const secret of forbidden) {
        if (!secret) continue
        if (out.includes(secret)) {
          out = out.split(secret).join("[REDACTED]")
        }
      }
      // Belt-and-suspenders: never print postgres URLs with credentials.
      out = out.replace(/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi, "postgresql://[REDACTED]@")
      stream.write(out.endsWith("\n") ? out : `${out}\n`)
    },
  }
}

function parseCliArgs(argv) {
  const flags = {
    dryRun: false,
    executeProduction: false,
  }
  const versions = []

  for (const arg of argv) {
    if (arg === "--dry-run") {
      flags.dryRun = true
      continue
    }
    if (arg === "--execute-production") {
      flags.executeProduction = true
      continue
    }
    if (arg.startsWith("-")) {
      throw new RunnerError(`Unknown flag: ${arg}`, "UNKNOWN_FLAG")
    }
    if (!/^\d+$/.test(arg)) {
      throw new RunnerError(
        `Invalid migration version '${arg}'. Expected explicit numeric versions only (no ranges/wildcards).`,
        "INVALID_VERSION"
      )
    }
    if (arg.includes("-") || arg.includes("*") || arg.includes("..")) {
      throw new RunnerError(`Ranges/wildcards are not allowed: ${arg}`, "RANGE_REJECTED")
    }
    versions.push(arg)
  }

  if (flags.dryRun && flags.executeProduction) {
    throw new RunnerError("Specify only one of --dry-run or --execute-production", "MODE_CONFLICT")
  }
  if (!flags.dryRun && !flags.executeProduction) {
    throw new RunnerError(
      "Specify --dry-run (read-only) or --execute-production (writes).",
      "MODE_REQUIRED"
    )
  }
  if (versions.length === 0) {
    throw new RunnerError(
      "No migration versions supplied. Example: node scripts/apply-production-migrations.mjs --dry-run 535 537 539",
      "NO_VERSIONS"
    )
  }

  const seen = new Set()
  for (const v of versions) {
    if (seen.has(v)) {
      throw new RunnerError(`Duplicate migration version: ${v}`, "DUPLICATE_VERSION")
    }
    seen.add(v)
  }

  for (let i = 1; i < versions.length; i++) {
    const prev = BigInt(versions[i - 1])
    const cur = BigInt(versions[i])
    if (cur <= prev) {
      throw new RunnerError(
        `Unordered versions: expected strictly ascending, got ${versions.join(" ")}`,
        "UNORDERED_VERSIONS"
      )
    }
  }

  return { ...flags, versions }
}

function parseProductionDatabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new RunnerError("PRODUCTION_DATABASE_URL is missing", "MISSING_URL")
  }
  const raw = rawUrl.trim()
  if (raw.includes(STAGING_REF)) {
    throw new RunnerError(
      `PRODUCTION_DATABASE_URL contains staging ref ${STAGING_REF}; refused`,
      "STAGING_REF"
    )
  }
  if (!raw.includes(PRODUCTION_REF)) {
    throw new RunnerError(
      `PRODUCTION_DATABASE_URL does not identify production ref ${PRODUCTION_REF}`,
      "WRONG_REF"
    )
  }

  let parsed
  try {
    parsed = new URL(raw.replace(/^postgres(ql)?:/i, "http:"))
  } catch {
    throw new RunnerError("PRODUCTION_DATABASE_URL could not be parsed", "URL_PARSE")
  }

  const host = parsed.hostname || ""
  const user = decodeURIComponent(parsed.username || "")
  const password = parsed.password == null ? "" : String(parsed.password)
  const database = (parsed.pathname || "/postgres").replace(/^\//, "") || "postgres"
  const port = Number(parsed.port || 5432)

  const hostIsPooler = host.includes("pooler.supabase.com")
  const hostIsDirect = host === `db.${PRODUCTION_REF}.supabase.co`
  if (!hostIsPooler && !hostIsDirect) {
    throw new RunnerError(
      `Database host is not a verified production Supabase endpoint: ${host}`,
      "BAD_HOST"
    )
  }

  const userOk =
    user === `postgres.${PRODUCTION_REF}` ||
    (hostIsDirect && user === "postgres")
  if (!userOk) {
    throw new RunnerError(
      "Database user is not verified for production pooler/direct access",
      "BAD_USER"
    )
  }
  if (user.includes(STAGING_REF)) {
    throw new RunnerError("Database user contains staging ref; refused", "STAGING_USER")
  }
  if (!password) {
    throw new RunnerError("PRODUCTION_DATABASE_URL has an empty password", "EMPTY_PASSWORD")
  }

  return {
    productionRef: PRODUCTION_REF,
    host,
    port,
    database,
    user,
    password,
    hostIsPooler,
    hostIsDirect,
  }
}

function resolveMigrationFiles(versions, migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    throw new RunnerError(`Migrations directory missing: ${migrationsDir}`, "MIG_DIR_MISSING")
  }
  const all = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))
  const plan = []

  for (const version of versions) {
    const matches = all.filter((f) => f.startsWith(`${version}_`))
    if (matches.length === 0) {
      throw new RunnerError(`No migration file for version ${version}`, "UNKNOWN_VERSION")
    }
    if (matches.length > 1) {
      throw new RunnerError(
        `Multiple migration files share prefix ${version}_: ${matches.join(", ")}`,
        "AMBIGUOUS_PREFIX"
      )
    }
    const filename = matches[0]
    if (TEST_MIGRATION_RE.test(filename) && !TEST_MIGRATION_ALLOWLIST.has(version)) {
      throw new RunnerError(
        `Refusing test migration ${filename} (not allowlisted)`,
        "TEST_MIGRATION"
      )
    }
    const fullPath = path.join(migrationsDir, filename)
    const sql = fs.readFileSync(fullPath, "utf8")
    const checksum = crypto.createHash("sha256").update(sql, "utf8").digest("hex")
    const name = filename.replace(/\.sql$/, "").replace(/^\d+_/, "")
    plan.push({
      version,
      filename,
      fullPath,
      name,
      sql,
      checksum,
      analysis: analyzeSql(sql),
    })
  }

  return plan
}

function stripSqlNoise(sql) {
  // Remove block comments, line comments, and dollar-quoted bodies for txn detection.
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ")
  s = s.replace(/--[^\n]*/g, " ")
  s = s.replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, " ")
  s = s.replace(/'([^']|'')*'/g, " ")
  return s
}

function analyzeSql(sql) {
  const stripped = stripSqlNoise(sql)
  const txnControls = []
  const txnRe = /^\s*(BEGIN|COMMIT|ROLLBACK|END\s+TRANSACTION)\s*;/gim
  let m
  while ((m = txnRe.exec(stripped)) !== null) {
    txnControls.push(m[1].replace(/\s+/g, " ").toUpperCase())
  }
  const secrets = []
  for (const re of SECRET_PATTERNS) {
    if (re.test(sql)) {
      secrets.push(re.source)
    }
  }
  return {
    transactionControlStatements: txnControls,
    obviousSecrets: secrets,
    hasTransactionControls: txnControls.length > 0,
    hasObviousSecrets: secrets.length > 0,
  }
}

async function defaultConfirmProductionRef(productionRef, { stdin, stdout, isTTY }) {
  if (!isTTY) {
    throw new RunnerError(
      "Interactive confirmation required for --execute-production (stdin is not a TTY)",
      "NO_TTY"
    )
  }
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const answer = await new Promise((resolve) => {
      rl.question(
        `Type the production project ref (${productionRef}) to continue: `,
        resolve
      )
    })
    if (String(answer || "").trim() !== productionRef) {
      throw new RunnerError("Production project ref confirmation failed", "CONFIRM_FAILED")
    }
  } finally {
    rl.close()
  }
}

function buildPgConfig(identity) {
  return {
    host: identity.host,
    port: identity.port,
    database: identity.database,
    user: identity.user,
    password: identity.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
    statement_timeout: 120000,
  }
}

async function withClient(identity, createClient, fn) {
  const client = createClient(buildPgConfig(identity))
  await client.connect()
  try {
    return await fn(client)
  } finally {
    try {
      await client.end()
    } catch {
      /* ignore */
    }
  }
}

async function acquireAdvisoryLock(client) {
  await client.query("SELECT pg_advisory_lock($1::int, $2::int)", [
    ADVISORY_LOCK_KEY1,
    ADVISORY_LOCK_KEY2,
  ])
}

async function releaseAdvisoryLock(client) {
  await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", [
    ADVISORY_LOCK_KEY1,
    ADVISORY_LOCK_KEY2,
  ])
}

async function isVersionRecorded(client, version) {
  const res = await client.query(
    `select 1 from supabase_migrations.schema_migrations where version = $1 limit 1`,
    [version]
  )
  return (res.rowCount || 0) > 0
}

async function recordMigrationVersion(client, item) {
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, name, statements)
     values ($1, $2, $3)`,
    [item.version, item.name, null]
  )
}

async function runDryRun({ identity, plan, createClient, logger }) {
  logger.trackSecret(identity.password)
  logger.log(`mode=dry-run project_ref=${PRODUCTION_REF} host=${identity.host}`)
  logger.log(`plan_count=${plan.length}`)

  await withClient(identity, createClient, async (client) => {
    await client.query("SET default_transaction_read_only = on")
    const ro = await client.query("select current_setting('transaction_read_only') as txn_ro")
    if (ro.rows[0]?.txn_ro !== "on") {
      throw new RunnerError("Failed to enable read-only transaction for dry-run", "RO_FAILED")
    }

    for (const item of plan) {
      const recorded = await isVersionRecorded(client, item.version)
      logger.log(
        [
          `version=${item.version}`,
          `filename=${item.filename}`,
          `checksum=${item.checksum}`,
          `recorded=${recorded}`,
          `txn_controls=${item.analysis.transactionControlStatements.join(",") || "none"}`,
          `secret_hits=${item.analysis.obviousSecrets.length}`,
        ].join(" ")
      )
      if (item.analysis.hasObviousSecrets) {
        throw new RunnerError(
          `Migration ${item.filename} appears to embed secrets; refusing dry-run success`,
          "SECRET_IN_SQL"
        )
      }
    }
  })

  logger.log("dry-run=OK (no writes performed)")
  return { wrote: false, applied: [] }
}

async function runExecute({
  identity,
  plan,
  createClient,
  logger,
  confirmProductionRef,
  stdin = process.stdin,
  stdout = process.stdout,
}) {
  logger.trackSecret(identity.password)
  logger.log(`mode=execute-production project_ref=${PRODUCTION_REF} host=${identity.host}`)
  logger.log("Ordered plan:")
  for (const item of plan) {
    logger.log(
      `  version=${item.version} filename=${item.filename} checksum=${item.checksum}`
    )
    if (item.analysis.hasObviousSecrets) {
      throw new RunnerError(
        `Migration ${item.filename} appears to embed secrets; refusing execute`,
        "SECRET_IN_SQL"
      )
    }
  }

  await confirmProductionRef(PRODUCTION_REF, {
    stdin,
    stdout,
    isTTY: Boolean(stdin.isTTY),
  })

  const applied = []
  let lockHeld = false

  await withClient(identity, createClient, async (client) => {
    try {
      await acquireAdvisoryLock(client)
      lockHeld = true
      logger.log(
        `advisory_lock=acquired key=${ADVISORY_LOCK_KEY1},${ADVISORY_LOCK_KEY2}`
      )

      for (const item of plan) {
        const already = await isVersionRecorded(client, item.version)
        if (already) {
          throw new RunnerError(
            `Migration ${item.version} is already recorded; refusing to re-apply`,
            "ALREADY_RECORDED"
          )
        }
      }

      for (const item of plan) {
        const t0 = Date.now()
        logger.log(`applying version=${item.version} filename=${item.filename}`)
        await client.query("BEGIN")
        try {
          await client.query(item.sql)
          await recordMigrationVersion(client, item)
          await client.query("COMMIT")
          const elapsedMs = Date.now() - t0
          applied.push(item.version)
          logger.log(
            `success version=${item.version} filename=${item.filename} checksum=${item.checksum} elapsed_ms=${elapsedMs}`
          )
        } catch (err) {
          try {
            await client.query("ROLLBACK")
          } catch {
            /* ignore */
          }
          const elapsedMs = Date.now() - t0
          logger.log(
            `failure version=${item.version} filename=${item.filename} checksum=${item.checksum} elapsed_ms=${elapsedMs}`
          )
          throw err
        }
      }
    } finally {
      if (lockHeld) {
        try {
          await releaseAdvisoryLock(client)
          logger.log("advisory_lock=released")
        } catch (unlockErr) {
          logger.log(
            `advisory_lock=release_failed message=${String(unlockErr.message || unlockErr).slice(0, 160)}`
          )
        }
      }
    }
  })

  return { wrote: true, applied }
}

async function main(argv, deps = {}) {
  const logger = deps.logger || createSafeLogger()
  const migrationsDir =
    deps.migrationsDir || path.resolve(__dirname, "..", "..", "supabase", "migrations")
  const createClient =
    deps.createClient ||
    ((config) => {
      const pg = require("pg")
      return new pg.Client(config)
    })
  const confirmProductionRef = deps.confirmProductionRef || defaultConfirmProductionRef
  const env = deps.env || process.env

  // Hard refusal of fallback credential sources (presence alone is not used).
  // Only PRODUCTION_DATABASE_URL is read.
  const rawUrl = env.PRODUCTION_DATABASE_URL
  const parsed = parseCliArgs(argv)
  const identity = parseProductionDatabaseUrl(rawUrl)
  logger.trackSecret(identity.password)
  logger.trackSecret(rawUrl)

  const plan = resolveMigrationFiles(parsed.versions, migrationsDir)

  // Ensure plan versions equal exactly the supplied list (no extras).
  const planVersions = plan.map((p) => p.version)
  if (planVersions.join(",") !== parsed.versions.join(",")) {
    throw new RunnerError("Internal plan mismatch vs supplied versions", "PLAN_MISMATCH")
  }

  if (parsed.dryRun) {
    return runDryRun({ identity, plan, createClient, logger })
  }

  if (!parsed.executeProduction) {
    throw new RunnerError("Execution requires --execute-production", "EXECUTE_REQUIRED")
  }

  return runExecute({
    identity,
    plan,
    createClient,
    logger,
    confirmProductionRef,
    stdin: deps.stdin || process.stdin,
    stdout: deps.stdout || process.stdout,
  })
}

module.exports = {
  PRODUCTION_REF,
  STAGING_REF,
  ADVISORY_LOCK_KEY1,
  ADVISORY_LOCK_KEY2,
  TEST_MIGRATION_ALLOWLIST,
  RunnerError,
  createSafeLogger,
  parseCliArgs,
  parseProductionDatabaseUrl,
  resolveMigrationFiles,
  analyzeSql,
  stripSqlNoise,
  buildPgConfig,
  acquireAdvisoryLock,
  releaseAdvisoryLock,
  isVersionRecorded,
  recordMigrationVersion,
  runDryRun,
  runExecute,
  main,
  defaultConfirmProductionRef,
}
