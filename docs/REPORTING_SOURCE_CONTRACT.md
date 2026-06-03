# Finza reporting source contract

**Last updated:** 2026-06  
**Scope:** Live application reporting paths (not historical migrations or audit snapshots).

---

## Summary

| Report | Live source | DB / app entry point |
|--------|-------------|----------------------|
| **Trial Balance** | Period snapshot evidence | `get_trial_balance_from_snapshot(p_period_id)` → `trial_balance_snapshots` |
| **Profit & Loss** | Journal movement in date range | `get_profit_and_loss_movement(business_id, start, end)` via `getProfitAndLossReport` |
| **Balance Sheet** | Cumulative ledger as-of | `get_balance_sheet_as_of` + `get_cumulative_net_income_as_of` via `getBalanceSheetReport` |
| **Cash Flow** (net income line) | Canonical P&L net profit | `fetchCanonicalPnLNetProfit` → `getProfitAndLossReport` |
| **Equity Changes** (profit for period) | Canonical P&L net profit | `fetchCanonicalPnLNetProfit` → `getProfitAndLossReport` |
| **AFS PDF — P&L section** | Canonical P&L | `getProfitAndLossReport` + `toPnLExportView` |
| **AFS PDF — Balance Sheet** | Canonical BS | `getBalanceSheetReport` |
| **AFS PDF — Trial Balance** | Snapshot evidence | `get_trial_balance_snapshot` |

---

## Principles

1. **Trial Balance snapshots are valid.** They provide stable period evidence (opening, debits, credits, closing) for audit and reconciliation. Do not remove snapshot generation or `get_trial_balance_from_snapshot`.

2. **P&L is movement, not closing balance.** Income/revenue = Σ(credit − debit); expense = Σ(debit − credit) for journal entries dated inclusively between `start_date` and `end_date`.

3. **Balance Sheet is cumulative as-of.** Position accounts use ledger balances as-of `end_date`; equity includes cumulative net income through that date.

4. **Dependent reports share one net profit.** Cash Flow, Equity Changes, and AFS PDF P&L use the same canonical P&L movement path for net income / net profit.

5. **Legacy DB functions remain in history.** `get_profit_and_loss_from_trial_balance` and `get_balance_sheet_from_trial_balance` exist in migrations and may appear in bypass-detection allowlists. They are **not** the live canonical source for P&L or Balance Sheet in the application.

---

## Period resolution

- **`period_id` / `period_start`:** Resolve accounting period; use `period_start` through `period_end`.
- **`start_date` + `end_date`:** Use the exact supplied range (no summing month-end closings).
- **AFS run:** Use the run’s `period_start` and `period_end`.

---

## Related verification

- `scripts/verify-pnl-movement.sql` — P&L movement RPC vs direct journal aggregation
- `scripts/verify-pnl-dependent-reports.sql` — canonical net profit alignment for dependent reports
