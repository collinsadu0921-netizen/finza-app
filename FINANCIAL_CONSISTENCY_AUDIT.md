# Financial Consistency Audit – Operational vs Accrual Metrics

## Objective

Ensure operational and accounting metrics do **not** contradict across Dashboard, Financial Reports, and VAT page.

**Rules:** Read-only.

---

## 1. Page Classification: Operational vs Accrual

| Page | Basis | Source |
|------|--------|--------|
| **Dashboard** | **Mixed** | Revenue & Outstanding: **accrual** (ledger). Collected & Total Expenses: **operational** (invoices/payments/expenses). |
| **Financial Reports** | **Operational** | All summary metrics from `invoices` table (no ledger). |
| **VAT (reports/vat)** | **Accrual** | VAT Control from `journal_entry_lines` (account 2100) only. |

---

## 2. Definitions by Page

### Dashboard (`app/dashboard/page.tsx`)

| Metric | Definition | Source | Scope |
|--------|------------|--------|--------|
| **Total Revenue** | Sum of credits to Revenue account (4000) | `journal_entry_lines` → account 4000 | All-time, no date filter |
| **Collected** | Sum of `payments.amount` | `payments` | This month only |
| **Outstanding** | AR ledger balance: max(0, Σ debit − Σ credit) for account 1200 | `journal_entry_lines` → account 1200 | All-time |
| **Total Expenses** | Sum of `expenses.total` | `expenses` | All-time |
| **Tax base** | Not shown on dashboard | — | — |

- **Revenue:** Accrual, net (ledger 4000 = revenue account; VAT in 2100).
- **Outstanding:** Accrual (AR balance). Overdue *count* uses operational invoice-level data; the **Outstanding** KPI *amount* is ledger-based.

### Financial Reports (`app/reports/page.tsx`)

| Metric | Definition | Source | Scope |
|--------|------------|--------|--------|
| **Total Revenue** | Sum of `invoice.total` where `status === "paid"` | `invoices` | All-time |
| **Outstanding** | Sum of `invoice.total` where `status !== "paid"` and `status !== "cancelled"` | `invoices` | All-time |
| **Total Invoices** | Count of non-deleted invoices | `invoices` | All-time |
| **Paid Invoices** | Count where `status === "paid"` | `invoices` | All-time |
| **Tax base** | Not shown | — | — |

- **Revenue:** Operational, **gross** (invoice total includes tax), **cash** (paid only).
- **Outstanding:** Operational. Raw sum of totals of non‑paid, non‑cancelled invoices. **No** subtraction of payments or credit notes. **Includes drafts.**

### VAT Page (`app/reports/vat/page.tsx` → `/api/reports/vat-control`)

| Metric | Definition | Source | Scope |
|--------|------------|--------|--------|
| **Opening balance** | Σ(credit − debit) for account 2100 before period start | `journal_entry_lines` → 2100 | Before `start_date` |
| **VAT collected** | Σ credits to 2100 in period | `journal_entry_lines` → 2100 | `start_date`–`end_date` |
| **VAT reversed** | Σ debits to 2100 in period | `journal_entry_lines` → 2100 | `start_date`–`end_date` |
| **Closing balance** | opening + VAT collected − VAT reversed | Derived | After `end_date` |
| **Tax base** | Not shown | — | — |

- **VAT:** Accrual. VAT liability movement only. No explicit “tax base” (taxable sales) on the page.

---

## 3. Table: Page → Definition Used

| Page | Revenue | Outstanding | Tax base |
|------|---------|-------------|----------|
| **Dashboard** | Ledger 4000 credits (accrual, net, all-time) | AR 1200 balance (accrual, all-time) | — |
| **Financial Reports** | Sum(paid `invoice.total`) (operational, gross, cash) | Sum(non‑paid, non‑cancelled `invoice.total`); includes drafts; no payments/credits | — |
| **VAT** | — | — | Not shown; VAT = ledger 2100 (accrual) |

---

## 4. Semantic Mismatches and Inconsistencies

### 4.1 Revenue

| Issue | Where | Detail |
|-------|--------|--------|
| **Different basis** | Dashboard vs Financial Reports | Dashboard “Total Revenue” = **accrual, net** (ledger 4000). Financial Reports “Total Revenue” = **cash, gross** (paid `invoice.total`). Same label, different meaning. |
| **Net vs gross** | Dashboard vs Financial Reports | Dashboard excludes VAT (net). Financial Reports uses `invoice.total` (gross). Numbers can differ materially. |
| **Timing** | Dashboard vs Financial Reports | Dashboard: accrual (all-time revenue recognition). Financial Reports: paid-only (cash timing). |

### 4.2 Outstanding

| Issue | Where | Detail |
|-------|--------|--------|
| **Accrual vs operational** | Dashboard vs Financial Reports | Dashboard = AR ledger (accrual). Financial Reports = sum of invoice totals (operational) with **no** payments/credits. |
| **Definition of “outstanding”** | Financial Reports | Not “total − payments − credits” per invoice. It is sum of **full** `invoice.total` for non‑paid, non‑cancelled. Overstates true outstanding. |
| **Drafts included** | Financial Reports | Drafts included (status ≠ paid, cancelled). Drafts are not financial; they should not be outstanding. |
| **Void / converted** | Financial Reports | Same filter includes `void` and `converted`, which may not represent collectible outstanding. |

### 4.3 Tax base

| Issue | Where | Detail |
|-------|--------|--------|
| **Not exposed** | All three | No page shows “tax base” or “taxable sales” explicitly. VAT page shows only VAT liability (2100) movement. |

### 4.4 Other

| Issue | Where | Detail |
|-------|--------|--------|
| **Expenses** | Dashboard only | `expenses` table (operational). Financial Reports and VAT do not show expense metrics. |
| **Collected** | Dashboard only | “Collected” (cash this month) exists only on Dashboard. Financial Reports has no equivalent. |

---

## 5. Summary of Inconsistencies

1. **“Total Revenue”** means **accrual net** on Dashboard and **cash gross** on Financial Reports → **contradiction**.
2. **“Outstanding”** means **AR ledger** on Dashboard and **sum of unpaid invoice totals (incl. drafts, no payments/credits)** on Financial Reports → **contradiction** and **incorrect** definition on Financial Reports.
3. **Financial Reports Outstanding** includes **drafts** and does **not** subtract payments or credit notes → **semantic error** (already noted in draft-outstanding audit).
4. **VAT page** is accrual-only (ledger 2100); **no tax base** reported. Dashboard and Financial Reports do not show VAT or tax base.

---

## 6. Page → Definition (Quick Reference)

| Page | Revenue | Outstanding | Tax base |
|------|---------|-------------|----------|
| **Dashboard** | Ledger 4000 (accrual, net) | AR 1200 (accrual) | — |
| **Financial Reports** | Paid `invoice.total` (operational, gross) | Sum unpaid `invoice.total` (operational; includes drafts; no payments/credits) | — |
| **VAT** | — | — | Not shown (VAT = 2100 accrual) |

These differences are **semantic mismatches**: same or similar labels used with different bases, definitions, and inclusions across pages.
