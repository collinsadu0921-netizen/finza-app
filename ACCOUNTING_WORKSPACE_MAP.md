# Accounting Workspace Map

**Audit type:** Principal accounting systems architect — AUDIT + ORIENTATION pass.  
**Scope:** Accounting workspace only. No refactors, no fixes, evidence only.  
**Authority:** `lib/accountingWorkspace.ts` — `WORKSPACE = 'ACCOUNTING'`.

---

## Step 1 — Accounting Workspace Inventory

Scan limited to **Accounting workspace** features. Evidence from codebase scan.

| Feature | UI Page | API Route | Ledger Writes | Period Authority |
|---------|---------|-----------|---------------|-------------------|
| **General Ledger** | `app/accounting/reports/general-ledger/page.tsx` | `GET /api/accounting/reports/general-ledger` (business_id, account_id, period_start or start_date/end_date) | — | Reads ledger via `get_general_ledger` / `get_general_ledger_paginated`; period optional (date range allowed) |
| **Ledger (journal list)** | `app/accounting/ledger/page.tsx` | `GET /api/ledger/list` (not under /api/accounting) | — | Read-only list of journal entries |
| **Accounting Periods** | `app/accounting/periods/page.tsx` | `GET /api/accounting/periods`, `POST /api/accounting/periods/close`, `GET /api/accounting/periods/reopen`, `GET /api/accounting/periods/resolve`, `GET /api/accounting/periods/readiness`, `GET /api/accounting/periods/audit-readiness` | — | Close/reopen mutate period status ✅; resolve returns/finds period (may call `ensure_accounting_period`) ✅ |
| **Profit & Loss** | `app/accounting/reports/profit-and-loss/page.tsx` | `GET /api/accounting/reports/profit-and-loss` (business_id, period_start required) | — | Reads from Trial Balance snapshot via `get_profit_and_loss_from_trial_balance` ✅ |
| **Balance Sheet** | `app/accounting/reports/balance-sheet/page.tsx` | `GET /api/accounting/reports/balance-sheet` (business_id, period_start required) | — | Reads from Trial Balance snapshot via `get_balance_sheet_from_trial_balance` ✅ |
| **VAT Returns (AFS)** | `app/accounting/afs/page.tsx` | `GET/POST /api/accounting/afs/runs`, `GET /api/accounting/afs/runs/[id]`, `POST /api/accounting/afs/[run_id]/finalize`, `GET /api/accounting/afs/documents/[run_id]`, exports (csv/json/pdf) | Finalize reads/writes journal_entries (evidence: `journals/drafts/[id]/post`, `afs/[run_id]/finalize` references) ✅ | Period/run scoped; no direct period close |
| **Reconciliation** | `app/accounting/reconciliation/page.tsx` | `GET /api/accounting/reconciliation/mismatches`, `POST /api/accounting/reconciliation/resolve`, `GET /api/accounting/reconciliation/[scopeType]/[id]`, policy, pending-approvals, resolution-history | Resolve posts adjustment (journal entry) via reconciliation engine ✅ | Scoped by invoice/customer/period; no period close |
| **Adjustments** | `app/accounting/adjustments/page.tsx`, `app/accounting/adjustments/review/page.tsx` | `GET /api/accounting/adjustments`, `POST /api/accounting/adjustments/apply` | Apply calls `apply_adjusting_journal` RPC → ledger write ✅ | Requires period_start; open or soft_closed only |
| **Trial Balance** | `app/accounting/reports/trial-balance/page.tsx`, `app/accounting/trial-balance/page.tsx` | `GET /api/accounting/reports/trial-balance` (business_id, period_start), `GET /api/accounting/trial-balance` (business_id, period YYYY-MM) | — | Reads from `get_trial_balance_from_snapshot` ✅ |
| **Reports API (exports)** | Same UI pages | `GET /api/accounting/reports/profit-and-loss/export/csv`, `.../pdf`; balance-sheet, trial-balance, general-ledger (csv/pdf) | — | Same period/context as main report; read-only |
| **Opening Balances** | `app/accounting/opening-balances/page.tsx`, opening-balances-imports | `GET/POST /api/accounting/opening-balances`, `POST /api/accounting/opening-balances/apply`, `[id]`, `[id]/approve`, `[id]/post` | Apply: `apply_opening_balances` RPC; Post import: `post_opening_balance_import_to_ledger` ✅ | First open period only; period authority ✅ |
| **Journals (drafts)** | `app/accounting/journals/page.tsx`, drafts, new, [id]/edit, [id]/review | `GET/POST /api/accounting/journals/drafts`, `[id]`, `[id]/post` | Post draft: `post_manual_journal_draft_to_ledger` ✅ | period_id required on draft; period lock enforced |
| **Carry-forward** | `app/accounting/carry-forward/page.tsx` | `GET /api/accounting/carry-forward`, `POST /api/accounting/carry-forward/apply` | Apply writes carry-forward JE (evidence: carry-forward/route references journal_entries) ✅ | Period-scoped |
| **Chart of Accounts** | `app/accounting/chart-of-accounts/page.tsx` | `GET /api/accounting/coa` | — | Read-only (CoA list) |
| **Drafts (generic)** | `app/accounting/drafts/page.tsx` | `GET /api/accounting/drafts` (optional period_id) | — | Read-only list |
| **Period close flow** | Used by periods page | `GET /api/accounting/periods/readiness` (business_id, period_start), `POST /api/accounting/periods/close` | Close calls `validate_statement_reconciliation`, snapshot/close logic ✅ | Period mutation authority ✅ |

---

## Legend

- **Ledger Writes ✅** — API or RPC inserts/updates `journal_entries` / `journal_entry_lines` or calls `post_*_to_ledger` / `apply_*` RPCs.
- **Reads from ledger ✅** — Report or API reads ledger or canonical snapshot (trial_balance_snapshots, get_*_from_trial_balance, get_general_ledger).
- **Period Authority ✅** — Resolves, closes, reopens, or constrains posting by accounting period; or is the canonical place where period is determined for reports.

---

## Report Authority Rules (Step 3 — Summary)

- **Only Accounting workspace** can: resolve periods (via `/api/accounting/periods/resolve`), close/reopen periods (`/api/accounting/periods/close`, `reopen`), post adjustments (`/api/accounting/adjustments/apply`, `/api/accounting/reconciliation/resolve`), reconcile mismatches (reconciliation resolve).
- **Reports** under `/api/accounting/reports/*` rely **only** on ledger/snapshot data (Trial Balance snapshot or general ledger RPCs). No report endpoint mutates data; mutation is only via adjustment/reconciliation apply and other write routes above.
- **Legacy** `/api/reports/*` (profit-loss, balance-sheet, trial-balance, vat-control, registers, etc.) return **410** with message that ledger-based reports must use accounting workspace (evidence: `app/api/reports/profit-loss/route.ts`, `balance-sheet/route.ts`, `trial-balance/route.ts`, `vat-control/route.ts`, `registers/route.ts`).

---

*End of Accounting Workspace Map. No code or behavior changes.*
