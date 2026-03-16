#!/usr/bin/env node
/**
 * TRACK B1.3: Report Bypass Detection Script
 * 
 * Scans report routes and flags any route that:
 * - Reads from operational tables (sales, invoices, payments, registers, etc.)
 * - Is not explicitly marked as LEGACY in the code
 * 
 * Exit code: 0 if all routes compliant, 1 if violations found
 */

import * as fs from "fs"
import * as path from "path"

const REPORT_ROUTES_DIR = path.join(__dirname, "..", "app", "api", "reports")
const ACCOUNTING_REPORT_ROUTES_DIR = path.join(__dirname, "..", "app", "api", "accounting", "reports")

// Operational tables that should not be read by report routes
const OPERATIONAL_TABLES = [
  "sales",
  "invoices",
  "payments",
  "expenses",
  "bills",
  "credit_notes",
  "registers",
  "cashier_sessions",
  "cash_drops",
  "register_variances",
  "overrides",
]

// Ledger/canonical tables (allowed)
const CANONICAL_TABLES = [
  "journal_entries",
  "journal_entry_lines",
  "trial_balance_snapshots",
  "period_opening_balances",
  "accounting_periods",
  "accounts",
]

// Canonical functions (routes using these are compliant)
const CANONICAL_FUNCTIONS = [
  "get_trial_balance_from_snapshot",
  "get_profit_and_loss_from_trial_balance",
  "get_balance_sheet_from_trial_balance",
  "get_general_ledger",
  "generate_trial_balance",
]

interface RouteViolation {
  route: string
  file: string
  reason: string
  line?: number
}

const violations: RouteViolation[] = []

/**
 * Check if a file contains references to operational tables
 */
function checkFileForOperationalTables(filePath: string): RouteViolation[] {
  const content = fs.readFileSync(filePath, "utf-8")
  const routePath = filePath
    .replace(path.join(__dirname, ".."), "")
    .replace(/\\/g, "/")
    .replace("/app/api", "")

  const fileViolations: RouteViolation[] = []
  const lines = content.split("\n")

  // Check if route uses canonical functions (compliant)
  const usesCanonicalFunction = CANONICAL_FUNCTIONS.some((fn) =>
    content.includes(fn)
  )

  // Check if route is explicitly marked as LEGACY (has legacy_ok guard)
  const hasLegacyGuard = content.includes('legacy_ok') || content.includes('LEGACY ROUTE')

  // Check for operational table references
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Skip comments
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
      continue
    }

    // Check for .from("operational_table") patterns
    for (const table of OPERATIONAL_TABLES) {
      const pattern = new RegExp(`\\.from\\(["']${table}["']\\)`, "i")
      if (pattern.test(line)) {
        // If route uses canonical function, it's compliant (may read operational for enrichment only)
        if (!usesCanonicalFunction && !hasLegacyGuard) {
          fileViolations.push({
            route: routePath,
            file: filePath,
            reason: `Reads from operational table: ${table}`,
            line: lineNum,
          })
        }
      }
    }
  }

  return fileViolations
}

/**
 * Recursively find all route.ts files in a directory
 */
function findRouteFiles(dir: string): string[] {
  const files: string[] = []

  if (!fs.existsSync(dir)) {
    return files
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...findRouteFiles(fullPath))
    } else if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Main detection logic
 */
function main() {
  console.log("TRACK B1.3: Scanning report routes for operational table reads...\n")

  // Find all report route files
  const reportRouteFiles = findRouteFiles(REPORT_ROUTES_DIR)
  const accountingRouteFiles = findRouteFiles(ACCOUNTING_REPORT_ROUTES_DIR)

  const allRouteFiles = [...reportRouteFiles, ...accountingRouteFiles]

  console.log(`Found ${allRouteFiles.length} report route files\n`)

  // Check each file
  for (const file of allRouteFiles) {
    const fileViolations = checkFileForOperationalTables(file)
    violations.push(...fileViolations)
  }

  // Report results
  if (violations.length === 0) {
    console.log("✅ All report routes are compliant")
    console.log("   - All routes either use canonical functions or are explicitly marked as LEGACY\n")
    process.exit(0)
  } else {
    console.error("❌ Found report routes that read operational tables without LEGACY guard:\n")

    for (const violation of violations) {
      console.error(`  Route: ${violation.route}`)
      console.error(`  File: ${violation.file}`)
      console.error(`  Reason: ${violation.reason}`)
      if (violation.line) {
        console.error(`  Line: ${violation.line}`)
      }
      console.error("")
    }

    console.error(
      "ERROR: New report routes must be ledger-based or explicitly marked legacy."
    )
    console.error(
      "\nTo mark a route as LEGACY, add a guard requiring ?legacy_ok=1 parameter."
    )
    console.error(
      "See REPORT_ROUTE_CLASSIFICATION.md for list of LEGACY routes.\n"
    )

    process.exit(1)
  }
}

// Run detection
main()
