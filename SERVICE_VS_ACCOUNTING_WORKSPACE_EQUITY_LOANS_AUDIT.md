# Service Workspace vs Accounting Workspace — Equity, Loans & Full Bookkeeping Audit

**Date:** 2025-02-16  
**Type:** READ-ONLY — No improvements or architecture changes. Evidence-only report.

---

## Scope & Definitions

- **Service Workspace:** Business owner context (industry: service). Routes: `/invoices`, `/payments`, `/expenses`, `/dashboard`, `/portal/accounting`, `/reports/*`, `/assets`, `/payroll`, plus access to `/accounting/*` with `business_id` for own business.
- **Accounting Workspace:** Routes under `/accounting/*`. Accessible to: (a) accounting firm users (with client selection), (b) service/retail owners for their own business (`lib/accessControl.ts` lines 189–195).
- **Canonical ledger posting engine:** `post_journal_entry()` + RPCs (`post_invoice_to_ledger`, `post_expense_to_ledger`, `post_manual_journal_draft_to_ledger`, etc.).

---

## 1. Equity Handling

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | Yes (accounts) / No (owner flows) | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | Partial (view only) | See below |
| **Notes** | |

**Equity accounts in chart_of_accounts/accounts:**
- **Yes.** System accounts created by `create_system_accounts()`: Owner's Equity (3000), Retained Earnings (3100).
- **File:** `supabase/migrations/251_create_system_accounts_without_conflict.sql` lines 56–65
- **Function:** `create_system_accounts(p_business_id UUID)`
- **Table:** `accounts` with `type = 'equity'`

**UI to record owner contribution (capital injection):**
- **No.** No dedicated flow or API for recording capital injections. Opening-balance flow uses `equity_offset_account_id` for balancing initial balances only (`app/api/accounting/opening-balances/apply/route.ts`), not for ongoing owner contributions.

**UI to record owner withdrawal (drawings):**
- **No.** No flow or API for drawings.

**Posted through canonical ledger:**
- **N/A.** No posting logic exists for owner contribution or drawings. Equity accounts appear in Balance Sheet (`lib/accounting/reports/getBalanceSheetReport.ts`) and Trial Balance; no transactional posting paths.

**Accessible in Service Workspace:**
- **Yes (read-only).** COA and Balance Sheet with equity are viewable via `/accounting/chart-of-accounts`, `/accounting/reports/balance-sheet`, `/portal/accounting` (Sidebar: `components/Sidebar.tsx`).

---

## 2. Loans

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | No (business loans) | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | N/A | |
| **Notes** | Only payroll deduction type "loan" exists (employee loan repayment). |

**Loan model/table:**
- **No.** No `loans` or `loan_payable` table or business-loan model. `docs/FEATURE_GAP_TALLY_SAGE_ODOO.md` line 140: "Inter-entity transactions … Yes (loans …) … ❌ No inter-entity".

**Loan payable account logic:**
- **No.**

**Interest rate storage:**
- **No.**

**Accrued interest tracking:**
- **No.**

**Loan repayment logic (principal vs interest split):**
- **No.**

**Amortization schedule logic:**
- **No.** `PAYROLL_BASELINE_ANALYSIS.md` line 664: "❌ No loan amortization".

**API routes or UI related to loans:**
- **No.** Payroll deductions `type IN ('loan','advance','penalty','other')` (`supabase/migrations/047_payroll_system.sql` line 59) — employee loan repayments only, not business loans.

---

## 3. Manual Journal Entries

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | Yes (firm-only) | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | No | See below |
| **Notes** | Manual journal drafts require accounting firm and engagement. |

**Can Service Workspace create manual journal entries?**
- **No.** `manual_journal_drafts` requires `accounting_firm_id UUID NOT NULL` (`supabase/migrations/147_manual_journal_drafts_step8_9.sql` line 16). RLS requires `accounting_firm_users` and `firm_client_engagements`. Service owners (no firm) cannot create drafts.
- **File:** `supabase/migrations/147_manual_journal_drafts_step8_9.sql`
- **Table:** `manual_journal_drafts`
- **Posting:** `post_manual_journal_draft_to_ledger()` in `supabase/migrations/148_manual_journal_draft_posting_hardening.sql`

**Is journal entry UI accessible in service routes?**
- **No.** Journal UI is under `/accounting/journals` only. Service sidebar (`components/Sidebar.tsx`) does not include "Journals" in accounting items. Accounting items for service: General Ledger, Chart of Accounts, Trial Balance, Reconciliation, Periods, Audit, Health — no Journals link.
- **API:** `GET/POST /api/accounting/journals/drafts` requires `checkFirmOnboardingForAction` and `firmId` (`app/api/accounting/journals/drafts/route.ts` lines 84–99).

**Restricted to /accounting?**
- **Yes.** Journal routes are under `/accounting/journals/*` and functionally restricted to firm users with engagement; service owners cannot use them.

---

## 4. Other Income (Non-Invoice Revenue)

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | Partial (report only) | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | No (no posting path) | |
| **Notes** | P&L has other_income section; no dedicated posting flow. |

**Can Service Workspace post revenue not linked to invoice?**
- **No.** Revenue posting paths: `post_invoice_to_ledger`, `post_credit_note_to_ledger`, sale/retail flows. No "Other income" or non-invoice revenue flow. Non-invoice revenue would require a manual journal — which Service cannot create.
- **P&L structure:** `lib/accounting/reports/getProfitAndLossReport.ts` defines `other_income` (codes 8000–8999); report can show such accounts if they have ledger balances, but there is no UI or API to post to them.
- **docs/FEATURE_GAP_TALLY_SAGE_ODOO.md:** No dedicated "Other income" flow.

**Requires accounting workspace?**
- **Yes** — and only via firm-scoped manual journals; service owners have no access.

---

## 5. Accruals & Prepayments

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | No | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | N/A | |
| **Notes** | No prepaid/accrued/deferred logic. |

**Prepaid expenses:**
- **No.** No UI or API for prepaid expense posting or reclassification. Adjustment page placeholder mentions "Reclassify prepaid insurance" (`app/accounting/adjustments/page.tsx` line 429) — example text only, no implementation.

**Accrued expenses:**
- **No.** No accrued-expense flow.

**Deferred revenue:**
- **No.** `docs/FEATURE_GAP_TALLY_SAGE_ODOO.md` lines 125–129: "Deferred revenue / expense … ❌ No deferred revenue/expense or cut-off".

**Basic expense posting only:**
- Yes. Expenses post via `post_expense_to_ledger()` on expense creation (trigger). No accrual/prepayment treatment.

---

## 6. Fixed Assets

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | Yes | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | Yes | |
| **Notes** | Assets and depreciation are in Service workspace (FINANCE & REPORTING). |

**Asset register:**
- **Yes.** `/assets` route — list, create, view, edit. Sidebar: `{ label: "Assets", route: "/assets" }` in FINANCE & REPORTING (`components/Sidebar.tsx` line 161).
- **Table:** `assets` (`supabase/migrations/046_asset_register.sql`).

**Depreciation logic:**
- **Yes.** `calculate_monthly_depreciation` RPC; `post_depreciation_to_ledger(p_depreciation_entry_id)`; `depreciation_entries` table.
- **File:** `supabase/migrations/290_asset_ledger_period_and_linkage.sql`
- **API:** `app/api/assets/create/route.ts` (backfill), `app/api/assets/[id]/depreciation/route.ts`

**Asset disposal logic:**
- **Yes.** `post_asset_disposal_to_ledger()` in migration 290; `app/api/assets/[id]/dispose` route.
- **File:** `supabase/migrations/290_asset_ledger_period_and_linkage.sql` lines 146–220

**Accessible in Service:**
- **Yes.** `/assets`, `/assets/create`, `/assets/[id]/view`, `/assets/[id]/edit`, `/reports/assets` in Service sidebar.

---

## 7. Inter-account Transfers

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | No (bank-to-bank) | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | N/A | |
| **Notes** | Stock transfers are inventory (retail). "Bank transfer" is an invoice payment method. |

**Bank-to-bank transfers:**
- **No.** No inter-account transfer UI or API. No cash/bank movement flow without invoice/payment/expense.

**Stock transfers:**
- **Yes (Retail only).** `stock_transfers` — store-to-store inventory; `post_stock_transfer_to_ledger`. Not bank-to-bank.
- **File:** `app/api/stock-transfers/[id]/receive/route.ts`

**Cash movement without invoice:**
- **No.** Payments are tied to invoices. Expenses post to ledger. No standalone "transfer" between bank/cash accounts.

---

## 8. Payroll & Tax Liabilities

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | Yes | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | Yes | |
| **Notes** | Liability accounts and payroll posting exist. |

**Payroll liability accounts:**
- **Yes.** `create_system_accounts()` creates: PAYE Liability (2210), SSNIT Employee (2220), SSNIT Employer (2230), Net Salaries Payable (2240).
- **File:** `supabase/migrations/251_create_system_accounts_without_conflict.sql` lines 45–48

**Tax payable (non-VAT):**
- **Yes.** Other Tax Liabilities (2200), PAYE (2210), plus VAT/NHIL/GETFund/COVID accounts (2100–2130).
- **File:** `supabase/migrations/251_create_system_accounts_without_conflict.sql`

**Payroll posting:**
- **Yes.** `post_payroll_run_to_ledger()` referenced in `ACCOUNTING_WORKSPACE_ARCHITECTURAL_AUDIT.md` (migration 047).

**Accessible in Service:**
- **Yes.** `/payroll` in Sidebar (`components/Sidebar.tsx` line 161); liability accounts in COA/BS.

---

## 9. Access Control

| Question | Answer | Evidence |
|----------|--------|----------|
| **EXISTS** | Yes | See below |
| **Evidence** | |
| **Accessible in Service Workspace** | Partial | See below |
| **Notes** | Service owners can use /accounting/* for own business. Firm-only features excluded. |

**Does Service restrict access to accounting routes?**
- **No.** Service owners are allowed to access `/accounting/*` for their own business.
- **File:** `lib/accessControl.ts` lines 182–195: "Owner or employee with a business: allow access to /accounting/* for their own business".

**Firm-only routes:**
- **Yes.** `isFirmOnlyRoute()`: `/accounting/control-tower`, `/accounting/firm`, `/admin/accounting` — service owners redirected to access-denied.
- **File:** `lib/accessControl.ts` lines 93–100

**Ledger and COA accessible in Service workspace?**
- **Yes.** Sidebar links: General Ledger (`/accounting/ledger`), Chart of Accounts (`/accounting/chart-of-accounts`), Trial Balance, Reconciliation, Periods, Audit, Health — all use `buildAccountingRoute(..., accountingBusinessId)` so service owners can reach them with `business_id`.
- **Journals:** Not in Service sidebar; requires firm. Manual journal drafts are firm-only by schema and RLS.

---

## Summary: Service Workspace Classification

**Is Service Workspace:**

- **A)** Invoice-centric light bookkeeping  
- **B)** Partial accounting  
- **C)** Full accounting parity with Accounting Workspace  

**Conclusion: A) Invoice-centric light bookkeeping**

**Evidence:**

| Capability | Service | Accounting (Firm) |
|------------|---------|-------------------|
| Equity accounts | View only | View only (no dedicated contribution/drawings flow in either) |
| Owner contribution/drawings | No | No |
| Business loans | No | No |
| Manual journal entries | No (firm-only) | Yes |
| Other income posting | No | Via manual journals only |
| Accruals/prepayments/deferred | No | No |
| Fixed assets | Yes (full) | Yes |
| Inter-account transfers | No | No |
| Payroll/tax liabilities | Yes (accounts + payroll) | Yes |
| Ledger, COA, reports (read) | Yes | Yes |
| Adjustments, opening balances, carry-forward | Via /accounting | Yes |
| Period close | Via /accounting | Yes |

Service Workspace can: invoice, receive payments, record expenses, manage assets (purchase, depreciation, disposal), run payroll, and view ledger, COA, and reports. It cannot: create manual journal entries, post other income, record owner contributions/drawings, use accruals/prepayments, or perform inter-account transfers. Manual journals are firm-scoped. Therefore Service Workspace is **invoice-centric light bookkeeping**, not full accounting parity.
