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
  "458_subscription_notification_events.sql"
)

describe("subscription_notification_events dedupe schema", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8")

  it("uniqueness includes event_type so the same period can emit grace-start and lock", () => {
    expect(sql).toContain(
      "UNIQUE (business_id, event_type, lifecycle_key, recipient_email)"
    )
    expect(sql).not.toMatch(
      /UNIQUE \(business_id,\s*lifecycle_key,\s*recipient_email\)/
    )
  })
})
