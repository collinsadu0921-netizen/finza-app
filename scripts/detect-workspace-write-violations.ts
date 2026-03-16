#!/usr/bin/env node
/**
 * TRACK B2.3: Workspace Write Isolation Detection Script
 * 
 * Scans accounting routes and flags any route that:
 * - Writes to operational tables (sales, invoices, payments, expenses, bills, etc.)
 * - Is not explicitly marked as EXCEPTION with TRACK B2 comment
 * 
 * Exit code: 0 if all routes compliant, 1 if violations found
 */

import * as fs from "fs"
import * as path from "path"

const ACCOUNTING_ROUTES_DIR = path.join(__dirname, "..", "app", "api", "accounting")

// Operational tables that should not be written to by Accounting routes (unless EXCEPTION)
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
  "products",
  "products_stock",
  "stock_movements",
  "customers",
  "vendors",
]

// EXCEPTION tables (allowed but must be explicitly documented)
const EXCEPTION_TABLES = [
  "firm_client_engagements",
  "opening_balance_imports",
]

// Ledger/control tables (allowed)
const ALLOWED_TABLES = [
  "journal_entries",
  "journal_entry_lines",
  "trial_balance_snapshots",
  "opening_balance_batches",
  "accounting_periods",
  "accounting_period_actions",
  "accounting_firms",
  "manual_journal_drafts",
  "accounting_firm_activity_logs",
  "accounting_firm_users",
  "accounts",
]

interface WriteViolation {
  route: string
  file: string
  table: string
  operation: string
  line?: number
  reason: string
}

const violations: WriteViolation[] = []

/**
 * Check if a file contains writes to operational tables without EXCEPTION comment
 */
function checkFileForOperationalWrites(filePath: string): WriteViolation[] {
  const content = fs.readFileSync(filePath, "utf-8")
  const routePath = filePath
    .replace(path.join(__dirname, ".."), "")
    .replace(/\\/g, "/")
    .replace("/app/api", "")

  const fileViolations: WriteViolation[] = []
  const lines = content.split("\n")

  // Check for write operations (.insert, .update, .upsert, .delete)
  const writePatterns = [
    { pattern: /\.insert\(/g, operation: "INSERT" },
    { pattern: /\.update\(/g, operation: "UPDATE" },
    { pattern: /\.upsert\(/g, operation: "UPSERT" },
    { pattern: /\.delete\(/g, operation: "DELETE" },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Skip comments
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
      continue
    }

    // Check for write operations
    for (const writePattern of writePatterns) {
      if (writePattern.pattern.test(line)) {
        // Find the table name (look backwards from .insert/update/etc for .from("table_name"))
        // Check lines before this one for .from() pattern
        let tableName: string | null = null
        for (let j = Math.max(0, i - 5); j < i; j++) {
          const prevLine = lines[j]
          const fromMatch = prevLine.match(/\.from\(["']([\w_]+)["']\)/)
          if (fromMatch) {
            tableName = fromMatch[1]
            break
          }
        }

        // If no .from() found in previous lines, check current line
        if (!tableName) {
          const fromMatch = line.match(/\.from\(["']([\w_]+)["']\)/)
          if (fromMatch) {
            tableName = fromMatch[1]
          }
        }

        if (tableName) {
          // Check if it's an operational table
          if (OPERATIONAL_TABLES.includes(tableName)) {
            // Check if there's a TRACK B2 EXCEPTION comment before this write
            let hasExceptionComment = false
            for (let j = Math.max(0, i - 10); j < i; j++) {
              const prevLine = lines[j]
              if (
                prevLine.includes("TRACK B2") &&
                prevLine.includes("EXCEPTION") &&
                prevLine.includes(tableName)
              ) {
                hasExceptionComment = true
                break
              }
            }

            if (!hasExceptionComment) {
              fileViolations.push({
                route: routePath,
                file: filePath,
                table: tableName,
                operation: writePattern.operation,
                line: lineNum,
                reason: `Writes to operational table '${tableName}' without TRACK B2 EXCEPTION comment`,
              })
            }
          } else if (EXCEPTION_TABLES.includes(tableName)) {
            // EXCEPTION table - check if explicitly documented
            let hasExceptionComment = false
            for (let j = Math.max(0, i - 10); j < i; j++) {
              const prevLine = lines[j]
              if (
                prevLine.includes("TRACK B2") &&
                prevLine.includes("EXCEPTION") &&
                prevLine.includes(tableName)
              ) {
                hasExceptionComment = true
                break
              }
            }

            if (!hasExceptionComment) {
              fileViolations.push({
                route: routePath,
                file: filePath,
                table: tableName,
                operation: writePattern.operation,
                line: lineNum,
                reason: `EXCEPTION table '${tableName}' written to without TRACK B2 EXCEPTION comment`,
              })
            }
          }
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
  console.log("TRACK B2.3: Scanning accounting routes for operational table writes...\n")

  // Find all accounting route files
  const accountingRouteFiles = findRouteFiles(ACCOUNTING_ROUTES_DIR)

  console.log(`Found ${accountingRouteFiles.length} accounting route files\n`)

  // Check each file
  for (const file of accountingRouteFiles) {
    const fileViolations = checkFileForOperationalWrites(file)
    violations.push(...fileViolations)
  }

  // Report results
  if (violations.length === 0) {
    console.log("✅ All accounting routes are compliant")
    console.log(
      "   - No operational table writes found without TRACK B2 EXCEPTION comments\n"
    )
    process.exit(0)
  } else {
    console.error(
      "❌ Found accounting routes writing to operational tables without EXCEPTION guards:\n"
    )

    for (const violation of violations) {
      console.error(`  Route: ${violation.route}`)
      console.error(`  File: ${violation.file}`)
      console.error(`  Table: ${violation.table}`)
      console.error(`  Operation: ${violation.operation}`)
      console.error(`  Reason: ${violation.reason}`)
      if (violation.line) {
        console.error(`  Line: ${violation.line}`)
      }
      console.error("")
    }

    console.error(
      "ERROR: Accounting workspace must not write to operational tables without explicit EXCEPTION."
    )
    console.error(
      "\nTo mark a write as EXCEPTION, add a TRACK B2 EXCEPTION comment before the write operation."
    )
    console.error(
      "See ACCOUNTING_WRITE_TARGETS_CLASSIFICATION.md for EXCEPTION documentation.\n"
    )

    process.exit(1)
  }
}

// Run detection
main()
