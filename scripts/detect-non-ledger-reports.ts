#!/usr/bin/env ts-node
/**
 * CI Script: Detect Non-Ledger Report Aggregations
 * 
 * Fails build if:
 * 1. Any report endpoint aggregates from non-ledger tables
 * 2. Any SUM() is executed outside journal tables
 * 
 * Target directories:
 * - /api/reports/**
 * - /app/reports/**
 * - /analytics/**
 */

import * as fs from "fs"
import * as path from "path"

// Ledger tables (allowed)
const LEDGER_TABLES = [
  "journal_entries",
  "journal_entry_lines",
  "accounts",
  "trial_balance_snapshots",
  "period_account_snapshots",
  "period_opening_balances",
]

// Non-ledger tables (forbidden in reports)
const NON_LEDGER_TABLES = [
  "sales",
  "sale_items",
  "invoices",
  "payments",
  "credit_notes",
  "expenses",
  "bills",
  "registers",
  "cashier_sessions",
  "products",
  "categories",
]

// Report directories to check
const REPORT_DIRS = [
  "app/api/reports",
  "app/reports",
  "app/admin/retail/analytics",
  "app/analytics",
]

interface Violation {
  file: string
  line: number
  type: "non_ledger_aggregation" | "sum_outside_journal"
  message: string
}

function findReportFiles(): string[] {
  const files: string[] = []
  
  function walkDir(dir: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList
    
    const files = fs.readdirSync(dir)
    
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      
      if (stat.isDirectory()) {
        walkDir(filePath, fileList)
      } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
        fileList.push(filePath)
      }
    }
    
    return fileList
  }
  
  for (const dir of REPORT_DIRS) {
    const fullPath = path.join("finza-web", dir)
    if (fs.existsSync(fullPath)) {
      const dirFiles = walkDir(fullPath)
      files.push(...dirFiles)
    }
  }
  
  return files
}

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = []
  const content = fs.readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  
  // Skip files with hard guards (already blocked)
  if (content.includes("LEDGER_ONLY_REPORT_REQUIRED") || 
      content.includes("HARD GUARD") ||
      content.includes("This report has been deprecated")) {
    return violations
  }
  
  // Check for non-ledger table aggregations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    
    // Check for .from() calls with non-ledger tables
    for (const table of NON_LEDGER_TABLES) {
      // Match patterns like: .from("sales"), .from('sales'), .from(`sales`)
      const fromPattern = new RegExp(`\\.from\\(["'\`]${table}["'\`]\\)`, "i")
      if (fromPattern.test(line)) {
        // Check if this is followed by aggregation (reduce, sum, etc.)
        const nextLines = lines.slice(i, Math.min(i + 20, lines.length)).join("\n")
        if (/\b(reduce|sum|total|aggregate|SUM|COUNT|AVG|MAX|MIN)\b/i.test(nextLines)) {
          violations.push({
            file: filePath,
            line: lineNum,
            type: "non_ledger_aggregation",
            message: `Report aggregates from non-ledger table "${table}". Use journal_entry_lines instead.`,
          })
        }
      }
    }
    
    // Check for SUM() operations outside journal tables
    if (/\bSUM\s*\(/i.test(line) || /\b\.reduce\s*\(/i.test(line)) {
      // Check if this is in a report file and not using journal tables
      const context = lines.slice(Math.max(0, i - 5), Math.min(i + 10, lines.length)).join("\n")
      const usesLedgerTable = LEDGER_TABLES.some(table => 
        new RegExp(`\\.from\\(["'\`]${table}["'\`]\\)`, "i").test(context)
      )
      
      if (!usesLedgerTable && !context.includes("journal_entry")) {
        // Check if it's aggregating operational data
        const hasOperationalTable = NON_LEDGER_TABLES.some(table =>
          new RegExp(`\\.from\\(["'\`]${table}["'\`]\\)`, "i").test(context)
        )
        
        if (hasOperationalTable) {
          violations.push({
            file: filePath,
            line: lineNum,
            type: "sum_outside_journal",
            message: `SUM() or reduce() used on non-ledger table. Use journal_entry_lines for aggregations.`,
          })
        }
      }
    }
    
    // Check for patterns like: invoices.reduce, sales.reduce, payments.reduce
    for (const table of NON_LEDGER_TABLES) {
      const reducePattern = new RegExp(`\\b${table}\\s*\\.(reduce|forEach|map)\\s*\\(`, "i")
      if (reducePattern.test(line)) {
        // Check if it's calculating totals
        const nextLines = lines.slice(i, Math.min(i + 10, lines.length)).join("\n")
        if (/\b(sum|total|amount|outstanding|revenue|tax)\b/i.test(nextLines)) {
          violations.push({
            file: filePath,
            line: lineNum,
            type: "non_ledger_aggregation",
            message: `Report calculates totals from "${table}" table. Use journal_entry_lines instead.`,
          })
        }
      }
    }
  }
  
  return violations
}

function main() {
  console.log("🔍 Checking for non-ledger report aggregations...\n")
  
  const reportFiles = findReportFiles()
  console.log(`Found ${reportFiles.length} report files to check\n`)
  
  const allViolations: Violation[] = []
  
  for (const file of reportFiles) {
    const violations = checkFile(file)
    allViolations.push(...violations)
  }
  
  if (allViolations.length > 0) {
    console.error("❌ VIOLATIONS DETECTED:\n")
    
    // Group by file
    const byFile = new Map<string, Violation[]>()
    for (const v of allViolations) {
      const relPath = path.relative("finza-web", v.file)
      if (!byFile.has(relPath)) {
        byFile.set(relPath, [])
      }
      byFile.get(relPath)!.push(v)
    }
    
    const fileEntries = Array.from(byFile.entries())
    for (const [file, violations] of fileEntries) {
      console.error(`\n📄 ${file}:`)
      for (const v of violations) {
        console.error(`  Line ${v.line}: ${v.message}`)
        console.error(`  Type: ${v.type}`)
      }
    }
    
    console.error(`\n\n❌ Build failed: ${allViolations.length} violation(s) found`)
    console.error("\n💡 Fix: Replace operational table aggregations with journal_entry_lines queries")
    console.error("   Example: Use SUM(journal_entry_lines.credit) instead of SUM(payments.amount)\n")
    
    process.exit(1)
  } else {
    console.log("✅ No violations found. All reports use ledger tables for aggregations.\n")
    process.exit(0)
  }
}

if (require.main === module) {
  main()
}
