# Report Route Classification: Track B1

**Date:** 2025-01-17  
**Purpose:** Enumerate all report routes and classify as CANONICAL or LEGACY  
**Scope:** READ-ONLY (no code changes)

---

## TASK B1.1 — Report Route Enumeration

### Classification Rules

- **CANONICAL:** Route reads from `journal_entries`, `journal_entry_lines`, `trial_balance_snapshots`, or calls canonical database functions (`get_trial_balance_from_snapshot`, `get_profit_and_loss_from_trial_balance`, `get_balance_sheet_from_trial_balance`)
- **LEGACY:** Route reads directly from operational tables (`sales`, `invoices`, `payments`, `expenses`, `bills`, `credit_notes`, `registers`)

---

## Report Routes Classification

| Route | Source Tables | Classification | Notes |
|-------|---------------|----------------|-------|
| `/api/accounting/reports/trial-balance` | `trial_balance_snapshots` (via `get_trial_balance_from_snapshot`) | ✅ **CANONICAL** | Ledger-derived snapshot |
| `/api/accounting/reports/profit-and-loss` | `trial_balance_snapshots` (via `get_profit_and_loss_from_trial_balance`) | ✅ **CANONICAL** | Ledger-derived snapshot |
| `/api/accounting/reports/balance-sheet` | `trial_balance_snapshots` (via `get_balance_sheet_from_trial_balance`) | ✅ **CANONICAL** | Ledger-derived snapshot |
| `/api/accounting/reports/general-ledger` | `journal_entries`, `journal_entry_lines` | ✅ **CANONICAL** | Direct ledger queries |
| `/api/reports/trial-balance` | `trial_balance_snapshots` (via `get_trial_balance_from_snapshot`) | ✅ **CANONICAL** | Legacy wrapper, uses canonical function |
| `/api/reports/profit-loss` | `trial_balance_snapshots` (via `get_profit_and_loss_from_trial_balance`) | ✅ **CANONICAL** | Legacy wrapper, uses canonical function |
| `/api/reports/balance-sheet` | `trial_balance_snapshots` (via `get_balance_sheet_from_trial_balance`) | ✅ **CANONICAL** | Legacy wrapper, uses canonical function |
| `/api/reports/aging` | `invoices`, `payments` | ❌ **LEGACY** | Reads operational tables for outstanding calculation |
| `/api/reports/tax-summary` | `invoices`, `expenses`, `bills`, `sales`, `credit_notes` | ❌ **LEGACY** | Reads operational tables for tax aggregation |
| `/api/reports/cash-office` | `sales`, `registers`, `cashier_sessions` | ❌ **LEGACY** | Reads operational tables for cash office report |
| `/api/reports/sales-summary` | `invoices`, `credit_notes` | ❌ **LEGACY** | Reads operational tables for invoice summary |

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
- Grep results: `.from\(["'](sales|invoices|payments|registers)`
