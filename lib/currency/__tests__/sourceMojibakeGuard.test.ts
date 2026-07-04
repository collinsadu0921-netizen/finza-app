import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { MOJIBAKE_GHS_CEDI } from "../normalizeCurrencySymbol"

const ROOT = join(__dirname, "..", "..", "..")

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "coverage",
])

const ALLOWLIST = new Set([
  "lib/currency/normalizeCurrencySymbol.ts",
  "lib/currency/__tests__/normalizeCurrencySymbol.test.ts",
  "lib/currency/__tests__/ghsDocumentRendering.test.ts",
  "lib/currency/__tests__/sourceMojibakeGuard.test.ts",
])

const SCAN_DIRS = ["app", "components", "lib", "supabase/migrations"]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx|js|jsx|html|sql)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe("source mojibake guard", () => {
  it("does not contain hardcoded Latin-1 cedi mojibake outside allowlist", () => {
    const offenders: string[] = []

    for (const scanDir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, scanDir))) {
        const rel = relative(ROOT, file).replace(/\\/g, "/")
        if (ALLOWLIST.has(rel)) continue
        if (rel.includes("__tests__/") && rel.endsWith(".test.ts")) continue

        const text = readFileSync(file, "utf8")
        if (text.includes(MOJIBAKE_GHS_CEDI)) {
          offenders.push(rel)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
