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
  "491_restore_invoice_read_rls.sql"
)

describe("491_restore_invoice_read_rls migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8")

  it("adds SELECT policy on invoices with tenant helper and soft-delete guard", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "service trial read select" ON public.invoices')
    expect(sql).toMatch(
      /CREATE POLICY "service trial read select" ON public\.invoices[\s\S]*FOR SELECT/
    )
    expect(sql).toContain("finza_user_can_access_business(invoices.business_id)")
    expect(sql).toContain("invoices.deleted_at IS NULL")
  })

  it("adds SELECT policy on invoice_items via parent invoice", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "service trial read select" ON public.invoice_items')
    expect(sql).toMatch(
      /CREATE POLICY "service trial read select" ON public\.invoice_items[\s\S]*FOR SELECT/
    )
    expect(sql).toContain("FROM public.invoices i")
    expect(sql).toContain("finza_user_can_access_business(i.business_id)")
    expect(sql).toContain("i.deleted_at IS NULL")
  })

  it("does not modify write policies", () => {
    expect(sql).not.toMatch(/FOR INSERT/i)
    expect(sql).not.toMatch(/FOR UPDATE/i)
    expect(sql).not.toMatch(/FOR DELETE/i)
  })
})
