# Audit: Rounding Drift, Reconciliation Invariant, Invoice Trace, Reports Bypass, Balance Computation

**READ-ONLY AUDIT — NO FIXES. EVIDENCE ONLY.**

---

## 1. Rounding / Aggregation Drift — Risk List

| # | File | Values Involved | Why It Can Drift |
|---|------|-----------------|------------------|
| 1 | `app/api/invoices/[id]/mark-paid/route.ts` L68–70 | totalPaid (Number), totalCredits (Number), invoiceTotal (Number), remainingBalance | API uses `Number(p.amount)` and `Number(cn.total)`; no rounding before compare. UI/view uses `.toFixed(2)` for display. If backend stores floats and UI rounds, edge amounts can disagree on “remaining &lt;= 0”. |
| 2 | `app/api/invoices/list/route.ts` L162 | outstandingAmount = `Math.max(0, Number(inv.total\|0) - totalPaid - totalCredits)` | List API computes outstanding in JS with no explicit round-to-pennies. Posting uses DB NUMERIC. Repeated sum of floats can accumulate error vs ledger AR balance. |
| 3 | `app/api/estimates/create/route.ts` L130–131, 143–144, 189–197 | baseSubtotal, estimateTotal, tax amounts | `Math.round(x*100)/100` on tax engine output. Estimates page uses `toFixed(2)` on subtotal/total/tax. If tax engine returns unrounded and one path rounds earlier, stored estimate totals can differ from UI-summed line totals. |
| 4 | `app/api/credit-notes/create/route.ts` L196, 204–205, 212 | derivedGross, remainingGrossRounded, creditTotalRounded | Balance check uses `Math.round((subtotal+total_tax)*100)/100` vs `invoice.total`. If invoice.total was stored with different rounding, remainingGrossRounded can disagree with ledger AR; guard may allow or block incorrectly. |
| 5 | `app/api/credit-notes/[id]/route.ts` L174–175 | remainingRounded, creditRounded | Apply guard rounds remaining and credit to 2dp. If invoice total or payments were stored/displayed with different precision elsewhere, apply validation can diverge from ledger-based balance. |
| 6 | `app/invoices/new/page.tsx`, `app/invoices/[id]/edit/page.tsx` | total, baseSubtotal, legacyTaxAmounts.*.toFixed(2) | UI uses `.toFixed(2)` for display. API persists via tax engine and `Math.round(*100)/100`. Display-only rounding is consistent, but any logic that uses string-to-number of toFixed output elsewhere can reintroduce drift. |
| 7 | `app/estimates/[id]/edit/page.tsx` L565, 622, 627–648 | item.total.toFixed(2), subtotal.toFixed(2), taxBreakdown.*.toFixed(2) | Same pattern: UI toFixed(2) vs API Math.round(*100)/100. If estimates feed orders/invoices, rounding at handoff must match or order/invoice totals can be off by pennies. |
| 8 | `app/api/orders/[id]/send/route.ts` L124 | `Number(order.total_amount\|0).toFixed(2)` | Returns string. If any consumer parses and re-sums, precision is lost at string conversion. |
| 9 | `app/api/accounting/reports/balance-sheet/route.ts` L117–121, 151–154, 171–194 | totalAssets, totalLiabilities, etc., balance per account | Totals computed as `sum + Number(acc.balance\|0)` then rounded for response. DB stores NUMERIC. Rounding only on output is fine, but if any other code compares these rounded values to unrounded ledger sums, comparisons can fail. |
| 10 | `app/api/accounting/reports/trial-balance/route.ts` L127–134, 145–169 | totalDebits, totalCredits, closing_balance sums | Same: in-memory sum then `Math.round(*100)/100`. Imbalance check uses `Math.abs(imbalance) < 0.01`. Over many accounts, sum-of-rounded can theoretically differ from rounded(sum); 0.01 tolerance reduces but does not remove drift risk. |
| 11 | `app/api/payments/create/route.ts` L159, 166 | remainingRounded, amountNum.toFixed(2) | Validation uses rounded remaining vs rounded amount. If remaining is derived from invoice.total − payments − credits in JS, it can diverge from AR balance in ledger by pennies, allowing or blocking payments inconsistently. |
| 12 | `app/invoices/[id]/view/page.tsx` L325–329, 580, 593–594, 1029, 1042–1043 | totalPaid, totalCredits, remainingBalance | Formula: `Number(invoice.total) - totalPaid - totalCredits`. Source: invoices.total, payments.amount, credit_notes.total. No rounding before display. Pay form uses remainingBalance for max; if backend mark-paid uses same formula but different aggregation order, edge cases can differ. |
| 13 | `app/dashboard/page.tsx` L374–403 | outstandingAmount = `Math.max(0, Number(inv.total\|0) - totalPaid - totalCredits)` | Dashboard uses invoices + payments + credit_notes. Same formula as list/view but different slice of data (all non-draft). Any rounding or precision difference between dashboard and list or ledger will show as inconsistent “outstanding” across the app. |
| 14 | `app/api/customers/[id]/360/route.ts` L104–124 | totalInvoiced, totalPaid, totalCredits, totalOutstanding | totalOutstanding = sum of per-invoice (inv.total − paid − credits). All from operational tables. No ledger comparison; if ledger AR by customer diverges (e.g. posting correction), 360 view stays wrong until operational data is fixed. |
| 15 | `app/api/customers/[id]/statement/route.ts` L106–119 | totalInvoiced, totalPaid, totalCredits, totalOutstanding | Same as 360: fully operational. Statement totals can drift from ledger without any check. |

---

## 2. Ledger Reconciliation Invariant (Specification Only)

### Title: Ledger Reconciliation Invariant

**1. Totals that must always match**

- **Invoice vs ledger (per invoice):** For each issued invoice (status in `sent` | `paid` | `partially_paid` | `overdue`), the sum of AR debits minus AR credits for that invoice (by `reference_type = 'invoice'`, `reference_id = invoice.id`) must equal `invoices.total` at the time of the last posting. After payments and credit notes, AR balance for that invoice must equal `invoices.total - sum(payments.amount for that invoice) - sum(credit_notes.total for that invoice where status = 'applied')`.
- **Period AR vs operational:** Sum of AR balances by customer or by business over a period (from ledger) must match the algebraic sum (invoices − payments − applied credits) over the same scope and period.
- **Trial balance:** Sum of debits = sum of credits (per period snapshot). Balance sheet: Assets = Liabilities + Equity (including current-period net income). P&L: net income = total revenue − total expenses from trial-balance-derived figures.

**2. Granularity**

- **Per-invoice:** Reconciliation can be run for a single invoice (AR lines for that invoice vs invoice total and applied payments/credits).
- **Per-period:** Reconciliation can be run for an accounting period (all AR activity in the period vs operational totals for that period).
- **Per-customer:** Reconciliation can be run for a customer (AR balance for that customer vs sum(invoice totals − payments − applied credits) for that customer).
- **Global:** Trial balance and balance sheet checks are at period level.

**3. When reconciliation is checked**

- **Report load:** Optional: when loading a report that shows AR or invoice-derived totals, run a lightweight check (e.g. AR total vs operational total for the same filter) and surface a warning or block if beyond tolerance.
- **Period close:** Mandatory: before marking a period closed, run per-period reconciliation (and optionally per-invoice) for that period; if any check fails, **block** period close and report which invariant failed.
- **Manual audit:** On-demand job or tool that runs per-invoice and/or per-customer reconciliation for a given business/period and returns a list of variances (invoice id, expected balance, ledger balance, difference).

**4. What happens if it fails**

- **Per-invoice mismatch (report or audit):** **Warn** in UI and **log** the variance; do not block viewing. Option: configurable “strict” mode that **blocks** report or period close.
- **Trial balance / balance sheet unbalanced:** **Abort** report response and return 500 with message (current behavior in code); **block** period close.
- **Period-close reconciliation failure:** **Block** period close; return clear error and list of failing invariants (e.g. “AR total for period X does not match operational total”).
- **Manual audit failure:** **Log** and return the variance list; no automatic block unless used as input to a period-close or report-strict policy.

---

## 3. Single-Invoice Reconciliation Trace (Draft → Sent → Paid → Credited)

**Lifecycle stages and ledger impact**

| Stage | DB function that posts | Journal entries created | Accounts affected |
|-------|------------------------|-------------------------|-------------------|
| **Draft** | None | None | — |
| **Sent** | `post_invoice_to_ledger(invoice.id)` via `trigger_auto_post_invoice` when `status` moves from `draft` to `sent` (or `paid` / `partially_paid`) | One JE: `reference_type = 'invoice'`, `reference_id = invoice.id`. Lines: AR debit = `invoices.total`; Revenue credit = `invoices.subtotal`; Tax account(s) debit/credit from `invoices.tax_lines` (canonical `lines` or legacy `tax_lines`). | AR, Revenue (4000), Tax (per tax_lines) |
| **Paid** | `post_payment_to_ledger(payment.id)` via `trigger_auto_post_payment` on `payments` INSERT | One JE: `reference_type = 'payment'`, `reference_id = payment.id`. Lines: Cash/Bank debit = `payment.amount`; AR credit = `payment.amount`. | Cash/Bank, AR |
| **Credited** | `post_credit_note_to_ledger(credit_note.id)` via `trigger_post_credit_note` when `credit_notes.status` becomes `applied` | One JE: `reference_type = 'credit_note'`, `reference_id = credit_note.id`. Lines: AR debit (reduce receivable); Revenue credit (reverse); Tax accounts reversed per credit_note tax_lines. | AR, Revenue, Tax |

**Triggers (evidence)**

- Invoice: `trigger_auto_post_invoice` ON `invoices` AFTER INSERT OR UPDATE OF status; calls `post_invoice_to_ledger(NEW.id)` when NEW.status in (`sent`,`paid`,`partially_paid`) and OLD was draft and no JE exists yet for that invoice.
- Payment: `trigger_auto_post_payment` ON `payments` AFTER INSERT; calls `post_payment_to_ledger(NEW.id)` when no JE exists yet for that payment.
- Credit note: `trigger_auto_post_credit_note` ON `credit_notes` AFTER INSERT OR UPDATE OF status; calls `post_credit_note_to_ledger(NEW.id)` when NEW.status = `applied` and no JE exists yet for that credit note.

**Do UI/API read invoice status or balance without using ledger totals?**

- **YES.** Invoice list, invoice view, mark-paid, payments create, credit-note create/apply, customer 360, customer statement, and dashboard all compute “outstanding” or “remaining balance” as `invoice.total - sum(payments.amount) - sum(credit_notes.total)` from **invoices**, **payments**, and **credit_notes** only. None of these reads AR (or any ledger) to derive the displayed balance.

**Conclusion:** **Ledger is not the single source of truth for “outstanding” or “remaining balance” in the UI or in those APIs.** The ledger is the source of truth for what is *posted* (AR, revenue, tax, cash). Operational tables are the source of truth for what the app *shows* as due. Reconciliation would detect when those two diverge.

---

## 4. Reports: Data Source and Ledger-Safe

| Report | Route / Page | Data source (SQL / query) | Ledger-safe (YES/NO) |
|--------|--------------|---------------------------|----------------------|
| Trial Balance | `/api/accounting/reports/trial-balance` | `get_trial_balance_from_snapshot(p_period_id)` → trial_balance_snapshots (from period_opening_balances + journal_entry_lines) | **YES** |
| Trial Balance CSV/PDF | same + export sub-routes | same RPC / snapshot | **YES** |
| General Ledger | `/api/accounting/reports/general-ledger` | `get_general_ledger` / `get_general_ledger_paginated` → journal_entry_lines + journal_entries | **YES** |
| General Ledger CSV/PDF | export sub-routes | same | **YES** |
| Profit & Loss | `/api/accounting/reports/profit-and-loss` | `get_profit_and_loss_from_trial_balance(p_period_id)` → trial_balance_snapshots | **YES** |
| P&L CSV/PDF | export sub-routes | same | **YES** |
| Balance Sheet | `/api/accounting/reports/balance-sheet` | `get_balance_sheet_from_trial_balance(p_period_id)` → trial_balance_snapshots | **YES** |
| Balance Sheet CSV/PDF | export sub-routes | same | **YES** |
| Registers | `/api/reports/registers` | journal_entry_lines + journal_entries, filtered by reference_type in (sale, refund, void, sale_refund) | **YES** |
| VAT Control | `/api/reports/vat-control` | journal_entry_lines for VAT account (2100) + journal_entries | **YES** |
| Aging | `/api/reports/aging` | **Blocked (410).** If unblocked: journal_entry_lines for AR + journal_entries by invoice; then joins to **invoices** for display. Balance used for aging = ledger AR balance. | **YES** for balance used in buckets (ledger); **NO** if any total were taken from invoices/payments. Implemented balance is from ledger. |
| Sales Summary | `/api/reports/sales-summary` | **Blocked (410).** Body reads from **invoices**, **credit_notes**; totals = sum(invoices.total) − sum(credits), by status. | **NO** — operational only. |
| Tax Summary | `/api/reports/tax-summary` | **Blocked (410).** Body reads **invoices**, **expenses**, **bills**, **sales**, **credit_notes** for tax columns. | **NO** — operational only. |
| Legacy Balance Sheet | `/api/reports/balance-sheet` | **Blocked (410).** When used, called `get_balance_sheet_from_trial_balance` (ledger). | **YES** (data source is ledger) |
| Legacy P&L | `/api/reports/profit-loss` | **Blocked (410).** When used, called `get_profit_and_loss_from_trial_balance` (ledger). | **YES** |
| Legacy Trial Balance | `/api/reports/trial-balance` | **Blocked (410).** When used, called `get_trial_balance_from_snapshot` (ledger). | **YES** |
| Dashboard totals | `app/dashboard/page.tsx` → loadServiceDashboardStats | Invoices, payments, credit_notes. outstandingAmount = inv.total − totalPaid − totalCredits; totalInvoicedGross, totalOutstanding, overdueAmount from same. | **NO** — operational only. |
| Customer 360 | `/api/customers/[id]/360` | Invoices, payments, credit_notes. totalOutstanding = sum(inv.total − paid − credits). | **NO** — operational only. |
| Customer Statement | `/api/customers/[id]/statement` | Invoices, payments, credit_notes. totalOutstanding = totalInvoiced − totalPaid − totalCredits. | **NO** — operational only. |

**CRITICAL VIOLATIONS (bypass ledger for financial totals)**

1. **Dashboard:** All KPIs (outstanding, overdue, total invoiced, total outstanding) are from **invoices + payments + credit_notes**. No ledger read. If ledger and operational data diverge, dashboard is wrong.
2. **Customer 360:** totalInvoiced, totalPaid, totalCredits, totalOutstanding and overdue are from **invoices, payments, credit_notes** only. Bypasses ledger.
3. **Customer Statement:** totalInvoiced, totalPaid, totalCredits, totalOutstanding from **invoices, payments, credit_notes** only. Bypasses ledger.
4. **Invoice list (overdue/outstanding):** Outstanding and overdue logic use **inv.total, payments, credit_notes**. Bypasses ledger.
5. **Invoice view / Pay form:** remainingBalance and totalPaid/totalCredits use **invoice.total, payments, credit_notes**. Bypasses ledger.
6. **Mark-paid / Payments create / Credit-note create & apply:** Balance checks use **invoice.total − payments − credit_notes**. Bypasses ledger for validation.

*(Sales Summary and Tax Summary are hard-blocked at 410 and would be violations if re-enabled without switching to ledger-derived totals.)*

---

## 5. Invoice Balance / Outstanding / Totals — Audit Table

| File | Line(s) | Formula / Logic | Source tables | Ledger (journal_entries / journal_entry_lines) | Bypasses ledger |
|------|----------|------------------|---------------|--------------------------------------------------|------------------|
| `app/api/invoices/[id]/mark-paid/route.ts` | 68–71 | totalPaid = sum(Number(p.amount)); totalCredits = sum(Number(cn.total)); remainingBalance = invoiceTotal − totalPaid − totalCredits | invoices, payments, credit_notes | No | **Yes** |
| `app/api/invoices/list/route.ts` | 130–162 | totalPaid/Credits from maps; outstandingAmount = max(0, inv.total − totalPaid − totalCredits) | invoices, payments, credit_notes | No | **Yes** |
| `app/api/invoices/[id]/route.ts` | (read path) | Invoice row incl. total, subtotal; no balance formula here | invoices | No | N/A |
| `app/invoices/[id]/view/page.tsx` | 224–229, 325–329, 574–595, 890–895, 991–999, 1029–1043, 1141–1166 | totalPaid = sum(p.amount); totalCredits = sum(cn.total); remainingBalance = invoice.total − totalPaid − totalCredits | invoices, payments, credit_notes | No | **Yes** |
| `app/api/payments/create/route.ts` | 141–166 | remainingBalance from existingPayments + appliedCredits; totalPaid/totalCredits from DB; validation vs amount | invoices, payments, credit_notes | No | **Yes** |
| `app/api/credit-notes/create/route.ts` | 181–212 | invoiceGross = invoice.total or (subtotal+total_tax); remainingGross = invoiceGross − paymentsGross − creditsGross; guard: creditTotalRounded ≤ remainingGrossRounded | invoices, payments, credit_notes | No | **Yes** |
| `app/api/credit-notes/[id]/route.ts` | 137–179 | remainingGross = invoiceGross − totalPaid − totalCredits; apply guard creditRounded ≤ remainingRounded | invoices, payments, credit_notes | No | **Yes** |
| `app/credit-notes/create/page.tsx` | 186–204 | Same as create API: derivedGross, remainingGross, remainingGrossRounded; guard on front-end | invoices, payments, credit_notes (via API/fetch) | No | **Yes** |
| `app/dashboard/page.tsx` | 353–405 | invoicePaymentsMap, invoiceCreditNotesMap; outstandingAmount = max(0, inv.total − totalPaid − totalCredits); totalOutstanding, overdueAmount | invoices, payments, credit_notes | No | **Yes** |
| `app/api/customers/[id]/360/route.ts` | 104–124 | totalInvoiced = sum(inv.total); totalPaid = sum(p.amount); totalCredits = sum(applied cn.total); totalOutstanding = sum(max(0, inv.total − paid − credits)) | invoices, payments, credit_notes | No | **Yes** |
| `app/api/customers/[id]/statement/route.ts` | 106–119 | totalInvoiced, totalPaid, totalCredits from invoices/payments/credit_notes; totalOutstanding = totalInvoiced − totalPaid − totalCredits | invoices, payments, credit_notes | No | **Yes** |
| `app/api/accounting/reports/general-ledger/route.ts` | 201–206, 243–248 | totalDebit/Credit = sum(line.debit/credit); finalBalance = last running_balance | journal_entry_lines (via get_general_ledger RPC) | **Yes** | No |
| `app/api/reports/aging/route.ts` | 138–172, 251–256 | balance = SUM(debit − credit) per invoice from **journal_entry_lines** (AR); aggregates by bucket. Uses **invoices** only for metadata (number, due_date, customer). | journal_entry_lines + journal_entries, invoices (metadata) | **Yes** for balance | No (for balance) |
| `app/api/reports/registers/route.ts` | 113–340 | Registers use journal_entry_lines + journal_entries; no invoice “balance” formula; amounts from lines | journal_entry_lines, journal_entries | **Yes** | No |
| `app/api/reports/vat-control/route.ts` | 101–178 | opening/closing and flows from journal_entry_lines for VAT account | journal_entry_lines, journal_entries | **Yes** | No |

**Summary:** All “invoice balance,” “outstanding,” “remaining,” “totalPaid,” “totalCredits,” and “totalOutstanding” logic used in invoice list, invoice view, mark-paid, payments create, credit-note create/apply, dashboard, customer 360, and customer statement is computed from **invoices**, **payments**, and **credit_notes** only. None of these use **journal_entries** or **journal_entry_lines** for that purpose. Only general ledger, trial balance, P&L, balance sheet, registers, VAT control, and (when used) aging use ledger tables for financial totals.
