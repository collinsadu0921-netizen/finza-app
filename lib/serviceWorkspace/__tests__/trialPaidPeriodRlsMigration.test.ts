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
  "573_service_paid_period_entitlement.sql"
)

describe("573_service_paid_period_entitlement migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8")

  it("replaces the central write and min-tier helpers only", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.finza_business_can_write_service_records"
    )
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.finza_business_has_service_min_tier"
    )
    expect(sql).not.toMatch(/DROP POLICY/i)
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })

  it("enforces current_period_ends_at + 3 days as the paid grace cap", () => {
    expect(sql).toContain("current_period_ends_at")
    expect(sql).toContain("INTERVAL '3 days'")
    expect(sql).toMatch(/v_now < v_period_ends \+ INTERVAL '3 days'/)
    expect(sql).toMatch(/v_now >= v_period_ends \+ INTERVAL '3 days'/)
  })

  it("preserves billing_exempt, locked, and unpaid trial branches", () => {
    expect(sql).toContain("v_billing_exempt")
    expect(sql).toContain("v_status = 'locked'")
    expect(sql).toContain("v_subscription_started IS NULL")
    expect(sql).toContain("Stale unpaid expired trial")
  })

  it("documents that cron is not the sole security boundary", () => {
    expect(sql).toContain("paid-through boundary")
    expect(sql).toContain("capped at current_period_ends_at")
    expect(sql).toContain("not the sole security boundary")
  })

  it("does not newly lock legacy paid rows with a null period end", () => {
    expect(sql).toContain("v_subscription_started IS NOT NULL AND v_period_ends IS NOT NULL")
    expect(sql).toContain("current_period_ends_at IS NULL are not newly locked")
  })
})
