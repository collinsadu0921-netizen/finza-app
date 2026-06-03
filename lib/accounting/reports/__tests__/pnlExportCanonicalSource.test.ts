import fs from "fs"
import path from "path"

const REPO_ROOT = path.resolve(__dirname, "../../../..")

const EXPORT_ROUTE_FILES = [
  "app/api/accounting/reports/profit-and-loss/export/csv/route.ts",
  "app/api/accounting/reports/profit-and-loss/export/pdf/route.ts",
]

describe("P&L export routes use canonical getProfitAndLossReport", () => {
  for (const rel of EXPORT_ROUTE_FILES) {
    it(`${rel} does not call get_profit_and_loss_from_trial_balance`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
      expect(src).toContain("getProfitAndLossReport")
      expect(src).not.toContain("get_profit_and_loss_from_trial_balance")
    })
  }
})
