/**
 * Guard: future invoice postings use neutral Sales revenue wording (migration 551).
 */
import { describe, it, expect } from "@jest/globals"
import { readFileSync } from "fs"
import { resolve } from "path"

describe("invoice sales revenue wording (migration 551)", () => {
  it("replaces Service revenue with Sales revenue for future postings", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/551_invoice_sales_revenue_wording.sql"),
      "utf8"
    )
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION post_invoice_to_ledger/)
    expect(sql).toMatch(/'Sales revenue'/)
    expect(sql).not.toMatch(/'Service revenue'/)
    expect(sql).toMatch(/Historical journal_entry_lines keep/i)
  })
})
