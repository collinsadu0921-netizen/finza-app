/**
 * Behavioral proof of deployed 573 helpers.
 * Runs the transactional staging SQL harness when credentials exist.
 * Skips in environments without staging DB access.
 */
import { describe, it } from "@jest/globals"
import { existsSync } from "fs"
import { resolve } from "path"
import { execFileSync } from "child_process"

const ROOT = resolve(__dirname, "../../..")
const SCRIPT = resolve(ROOT, "scripts/staging-573-paid-period-behavior.mjs")
const hasCreds =
  Boolean(process.env.SUPABASE_DB_PASSWORD) || existsSync(resolve(ROOT, ".env.staging"))

describe("573 PostgreSQL helper behavior", () => {
  const run = hasCreds ? it : it.skip

  run(
    "executes transactional write/tier cases against staging and rolls back",
    () => {
      execFileSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        stdio: "inherit",
        env: process.env,
      })
    },
    60_000
  )
})
