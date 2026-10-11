import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { findUnsafeExampleViolations } from "../../lib/staging/stagingIsolation.ts"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const names = fs.readdirSync(root).filter((name) => name.startsWith(".env") && name.endsWith(".example"))
let failed = false

for (const name of names) {
  const content = fs.readFileSync(path.join(root, name), "utf8")
  const violations = findUnsafeExampleViolations(content)
  if (violations.length > 0) {
    failed = true
    console.error(`${name}: ${violations.join(", ")}`)
  }
}

if (failed) process.exit(1)
console.log(`Tracked env examples are free of JWT-shaped and live Paystack values (${names.length} file(s)).`)
