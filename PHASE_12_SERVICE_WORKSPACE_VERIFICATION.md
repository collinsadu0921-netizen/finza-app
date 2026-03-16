# Phase 12 — Service Workspace End-to-End Verification

**Audit type:** Principal systems verification (product + accounting + permissions)  
**Mode:** Code-level verification + failure table (no runtime execution in this pass)  
**Scope:** Service workspace only (`industry = "service"`)  
**Precondition:** Phase 11 bootstrap and normalization changes are merged.

---

## Verification method

Code paths and UI copy were traced for each Step 1–5 check. No live browser or API run was performed. Failures below are **reproducible** from the codebase; PASS for a step means the implementation **supports** the expected result, subject to runtime confirmation.

---

## Step 1 — Brand-New Business (Zero State)

| Area               | Expected result                           | Code support |
|--------------------|-------------------------------------------|--------------|
| Dashboard          | Loads without error                       | ✅ getCurrentBusiness; no accounting bootstrap in path |
| Ledger             | Shows "No journal entries yet"            | ✅ `app/ledger/page.tsx` line 328 |
| Trial Balance      | Loads; balanced, zero values             | ✅ `isBalanced = true` when `accountList.length === 0`; API uses ensureAccountingInitialized |
| Profit & Loss      | Loads; zero revenue, zero expenses       | ✅ Conditional: period resolve finds/creates period; if resolve 404 → user sees "No accounting period covers the selected dates." (see failure table) |
| Balance Sheet      | Loads; zero assets, liabilities, equity   | ✅ Same as P&L |
| VAT Report         | Loads; zero values (no 410, no firm copy)| ✅ 410 removed in `/api/reports/vat-control`; ensureAccountingInitialized + create_system_accounts fallback |
| Recurring Invoices | Loads; no RLS/dev/permission language    | ✅ Copy normalized to "Unable to load recurring invoices." |

**Fail-if check (code):** "Select a client" appears only in `/accounting/*` and `/firm/*`, not in Service routes. ✅  
**Fail-if check:** "Permission denied" appears on **one** Service page (see Step 5 failure). ❌

---

## Step 2 — First Real Transaction (No Tax)

| Area            | Expected result       | Code support |
|-----------------|------------------------|--------------|
| Invoice         | Posts successfully     | ✅ Posting path unchanged |
| Journal Entries | Created automatically | ✅ Triggers unchanged |
| Ledger          | Shows entries         | ✅ List reads journal_entries |
| Trial Balance   | Balanced              | ✅ Snapshot/API unchanged |
| Profit & Loss   | Revenue populated     | ✅ Report reads from ledger |
| Balance Sheet   | AR + Equity updated   | ✅ Report unchanged |

No permission or workspace-only logic found in Service invoice/post path. ✅

---

## Step 3 — First Taxed Transaction

| Area          | Expected result        | Code support |
|---------------|------------------------|--------------|
| Invoice       | Posts with tax         | ✅ Tax engine unchanged |
| VAT Accounts  | Used correctly         | ✅ Posting unchanged |
| VAT Report    | Reflects collected VAT | ✅ API returns ledger-derived figures |
| Trial Balance | Still balanced         | ✅ Unchanged |
| P&L           | Net revenue correct    | ✅ Unchanged |
| Balance Sheet | VAT payable reflected  | ✅ Unchanged |

VAT report no longer returns 410 for Service. ✅

---

## Step 4 — Boundary & Authority Integrity

| Check                         | Expected        | Code support |
|------------------------------|-----------------|--------------|
| Period close                 | ❌ Not available | ✅ "Accounting Periods" only when `isAccountantFirmUser` (Sidebar) |
| Ledger edit                  | ❌ Not available | ✅ Service `/ledger` is read-only list |
| Reconciliation resolve      | ❌ Not available | ✅ Service reconciliation uses `/api/reconciliation/*` only; no call to `/api/accounting/reconciliation/resolve` |
| "Select a client" copy        | ❌ Never appears | ✅ Only in `/accounting/*` and `/firm/*` |
| Accounting workspace redirect| ❌ Never forced  | ✅ No redirect to accounting in Service flows (dashboard redirect is firm-user only) |

---

## Step 5 — Regression Sweep

Service routes checked: Dashboard, Orders, Invoices, Recurring invoices, Customers, Expenses, Ledger, Trial Balance, Reports (P&L, Balance Sheet, VAT), Portal Accounting, Settings (Business Profile).

**One failure** found in code:

---

## ❌ Phase 12 result: **FAIL**

One failure is proven from the codebase. Runtime execution may reveal additional failures (e.g. period resolve 404 under edge conditions).

---

## Failure table (Option B)

| Page                    | Step | Exact error message | Root cause class | Severity |
|-------------------------|------|----------------------|------------------|----------|
| **Settings → Business Profile** | 5 (Regression sweep) | "Permission denied. Please check storage policies for 'business-assets' bucket in Supabase Dashboard." | **UI** — Permission-oriented copy on Service page. Shown when logo upload fails due to storage permission/policy (Supabase Storage). | High |

**File:** `app/settings/business-profile/page.tsx` (lines 146–147)  
**Trigger:** User uploads logo; Supabase Storage returns error containing "permission" or "policy".

---

## Conditional / runtime-only risks (not logged as PASS blockers)

- **"No accounting period covers the selected dates."** — Shown on Service **Reports → Profit & Loss** and **Reports → Balance Sheet** when `/api/accounting/periods/resolve` returns 404 (e.g. `ensure_accounting_period` RPC fails). For a **brand-new** business created after Phase 11, the bootstrap trigger creates one period, so resolve should succeed. Failure only if trigger did not run or RPC errors. Recommend runtime check for new business.
- **Portal Accounting** — Shows "You don't have permission (admin/owner/accountant only)." when role check fails. Not the literal "Permission denied" from the fail list; document if Phase 12 is interpreted to forbid any permission-style copy.

---

## Exit condition

Phase 12 is **explicitly marked FAIL** until:

1. The Business Profile storage error copy is changed to a non–permission-oriented message (e.g. "Unable to upload logo. Please try again or check storage setup."), and  
2. Runtime execution of Steps 1–5 is performed and passes (including new-business zero state and first transaction flows).

**No Phase 13, no new features, no tax engine changes** until Phase 12 is explicitly marked PASS after fixes and runtime verification.
