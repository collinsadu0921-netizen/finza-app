/**
 * Phase 3: dependent reports must use canonical P&L movement for net profit.
 */

import fs from "fs"
import path from "path"

const REPO_ROOT = path.resolve(__dirname, "../../../..")

const CANONICAL_NET_PROFIT_FILES = [
  "lib/accounting/reports/getCashFlowReport.ts",
  "lib/accounting/reports/getEquityChangesReport.ts",
  "app/api/accounting/afs/runs/[id]/export/pdf/route.ts",
]

describe("Phase 3 — net profit uses canonical P&L movement", () => {
  for (const rel of CANONICAL_NET_PROFIT_FILES) {
    it(`${rel} does not call get_profit_and_loss_from_trial_balance`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
      expect(src).not.toContain("get_profit_and_loss_from_trial_balance")
    })
  }

  it("getCashFlowReport uses fetchCanonicalPnLNetProfit", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "lib/accounting/reports/getCashFlowReport.ts"),
      "utf8"
    )
    expect(src).toContain("fetchCanonicalPnLNetProfit")
  })

  it("getEquityChangesReport uses fetchCanonicalPnLNetProfit", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "lib/accounting/reports/getEquityChangesReport.ts"),
      "utf8"
    )
    expect(src).toContain("fetchCanonicalPnLNetProfit")
  })

  it("AFS PDF uses getProfitAndLossReport", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "app/api/accounting/afs/runs/[id]/export/pdf/route.ts"),
      "utf8"
    )
    expect(src).toContain("getProfitAndLossReport")
  })
})
