import { describe, it, expect } from "@jest/globals"
import fs from "fs"
import path from "path"

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "488_service_trial_readonly_rls_hardening.sql"
)

const PROTECTED_TABLES = [
  "expenses",
  "invoices",
  "payments",
  "bills",
  "bill_payments",
  "credit_notes",
  "estimates",
  "recurring_invoices",
  "assets",
  "vat_returns",
  "invoice_items",
  "estimate_items",
  "credit_note_items",
  "bill_items",
  "proforma_invoices",
  "proforma_invoice_items",
  "accounts",
  "journal_entries",
  "journal_entry_lines",
  "accounting_periods",
  "wht_remittances",
  "wht_remittance_bills",
  "cit_provisions",
]

const INTENTIONALLY_UNPROTECTED = [
  "businesses",
  "business_subscriptions",
  "subscription_payments",
  "payroll_runs",
  "recurring_invoice_items",
]

describe("488_service_trial_readonly_rls_hardening migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8")

  it("defines combined RLS write helper", () => {
    expect(sql).toContain("finza_service_trial_rls_can_write")
    expect(sql).toContain("finza_business_can_write_service_records")
    expect(sql).toContain("finza_user_can_access_business")
  })

  it.each(PROTECTED_TABLES)("protects writes on %s", (table) => {
    expect(sql).toMatch(new RegExp(`public\\.${table}|'${table}'`))
  })

  it("preserves SELECT while gating INSERT/UPDATE/DELETE", () => {
    expect(sql).toContain('FOR SELECT')
    expect(sql).toContain('FOR INSERT')
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('FOR DELETE')
  })

  it.each(INTENTIONALLY_UNPROTECTED)(
    "does not blanket-drop policies on %s (handled elsewhere or N/A)",
    (table) => {
      expect(sql).not.toMatch(
        new RegExp(`FOREACH t IN ARRAY tables[\\s\\S]*'${table}'`)
      )
    }
  )
})
