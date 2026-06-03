/**
 * Balance Sheet export canonical source — export routes must use getBalanceSheetReport.
 */

import fs from "fs"
import path from "path"
import {
  parseBalanceSheetReportQuery,
  toBalanceSheetExportView,
} from "../balanceSheetExportHelpers"
import type { BalanceSheetReportResponse } from "../getBalanceSheetReport"

const REPO_ROOT = path.resolve(__dirname, "../../../..")

const EXPORT_ROUTE_FILES = [
  "app/api/accounting/reports/balance-sheet/export/csv/route.ts",
  "app/api/accounting/reports/balance-sheet/export/pdf/route.ts",
  "app/api/accounting/afs/runs/[id]/export/pdf/route.ts",
]

describe("Balance Sheet export routes use canonical helper", () => {
  for (const rel of EXPORT_ROUTE_FILES) {
    it(`${rel} imports getBalanceSheetReport and not snapshot BS RPC`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
      expect(src).toContain("getBalanceSheetReport")
      expect(src).not.toContain("get_balance_sheet_from_trial_balance")
    })
  }
})

describe("parseBalanceSheetReportQuery", () => {
  it("maps start_date + end_date to report input without as_of_date", () => {
    const params = new URLSearchParams({
      start_date: "2026-01-01",
      end_date: "2026-06-30",
    })
    const input = parseBalanceSheetReportQuery("biz-001", params)
    expect(input.start_date).toBe("2026-01-01")
    expect(input.end_date).toBe("2026-06-30")
    expect(input.as_of_date).toBeUndefined()
  })

  it("passes as_of_date when no custom range", () => {
    const params = new URLSearchParams({ as_of_date: "2026-03-15" })
    const input = parseBalanceSheetReportQuery("biz-001", params)
    expect(input.as_of_date).toBe("2026-03-15")
    expect(input.start_date).toBeUndefined()
    expect(input.end_date).toBeUndefined()
  })
})

describe("toBalanceSheetExportView", () => {
  const mockReport: BalanceSheetReportResponse = {
    period: {
      period_id: "p1",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      resolution_reason: "exact_match",
    },
    currency: { code: "GHS", symbol: "₵", name: "Ghana Cedi" },
    as_of_date: "2026-12-31",
    business_type: "limited_company",
    sections: [
      {
        key: "assets",
        label: "Assets",
        groups: [
          {
            key: "current_assets",
            label: "Current Assets",
            lines: [{ account_id: "a1", account_code: "1010", account_name: "Bank", amount: 100 }],
            subtotal: 100,
          },
        ],
        subtotal: 100,
      },
      {
        key: "liabilities",
        label: "Liabilities",
        groups: [
          {
            key: "current_liabilities",
            label: "Current Liabilities",
            lines: [{ account_id: "l1", account_code: "2000", account_name: "AP", amount: 30 }],
            subtotal: 30,
          },
        ],
        subtotal: 30,
      },
      {
        key: "equity",
        label: "Equity",
        groups: [
          {
            key: "equity",
            label: "Equity",
            lines: [
              { account_id: "e1", account_code: "3000", account_name: "Capital", amount: 50 },
              {
                account_id: "__net_income__",
                account_code: "",
                account_name: "Net Income (cumulative)",
                amount: 20,
              },
            ],
            subtotal: 70,
          },
        ],
        subtotal: 70,
      },
    ],
    totals: {
      assets: 100,
      liabilities: 30,
      equity: 50,
      liabilities_plus_equity: 100,
      is_balanced: true,
      imbalance: 0,
    },
    telemetry: {
      resolved_period_reason: "exact_match",
      resolved_period_start: "2026-01-01",
      resolved_period_end: "2026-12-31",
      source: "ledger",
      version: 2,
    },
  }

  it("exposes export totals matching canonical report", () => {
    const view = toBalanceSheetExportView(mockReport)
    expect(view.totals.assets).toBe(100)
    expect(view.totals.liabilities).toBe(30)
    expect(view.totals.liabilities_plus_equity).toBe(100)
    expect(view.totals.is_balanced).toBe(true)
    expect(view.totals.imbalance).toBe(0)
    expect(view.adjustedEquity).toBe(70)
    expect(view.cumulativeNetIncome).toBe(20)
    expect(view.assetLines).toHaveLength(1)
    expect(view.equityLines).toHaveLength(2)
  })
})
