/**
 * Focused safety tests for the production targeted migration runner.
 * Uses mocks / temp dirs only — never writes to production.
 */
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const nodeRequire = createRequire(__filename)
const runner = nodeRequire("../lib/productionMigrationRunner.cjs") as {
  parseProductionDatabaseUrl: (url: string) => unknown
  parseCliArgs: (argv: string[]) => unknown
  resolveMigrationFiles: (versions: string[], dir: string) => unknown
  createSafeLogger: (stream?: NodeJS.WritableStream) => {
    trackSecret: (v: string) => void
    log: (line: string) => void
  }
  main: (argv: string[], deps?: Record<string, unknown>) => Promise<{
    wrote: boolean
    applied: string[]
  }>
}

const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const STAGING_REF = "adonhhtooawkeemdqqeo"

function prodUrl(opts?: { ref?: string; host?: string; user?: string; pass?: string }) {
  const ref = opts?.ref ?? PRODUCTION_REF
  const host = opts?.host ?? "aws-1-eu-north-1.pooler.supabase.com"
  const user = opts?.user ?? `postgres.${ref}`
  const pass = opts?.pass ?? "TestPassword1234"
  return `postgresql://${user}:${pass}@${host}:5432/postgres`
}

function makeMigrationsDir(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finza-prod-mig-"))
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql, "utf8")
  }
  return dir
}

function mockClient(handlers: {
  recorded?: Set<string>
  onQuery?: (sql: string, params?: unknown[]) => unknown
  failOnSqlIncludes?: string
} = {}) {
  const recorded = handlers.recorded ?? new Set<string>()
  const queries: { sql: string; params?: unknown[] }[] = []
  let lockHeld = false
  let ended = false
  let inTx = false

  const client = {
    queries,
    get lockHeld() {
      return lockHeld
    },
    get ended() {
      return ended
    },
    async connect() {
      return undefined
    },
    async end() {
      ended = true
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params })
      if (handlers.onQuery) {
        const custom = handlers.onQuery(sql, params)
        if (custom !== undefined) return custom
      }
      const s = sql.trim()
      if (/pg_advisory_lock/i.test(s)) {
        lockHeld = true
        return { rows: [{ pg_advisory_lock: true }], rowCount: 1 }
      }
      if (/pg_advisory_unlock/i.test(s)) {
        lockHeld = false
        return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 }
      }
      if (/transaction_read_only/i.test(s) && /select/i.test(s)) {
        return { rows: [{ txn_ro: "on" }], rowCount: 1 }
      }
      if (/SET default_transaction_read_only/i.test(s)) {
        return { rows: [], rowCount: 0 }
      }
      if (/schema_migrations/i.test(s) && /select/i.test(s)) {
        const version = String(params?.[0] ?? "")
        const hit = recorded.has(version)
        return { rows: hit ? [{ "?column?": 1 }] : [], rowCount: hit ? 1 : 0 }
      }
      if (/^BEGIN$/i.test(s)) {
        inTx = true
        return { rows: [], rowCount: 0 }
      }
      if (/^COMMIT$/i.test(s)) {
        inTx = false
        return { rows: [], rowCount: 0 }
      }
      if (/^ROLLBACK$/i.test(s)) {
        inTx = false
        return { rows: [], rowCount: 0 }
      }
      if (/insert into supabase_migrations\.schema_migrations/i.test(s)) {
        const version = String(params?.[0] ?? "")
        recorded.add(version)
        return { rows: [], rowCount: 1 }
      }
      if (handlers.failOnSqlIncludes && sql.includes(handlers.failOnSqlIncludes)) {
        throw new Error(`SQL failed: ${handlers.failOnSqlIncludes}`)
      }
      // Migration body or other SQL
      if (inTx && handlers.failOnSqlIncludes && sql.includes(handlers.failOnSqlIncludes)) {
        throw new Error(`SQL failed: ${handlers.failOnSqlIncludes}`)
      }
      return { rows: [], rowCount: 0 }
    },
  }

  return { client, recorded, queries }
}

describe("apply-production-migrations runner", () => {
  it("1. rejects missing production URL", () => {
    expect(() => runner.parseProductionDatabaseUrl("")).toThrow(/missing/i)
    expect(() => runner.parseProductionDatabaseUrl(undefined as unknown as string)).toThrow(
      /missing/i
    )
  })

  it("2. rejects staging URL", () => {
    const url = `postgresql://postgres.${STAGING_REF}:pass@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
    expect(() => runner.parseProductionDatabaseUrl(url)).toThrow(/staging/i)
  })

  it("3. rejects wrong project ref", () => {
    const url =
      "postgresql://postgres.notprodrefxxxxxxxx:pass@aws-1-eu-north-1.pooler.supabase.com:5432/postgres"
    expect(() => runner.parseProductionDatabaseUrl(url)).toThrow(/production ref/i)
  })

  it("4. rejects no versions", () => {
    expect(() => runner.parseCliArgs(["--dry-run"])).toThrow(/No migration versions/i)
  })

  it("5. rejects unordered versions", () => {
    expect(() => runner.parseCliArgs(["--dry-run", "539", "535"])).toThrow(/Unordered/i)
  })

  it("6. rejects duplicate versions", () => {
    expect(() => runner.parseCliArgs(["--dry-run", "535", "535"])).toThrow(/Duplicate/i)
  })

  it("7. rejects unknown version", () => {
    const dir = makeMigrationsDir({
      "535_ok.sql": "select 1;",
    })
    expect(() => runner.resolveMigrationFiles(["535", "537"], dir)).toThrow(/No migration file/i)
  })

  it("8. dry run performs no writes", async () => {
    const dir = makeMigrationsDir({
      "535_a.sql": "select 1;",
      "537_b.sql": "select 2;",
    })
    const { client, recorded, queries } = mockClient()
    const logs: string[] = []
    const logger = {
      trackSecret() {},
      log(line: string) {
        logs.push(line)
      },
    }

    const result = await runner.main(["--dry-run", "535", "537"], {
      env: { PRODUCTION_DATABASE_URL: prodUrl() },
      migrationsDir: dir,
      createClient: () => client,
      logger,
    })

    expect(result.wrote).toBe(false)
    expect(recorded.size).toBe(0)
    expect(queries.some((q) => /^BEGIN$/i.test(q.sql.trim()))).toBe(false)
    expect(queries.some((q) => /insert into supabase_migrations/i.test(q.sql))).toBe(false)
    expect(logs.some((l) => l.includes("dry-run=OK"))).toBe(true)
  })

  it("9. execution requires --execute-production", () => {
    expect(() => runner.parseCliArgs(["535"])).toThrow(/--dry-run|--execute-production/i)
  })

  it("10. failed migration is not recorded", async () => {
    const dir = makeMigrationsDir({
      "535_a.sql": "SELECT 'fail-marker';",
      "537_b.sql": "SELECT 2;",
    })
    const { client, recorded } = mockClient({ failOnSqlIncludes: "fail-marker" })
    const logger = { trackSecret() {}, log() {} }

    await expect(
      runner.main(["--execute-production", "535", "537"], {
        env: { PRODUCTION_DATABASE_URL: prodUrl() },
        migrationsDir: dir,
        createClient: () => client,
        logger,
        confirmProductionRef: async () => undefined,
        stdin: { isTTY: true } as NodeJS.ReadStream,
      })
    ).rejects.toThrow(/fail-marker/)

    expect(recorded.has("535")).toBe(false)
    expect(recorded.has("537")).toBe(false)
  })

  it("11. later migrations stop after failure", async () => {
    const dir = makeMigrationsDir({
      "535_a.sql": "SELECT 'fail-marker';",
      "537_b.sql": "SELECT 'should-not-run';",
      "539_c.sql": "SELECT 'also-not-run';",
    })
    const ran: string[] = []
    const { client, recorded } = mockClient({
      onQuery(sql) {
        if (sql.includes("fail-marker")) {
          ran.push("535")
          throw new Error("boom-535")
        }
        if (sql.includes("should-not-run")) ran.push("537")
        if (sql.includes("also-not-run")) ran.push("539")
        return undefined
      },
    })

    await expect(
      runner.main(["--execute-production", "535", "537", "539"], {
        env: { PRODUCTION_DATABASE_URL: prodUrl() },
        migrationsDir: dir,
        createClient: () => client,
        logger: { trackSecret() {}, log() {} },
        confirmProductionRef: async () => undefined,
        stdin: { isTTY: true } as NodeJS.ReadStream,
      })
    ).rejects.toThrow(/boom-535/)

    expect(ran).toEqual(["535"])
    expect([...recorded]).toEqual([])
  })

  it("12. only explicitly selected versions are recorded", async () => {
    const dir = makeMigrationsDir({
      "535_a.sql": "SELECT 1;",
      "536_sql_tests.sql": "SELECT 'test';",
      "537_b.sql": "SELECT 2;",
      "538_sql_tests.sql": "SELECT 'test2';",
      "539_c.sql": "SELECT 3;",
    })
    const { client, recorded } = mockClient()

    const result = await runner.main(["--execute-production", "535", "537", "539"], {
      env: { PRODUCTION_DATABASE_URL: prodUrl() },
      migrationsDir: dir,
      createClient: () => client,
      logger: { trackSecret() {}, log() {} },
      confirmProductionRef: async () => undefined,
      stdin: { isTTY: true } as NodeJS.ReadStream,
    })

    expect(result.applied).toEqual(["535", "537", "539"])
    expect([...recorded].sort()).toEqual(["535", "537", "539"])
    expect(recorded.has("536")).toBe(false)
    expect(recorded.has("538")).toBe(false)
  })

  it("13. password/URL never appear in logs", async () => {
    const pass = "SuperSecretPass99"
    const url = prodUrl({ pass })
    const dir = makeMigrationsDir({ "535_a.sql": "SELECT 1;" })
    const { client } = mockClient()
    const logs: string[] = []
    const logger = runner.createSafeLogger({
      write(chunk: string) {
        logs.push(chunk)
        return true
      },
    } as NodeJS.WritableStream)

    await runner.main(["--dry-run", "535"], {
      env: { PRODUCTION_DATABASE_URL: url },
      migrationsDir: dir,
      createClient: () => client,
      logger,
    })

    const joined = logs.join("")
    expect(joined).not.toContain(pass)
    expect(joined).not.toContain(url)
    expect(joined).not.toMatch(/postgresql:\/\/[^@\s]+:[^@\s]+@/i)
  })

  it("14. advisory lock is released after failure", async () => {
    const dir = makeMigrationsDir({
      "535_a.sql": "SELECT 'fail-marker';",
    })
    const { client } = mockClient({ failOnSqlIncludes: "fail-marker" })

    await expect(
      runner.main(["--execute-production", "535"], {
        env: { PRODUCTION_DATABASE_URL: prodUrl() },
        migrationsDir: dir,
        createClient: () => client,
        logger: { trackSecret() {}, log() {} },
        confirmProductionRef: async () => undefined,
        stdin: { isTTY: true } as NodeJS.ReadStream,
      })
    ).rejects.toThrow(/fail-marker/)

    expect(client.lockHeld).toBe(false)
  })

  it("15. skipped versions are never fabricated", async () => {
    const dir = makeMigrationsDir({
      "535_a.sql": "SELECT 1;",
      "537_b.sql": "SELECT 2;",
      "539_c.sql": "SELECT 3;",
    })
    const { client, recorded, queries } = mockClient()

    await runner.main(["--execute-production", "535", "537", "539"], {
      env: { PRODUCTION_DATABASE_URL: prodUrl() },
      migrationsDir: dir,
      createClient: () => client,
      logger: { trackSecret() {}, log() {} },
      confirmProductionRef: async () => undefined,
      stdin: { isTTY: true } as NodeJS.ReadStream,
    })

    const inserted = queries
      .filter((q) => /insert into supabase_migrations\.schema_migrations/i.test(q.sql))
      .map((q) => String(q.params?.[0]))
    expect(inserted).toEqual(["535", "537", "539"])
    expect(recorded.has("536")).toBe(false)
    expect(recorded.has("522")).toBe(false)
    expect(recorded.has("544")).toBe(false)
  })

  it("rejects host that is not production pooler/direct", () => {
    expect(() =>
      runner.parseProductionDatabaseUrl(
        `postgresql://postgres.${PRODUCTION_REF}:pass@evil.example.com:5432/postgres`
      )
    ).toThrow(/verified production/i)
  })

  it("rejects ambiguous numeric prefixes", () => {
    const dir = makeMigrationsDir({
      "535_a.sql": "select 1;",
      "535_b.sql": "select 2;",
    })
    expect(() => runner.resolveMigrationFiles(["535"], dir)).toThrow(/Multiple migration files/i)
  })

  it("rejects test migrations unless allowlisted", () => {
    const dir = makeMigrationsDir({
      "536_service_job_material_usage_return_sql_tests.sql": "select 1;",
    })
    expect(() => runner.resolveMigrationFiles(["536"], dir)).toThrow(/test migration/i)
  })
})
