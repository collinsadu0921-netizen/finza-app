/**
 * Guards against regression to the 489 join bug (accounts-first LEFT JOIN).
 */

import fs from "fs"
import path from "path"

const REPO_ROOT = path.resolve(__dirname, "../../../..")

describe("490_fix_profit_and_loss_movement_join migration", () => {
  const fixMigration = fs.readFileSync(
    path.join(REPO_ROOT, "supabase/migrations/490_fix_profit_and_loss_movement_join.sql"),
    "utf8"
  )

  it("uses journal_entries-first inner join shape", () => {
    expect(fixMigration).toMatch(/FROM journal_entries je/i)
    expect(fixMigration).toMatch(/JOIN journal_entry_lines jel/i)
    expect(fixMigration).toMatch(/JOIN accounts a/i)
    expect(fixMigration).not.toMatch(/FROM accounts a[\s\S]*LEFT JOIN journal_entry_lines/i)
  })

  it("489 migration documents the buggy shape (unchanged historical record)", () => {
    const orig = fs.readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/489_get_profit_and_loss_movement.sql"),
      "utf8"
    )
    expect(orig).toMatch(/FROM accounts a/i)
    expect(orig).toMatch(/LEFT JOIN journal_entry_lines/i)
  })
})
