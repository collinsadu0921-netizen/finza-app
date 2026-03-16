# FINZA System Audit Report — Structured Findings

**Scope:** Full codebase audit. No fixes suggested — findings only.  
**Context:** Ledger-first accounting for African SMEs (Ghana-first); SERVICE and RETAIL workspaces.

---

## 1. PROJECT STRUCTURE

### Top-level folder structure
- **finza-web/** — Next.js app root
  - **app/** — App Router (dashboard, accounting, service, retail, admin, api, auth, reports, etc.)
  - **components/** — React components (accounting, dashboard, forms, etc.)
  - **lib/** — Shared logic (accounting, taxEngine, payments, auth, business, currency, discounts, etc.)
  - **supabase/migrations/** — 320+ SQL migrations
  - **docs/** — Design and audit docs
  - **scripts/** — CI, verification, and one-off scripts

### Main backend modules/services
- **API routes (Next.js):** Under `app/api/` — REST-style handlers (GET/POST/PUT/DELETE).
- **Database:** PostgreSQL via Supabase; **no ORM** — direct Supabase client and RPCs. Raw SQL in migrations and RPCs (`post_journal_entry`, `post_invoice_to_ledger`, etc.).
- **Key lib modules:** `lib/accounting/` (reports, reconciliation, resolveAccountingPeriodForReport), `lib/taxEngine/` (Ghana etc.), `lib/payments/` (mobileMoneyService, eligibility), `lib/accountingAuth.ts`, `lib/accountingBootstrap.ts`, `lib/auditLog.ts`, `lib/business.ts`.

### Main frontend modules/pages
- **Dashboard:** `app/dashboard/`, `app/retail/dashboard/`, service dashboard components.
- **Accounting:** `app/accounting/` (ledger, trial-balance, reports, journals, periods, opening-balances, carry-forward, adjustments, reconciliation), `app/service/accounting/`.
- **Service:** Invoices, estimates, orders, customers, expenses, bills, credit notes, products, payments, recurring, reports.
- **Retail:** POS (`app/(dashboard)/pos/`, `app/retail/pos/`), sales, inventory, admin/retail (stores, registers, purchase-orders, suppliers, stock-transfers, low-stock, bulk-import, analytics).

### API structure
- **REST only.** No GraphQL. Next.js Route Handlers in `app/api/`.

### ORM / query builder
- **None.** Supabase JS client; complex logic in PostgreSQL functions.

### Authentication
- **Supabase Auth** (JWT/session). `createSupabaseServerClient()` uses anon key and cookies (SSR).

---

## 2. DATABASE SCHEMA AUDIT

### Tables (representative)
- **Core:** businesses, users, business_users, customers, categories, products_services, products, products_stock, products_variants, invoice_items, invoices, estimates, orders, recurring_invoices, payments, expenses, bills, bill_items, bill_payments, credit_notes, sales, sale_items, stock_movements, stores, registers.
- **Ledger:** accounts, journal_entries, journal_entry_lines, chart_of_accounts, chart_of_accounts_control_map, period_opening_balances, trial_balance_snapshots, accounting_periods, manual_journal_drafts, reconciliation_resolutions, bank_transactions.
- **Other:** audit_logs, vat_returns, assets, depreciation_entries, staff, payroll_runs, payroll_entries, payslips, accounting_firms, firm_client_engagements, opening_balance_imports, carry_forward_*, service_jobs, service_material_movements, service_job_material_usage, suppliers, purchase_orders.

### journal_entries and journal_entry_lines
- **journal_entries:** id, business_id, date, description, reference_type, reference_id, created_at; later: period_id, posting_source, source_type, source_draft_id, input_hash, accounting_firm_id, posted_by (migrations 051, 148, 190, 252).
- **journal_entry_lines:** id, journal_entry_id, account_id, debit, credit, description, created_at. Scoped via journal_entries.business_id.

### Chart of accounts / accounts
- **accounts** (051): business_id, name, code, type (asset|liability|equity|income|expense), is_system, is_reconcilable; UNIQUE(business_id, code).
- **chart_of_accounts** (097): business_id, account_code, account_name, account_type (asset|liability|equity|revenue|expense), is_active.
- **chart_of_accounts_control_map:** business_id, control_key, account_code.

### Immutability protections (DB-level)
- Triggers in 088: prevent_journal_entry_modification, prevent_journal_entry_line_modification block UPDATE/DELETE on journal_entries and journal_entry_lines.
- Migration 222: REVOKE UPDATE, DELETE on journal_entries and journal_entry_lines from anon and authenticated. **service_role retains full access.**

### Fiscal periods and locking
- **accounting_periods** (094): business_id, period_start, period_end, status (open|soft_closed|locked), closed_at, closed_by. Month boundaries enforced.
- **assert_accounting_period_is_open** used in posting; **locked** blocks posting. Trigger enforce_period_state_on_entry on journal_entries; open and soft_closed allow, locked raises.

### business_id on financial tables
- Present on journal_entries, accounts, chart_of_accounts, accounting_periods, invoices, payments, expenses, bills, sales, vat_returns, payroll_runs, etc. journal_entry_lines scoped via journal_entry_id.

### Audit / history
- audit_logs; accounting_period_actions; accounting_invariant_runs/failures; stock_movements.

### Inventory
- products_stock (product_id, variant_id, store_id, stock); stock_movements; sale_items (cogs, cost_price).

### VAT / tax_returns
- vat_returns: business_id, period_start_date, period_end_date, status (draft|submitted|paid). No GRA-specific columns.

### GRA VAT credit / receivable
- No dedicated table. VAT control accounts in ledger only.

---

## 3. ACCOUNTING ENGINE AUDIT

### Central posting
- **PostgreSQL functions** called from triggers or API: post_journal_entry (central writer); post_invoice_to_ledger, post_payment_to_ledger, post_expense_to_ledger, post_credit_note_to_ledger, post_bill_to_ledger, post_bill_payment_to_ledger, post_sale_to_ledger, post_manual_journal_draft_to_ledger, post_payroll_to_ledger, post_sale_refund_to_ledger, post_sale_void_to_ledger, asset/depreciation, post_service_job_material_usage_to_ledger, post_service_job_cancel_reversal.

### Event → ledger
| Event | Auto-posts? | Mechanism |
|-------|-------------|-----------|
| Invoice created | No (draft) | Post when status → sent (trigger). |
| Invoice paid | Yes | Trigger on payments INSERT. |
| Credit note issued | Yes | Trigger when status = applied. |
| Bill created | Yes | Trigger on bills. |
| Bill paid | Yes | Trigger on bill_payments INSERT. |
| Expense recorded | Yes | Trigger on expenses INSERT. |
| POS sale | Yes | App calls post_sale_to_ledger after sale + items. |
| Inventory purchase | No | No PO receipt posting found. |
| Stock adjustment | No | No adjustment posting found. |
| Payroll run | Yes | post_payroll_to_ledger from app (no trigger). |
| MoMo/Paystack | Depends | Posting on payment INSERT; callback only updates row. |
| Refund | Yes | post_sale_refund_to_ledger (reversal). |

### Double-entry
- Trigger enforce_double_entry_balance on journal_entry_lines (088); post_journal_entry validates balance. Tolerance 0.01.

### Reversals
- API POST /api/accounting/reversal: new JE, debit/credit swapped, reference_type reversal. Refund/void use post_sale_refund_to_ledger (reversal JE).

### Locked periods
- assert_accounting_period_is_open in posting; trigger on journal_entries blocks locked.

---

## 4. GHANA TAX ENGINE AUDIT

### VAT calculation
- **lib/taxEngine/jurisdictions/ghana.ts** and **ghana-shared.ts**: getGhanaTaxRatesForDate, getGhanaTaxMultiplier, roundGhanaTax.

### Rates
- Pre-2026: nhil 2.5%, getfund 2.5%, covid 1%, vat 15%. From 2026-01-01: covid 0%; total 20% (15+2.5+2.5). **No 21%.**

### COVID-19 levy
- Removed from 2026-01-01. **Good.**

### NHIL / GETFund
- Post-2026: creditable input tax (debit control account). Pre-2026 purchases: non-creditable, absorbed.

### VFRS
- Not present. **Good** (abolished 2026).

### PAYE / SSNIT
- Payroll posts to PAYE (2230) and SSNIT (2231, 5610). Ghana brackets/rates not verified in code.

### WHT
- No WHT logic found.

### E-VAT / GRA VSDC
- **No integration.** Invoices not cleared via GRA before send.

### VAT return
- vat_returns table; extraction from ledger (093); api/reports/vat-control, api/accounting/exports/vat exist.

---

## 5. REPORTING AUDIT

### Source
- Trial balance: get_trial_balance_from_snapshot (snapshot from period_opening_balances + journal_entry_lines). P&L and Balance Sheet: get_profit_and_loss_from_trial_balance, get_balance_sheet_from_trial_balance. **Ledger-derived only.**

### business_id and period
- Reports require business_id; period via period_id/period_start/as_of_date/start_date/end_date; resolveAccountingPeriodForReport.

### Trial Balance
- RPC get_trial_balance_from_snapshot(p_period_id). Snapshot built by generate_trial_balance.

### Balance sheet equation
- API returns totals.is_balanced and imbalance; legacy route returns 500 if unbalanced; accounting route can return data with warning.

---

## 6. API & SECURITY AUDIT

### business_id
- Enforced on sampled accounting/ledger/report routes (400 if missing; checkAccountingAuthority).

### UPDATE/DELETE on ledger
- **Revoked** for anon/authenticated (222). **Critical:** sales/create route attempts to DELETE journal_entries on reconciliation failure; server uses authenticated client → delete fails → **orphaned JE**, inconsistent state.

### Period locking
- Enforced in DB posting and reversal API.

### RBAC
- owner, admin, accountant, accountant_readonly; firm via getAccountingAuthority; checkAccountingAuthority for read/write.

---

## 7. PAYMENT INTEGRATIONS

- **Paystack:** Stub (initiate/webhook); not fully implemented.
- **Hubtel:** Route returns "coming soon".
- **MoMo:** Callback updates payment and invoice status; does not INSERT payment; posting depends on when payment row is created.
- **Webhook → ledger:** Posting is on payment INSERT; callback does not insert.
- **WhatsApp:** Invoice send implemented (buildWhatsAppLink, templates, settings).

---

## 8. RETAIL

- POS: sale create → stock deduction + post_sale_to_ledger (revenue, tax, COGS, inventory, cash).
- Costing: product/variant cost_price at sale (fixed/card).
- Stock adjustments / PO receipt: **No ledger posting found.**

---

## 9. SERVICE

- Invoice: post on send (trigger). Credit notes: reversal JE. Bills: post on insert/update; bill payments post on insert; AP cleared.

---

## 10. CRITICAL ISSUES

- **Reconciliation rollback in sales/create deletes JE but uses authenticated client → delete fails → orphaned JE.** Critical.
- **Service job material usage:** API does not call post_service_job_material_usage_to_ledger. Important.
- **MoMo:** Posting timing depends on when payment row is created. Important.
- **No E-VAT / GRA VSDC.** Critical for Ghana.
- **Stock adjustment / PO receipt:** No posting. Incomplete.
- **VAT 20%, COVID removed, no VFRS.** Good.
- **Reports ledger-derived; period locking enforced.** Good.

---

## 11. COMPLETE vs INCOMPLETE

| Module | Status | Notes |
|--------|--------|-------|
| General Ledger | Complete | Immutability, period guard, post_journal_entry. |
| Chart of Accounts | Complete | accounts, chart_of_accounts, control_map. |
| Invoicing | Complete | Post on send; tax_lines. |
| Payments | Complete | Trigger on INSERT; period guard. MoMo timing depends on flow. |
| Bills / AP | Complete | Post bill and bill payment. |
| Expenses | Complete | Trigger on INSERT. |
| Credit Notes | Complete | Post on applied; reversal. |
| POS / Retail | Complete | Sale + post_sale_to_ledger; refund/void reversal. |
| Inventory | Partial | No ledger for stock adjustment or PO receipt. |
| Payroll | Complete | post_payroll_to_ledger from app. |
| VAT Engine | Complete | Ghana 20%; COVID 0% from 2026. |
| PAYE / SSNIT | Partial | Posted; Ghana rates not verified. |
| E-VAT / GRA API | Missing | No integration. |
| Financial Reports | Complete | Ledger-derived via trial balance. |
| Period Locking | Complete | open/soft_closed/locked. |
| MoMo | Partial | Callback updates; posting on INSERT. |
| Paystack | Stub | Not fully implemented. |
| Hubtel | Not implemented | "Coming soon". |
| Multi-workspace | Complete | Service/retail; accounting context. |
| RBAC | Complete | owner/admin/accountant; firm; business_id. |

---

**End of audit report. No fixes suggested — findings only.**
