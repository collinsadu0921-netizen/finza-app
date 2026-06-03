# Report Route Classification: Track B1

**Date:** 2025-01-17 (classification); **source contract updated:** 2026-06  
**Purpose:** Enumerate all report routes and classify as CANONICAL or LEGACY  
**Current source contract:** See [docs/REPORTING_SOURCE_CONTRACT.md](docs/REPORTING_SOURCE_CONTRACT.md)

---

## TASK B1.1 — Report Route Enumeration

### Classification Rules

- **CANONICAL:** Route reads from `journal_entries`, `journal_entry_lines`, `trial_balance_snapshots`, or calls canonical database functions (`get_trial_balance_from_snapshot`, `get_profit_and_loss_movement`, `get_balance_sheet_as_of`, `get_cumulative_net_income_as_of`, etc.)
- **LEGACY:** Route reads directly from operational tables (`sales`, `invoices`, `payments`, `expenses`, `bills`, `credit_notes`, `registers`)

> **Note:** `get_profit_and_loss_from_trial_balance` and `get_balance_sheet_from_trial_balance` remain in the DB for historical/audit use. Live P&L and Balance Sheet routes use journal movement and cumulative ledger as-of respectively (Phase 2–3, 2026).

---

## Report Routes Classification

| Route | Source | Classification | Notes |
|-------|--------|----------------|-------|
| `/api/accounting/reports/trial-balance` | `trial_balance_snapshots` (via `get_trial_balance_from_snapshot`) | ✅ **CANONICAL** | Snapshot evidence |
| `/api/accounting/reports/profit-and-loss` | `journal_entries` / `journal_entry_lines` (via `get_profit_and_loss_movement`) | ✅ **CANONICAL** | Ledger period movement |
| `/api/accounting/reports/balance-sheet` | Ledger as-of + cumulative net income (via `getBalanceSheetReport`) | ✅ **CANONICAL** | Cumulative ledger as-of |
| `/api/accounting/reports/general-ledger` | `journal_entries`, `journal_entry_lines` | ✅ **CANONICAL** | Direct ledger queries |
| `/api/reports/trial-balance` | `trial_balance_snapshots` (via `get_trial_balance_from_snapshot`) | ✅ **CANONICAL** | Legacy wrapper |
| `/api/reports/profit-loss` | Same as accounting P&L (`getProfitAndLossReport`) | ✅ **CANONICAL** | Legacy wrapper |
| `/api/reports/balance-sheet` | Same as accounting BS (`getBalanceSheetReport`) | ✅ **CANONICAL** | Legacy wrapper |
| `/api/reports/aging` | `invoices`, `payments` | ❌ **LEGACY** | Operational outstanding |
| `/api/reports/tax-summary` | `invoices`, `expenses`, `bills`, `sales`, `credit_notes` | ❌ **LEGACY** | Operational tax aggregation |
| `/api/reports/cash-office` | `sales`, `registers`, `cashier_sessions` | ❌ **LEGACY** | Operational cash office |
| `/api/reports/sales-summary` | `invoices`, `credit_notes` | ❌ **LEGACY** | Operational invoice summary |

---

## Summary

- **CANONICAL Routes:** 7 routes
  - All `/api/accounting/reports/*` routes (4)
  - 3 `/api/reports/*` routes that use canonical functions (trial-balance, profit-loss, balance-sheet)

- **LEGACY Routes:** 4 routes
  - `/api/reports/aging` - Outstanding invoices
  - `/api/reports/tax-summary` - Tax aggregation
  - `/api/reports/cash-office` - Cash office operations
  - `/api/reports/sales-summary` - Invoice summary

---

## Evidence Sources

- Route files: `app/api/reports/*/route.ts`
- Route files: `app/api/accounting/reports/*/route.ts`
- Reporting contract: `docs/REPORTING_SOURCE_CONTRACT.md`
- Grep results: `.from\(["'](sales|invoices|payments|registers)`
