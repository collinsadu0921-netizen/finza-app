# FINZA — Final Pre-Launch Production Readiness Audit

**Audit type:** Read-only, evidence-based. No code or migration changes.  
**Scope:** Financial misstatement, ledger corruption, tenant isolation, runtime crash, posting chain break.  
**Excluded:** UI, architecture, refactors, performance, code style.

---

## SECTION 1 — Revenue & AR Posting Chain

### 1.1 Invoice Posting

**MODULE STATUS: PARTIAL**

**Evidence:**
- **Trigger:** `043_accounting_core.sql` lines 928–953: `trigger_post_invoice()` fires when `NEW.status IN ('sent','paid','partially_paid')` and `(OLD.status IS NULL OR OLD.status = 'draft')`. Idempotency: `IF NOT EXISTS (journal_entries WHERE reference_type = 'invoice' AND reference_id = NEW.id) THEN PERFORM post_invoice_to_ledger(NEW.id)`.
- **RPC:** `226_accrual_ar_posting_invoice_finalisation.sql`: idempotency via existing_je_id (AR line), `assert_accounting_period_is_open(business_id_val, posting_date)`, advisory lock. `190_fix_posting_source_default_bug.sql` lines 353–401: current canonical `post_invoice_to_ledger` **does not** SELECT `invoices.status` and **does not** raise on draft.
- **Draft guard:** Enforced only by trigger (043). Migration 228 added draft check to `post_invoice_to_ledger`; migration 190 later replaced the function and **omitted** the draft check. So normal path (trigger) is safe; direct RPC call with a draft invoice id could post.

**RISK LEVEL: MEDIUM** — Trigger prevents normal flow; RPC lacks defense-in-depth against direct invocation.

---

### 1.2 Payment Posting

**MODULE STATUS: PASS**

**Evidence:**
- **Trigger:** `043_accounting_core.sql` 972–976: `trigger_auto_post_payment` AFTER INSERT on payments, calls `post_payment_to_ledger(NEW.id)` with idempotency (no existing JE for reference_type payment, reference_id).
- **Draft invoice guard:** `227_payment_draft_invoice_guard.sql` lines 39–46: `SELECT ... INTO invoice_record FROM invoices WHERE id = payment_record.invoice_id`; `IF invoice_record.status = 'draft' THEN RAISE EXCEPTION 'Cannot post payment for draft invoice'`. Preserved in `258_payment_posting_idempotency.sql`.
- **Period:** `assert_accounting_period_is_open(business_id_val, payment_record.date)` in 227, 258.
- **Invoice status:** `129_fix_invoice_status_sync.sql`: `recalculate_invoice_status` called by triggers on payments and credit_notes; `update_invoice_status_on_credit_note` on credit note status change.

**RISK LEVEL: LOW**

---

### 1.3 Credit Note Posting

**MODULE STATUS: PASS**

**Evidence:**
- **When:** Posting only when `credit_notes.status = 'applied'`. `219_credit_note_trigger_atomicity.sql` + `043`: `IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied')` then idempotency check (no existing JE for reference_type credit_note, reference_id) then `PERFORM post_credit_note_to_ledger(NEW.id)`.
- **Chain:** PUT `/api/credit-notes/[id]` → `supabase.from('credit_notes').update(updateData)` → DB trigger → `post_credit_note_to_ledger` → `post_journal_entry` (292 allows revenue for reference_type credit_note).
- **API:** `app/api/credit-notes/[id]/route.ts` 171–237: outstanding = invoice total − payments − other applied credits (current credit note excluded via `c.id !== creditNoteId`); tolerance (credit ≤ outstanding + 0.01); invoice total > 0 guard.
- **Period / rollback:** `post_credit_note_to_ledger` (190) calls `assert_accounting_period_is_open`; trigger has no EXCEPTION block, so failure rolls back the UPDATE (219 comment).

**RISK LEVEL: LOW**

---

### 1.4 AR Balance Consistency

**MODULE STATUS: PASS**

**Evidence:**
- **Formula:** `288_get_ar_balances_include_payments_credit_notes.sql`: `get_ar_balances_by_invoice` returns per-invoice balance from JEs with reference_type in ('invoice','payment','credit_note'); credit_note JEs only when `credit_notes.status = 'applied'`. Line 90: `SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0))` on AR account.
- **Operational expected:** `225_period_close_checks_rpc_and_log.sql` inv_expected: `invoice.total - SUM(payments) - SUM(cn.total)` for applied credit_notes; compared to ledger AR from `get_ar_balances_by_invoice`.
- **Trial balance:** AR is part of snapshot/trial balance; reports use `get_trial_balance_from_snapshot` / `generate_trial_balance` (journal_entry_lines + period_opening_balances).

**RISK LEVEL: LOW**

---

## SECTION 2 — Negative Revenue / Credit Note Accounting

**MODULE STATUS: PASS**

**Evidence:**
- **190_fix_posting_source_default_bug.sql** `post_credit_note_to_ledger`: Cr AR (cn_record.total), Dr Revenue (4000, subtotal), tax lines reversed from canonical tax_lines (ledger_side flip). Same account mapping as invoice (AR control key, 4000, tax from credit note tax_lines).
- **292_credit_note_revenue_guard.sql:** Revenue (4000) allowed when reference_type = 'credit_note' and reference_id is applied credit note for business. No new accounts; accounts come from invoice-mirror logic.

**RISK LEVEL: LOW**

---

## SECTION 3 — Payroll Posting Integrity

**MODULE STATUS: PARTIAL**

**Evidence:**
- **289_payroll_ledger_expense_gross_only.sql:** Reads `total_gross_salary`, `total_ssnit_employer`, `total_paye`, `total_ssnit_employee`, `total_net_salary` from `payroll_runs`. Single INSERT into journal_entry_lines (5 lines): DR Payroll Expense (5600) = total_gross; DR SSNIT Employer (5610); CR PAYE (2230), CR SSNIT (2231), CR Net Salaries Payable (2240). `assert_accounting_period_is_open(v_business_id, v_payroll_month)`.
- **Idempotency:** **Not in RPC.** `app/api/payroll/runs/[id]/route.ts` lines 168–174: before calling `post_payroll_to_ledger`, checks `existingRun.journal_entry_id` and returns 400 if already set. So double-post is prevented only at API layer; direct RPC call could post twice.

**RISK LEVEL: MEDIUM** — API prevents double-post; DB-level idempotency missing.

---

## SECTION 4 — Assets & Depreciation

**MODULE STATUS: PARTIAL**

**Evidence:**
- **291_asset_ledger_balanced_journal_insert.sql:**  
  - **Purchase:** Single INSERT for two lines (DR Fixed Assets 1600, CR payment account). `assert_accounting_period_is_open`. **No idempotency:** does not check `acquisition_journal_entry_id` before inserting; duplicate call creates duplicate JE.  
  - **Depreciation:** Reads `depreciation_entries.journal_entry_id`; `IF v_existing_je_id IS NOT NULL THEN RAISE EXCEPTION 'Depreciation entry already posted'`. Single INSERT for lines. Period enforced.  
  - **Disposal:** Single INSERT; period enforced. Reversals (Fixed Assets, Accumulated Depreciation) present.
- **Balance trigger:** Single INSERT per entry so statement-level trigger sees full entry (291 comments).

**RISK LEVEL: MEDIUM** — Asset purchase posting has no idempotency; depreciation has idempotency.

---

## SECTION 5 — Period Control & Snapshot Integrity

**MODULE STATUS: PASS**

**Evidence:**
- **run_period_close_checks:** `225_period_close_checks_rpc_and_log.sql`: Trial balance from `get_trial_balance_from_snapshot(p_period_id)`; `IF ABS(v_tb_debit - v_tb_credit) > 0` then failure. AR vs operational comparison uses `get_ar_balances_by_invoice`.
- **Posting guard:** `assert_accounting_period_is_open` found in: invoice (190, 226), payment (227, 258), credit note (190), payroll (289, 287), asset purchase/depreciation/disposal (291, 290), expenses (229, 233), post_journal_entry (253, 292), adjustment (189), manual journal draft (148 checks period.status = 'locked' only; does not call assert).
- **Snapshot:** P&L, Balance Sheet, Trial Balance use `get_trial_balance_from_snapshot` / `generate_trial_balance` (247, 169, 236, 241). Source: period_opening_balances + journal_entry_lines.

**RISK LEVEL: LOW**

---

## SECTION 6 — Tenant Security Hard-Gating

**MODULE STATUS: PARTIAL**

**Evidence:**
- **Credit note apply:** `app/api/credit-notes/[id]/route.ts`: Loads credit note by id; validates access via credit note’s `business_id` (owner or business_users). No body.business_id.
- **Payment create:** `app/api/payments/create/route.ts` 70–80: `getCurrentBusiness(supabase, user.id)`; invoice fetched with `.eq('business_id', business.id)`. Comment: "business_id comes from session via invoice, never from body."
- **Invoice send:** Uses getCurrentBusiness; invoice scoped to session business.
- **Asset create:** `app/api/assets/create/route.ts`: `getCurrentBusiness`; insert uses `business.id`.
- **Payroll run:** Uses engagement/business from context (not body.business_id for cross-tenant).
- **Bills payments:** `app/api/bills/[id]/payments/route.ts` lines 72–79: **"AUTH DISABLED FOR DEVELOPMENT"**; **gets business_id from request body**; `.eq('business_id', business_id)` on bill. Allows arbitrary business_id and unauthenticated access.

**RISK LEVEL: CRITICAL** for `bills/[id]/payments` (and `bills/[id]/payments/[paymentId]` if same pattern). **LOW** for credit note, payment create, invoice send, asset create when using session/engagement.

---

## SECTION 7 — Trigger & Ledger Integrity Backbone

**MODULE STATUS: PASS**

**Evidence:**
- **Double entry:** `188_fix_journal_balance_enforcement.sql`: `enforce_double_entry_balance_statement()` AFTER INSERT ON journal_entry_lines FOR EACH STATEMENT; validates SUM(debit)=SUM(credit) per journal_entry_id with tolerance 0.01.
- **Idempotency:** Invoice: existing_je_id (226, 190). Payment: NOT EXISTS journal_entries (258). Credit note: NOT EXISTS in trigger (219, 043). Payroll: API-only (journal_entry_id check). Depreciation: journal_entry_id in depreciation_entries (291). Manual journal draft: draft_record.journal_entry_id (148).

**RISK LEVEL: LOW**

---

## SECTION 8 — Reporting Stability

**MODULE STATUS: PASS**

**Evidence:**
- Trial Balance, P&L, Balance Sheet pages use `formatCurrencySafe` (`lib/currency/formatCurrency.ts`): null/undefined/NaN rendered as 0.00; no throw. Values from API/snapshot (trial balance from snapshot; reports from snapshot/trial balance).
- Dashboard KPIs: Derived from ledger/snapshot flows; formatCurrencySafe used where applicable.

**RISK LEVEL: LOW**

---

## SECTION 9 — Credit Note Edge Cases

**Evidence (logic only):**
- **Credit equal to outstanding:** API allows when credit ≤ outstanding + 0.01; backend can reject if tolerance tighter elsewhere (not found; API is gate).
- **Multiple credit notes:** Other applied credits summed and excluded current note (filter `c.id !== creditNoteId`); outstanding = invoice − payments − other applied.
- **Partial payment then credit:** Same formula; no special case needed.
- **Invoice total = zero:** API guard "Invoice total is invalid or zero — cannot apply credit note" (route.ts 216).
- **RLS:** Credit note and invoice fetched with session/ownership checks; RLS on credit_notes/invoices applies in Supabase.

**RISK LEVEL: LOW**

---

## SECTION 10 — Launch Blocker Detection

### Financial Misstatement Risks
- **MEDIUM:** `post_invoice_to_ledger` (190) does not reject draft invoices; only the trigger does. Direct RPC call could post draft → revenue recognized before issuance.
- **MEDIUM:** Payroll RPC has no DB-level idempotency; double approval via API is prevented, but direct RPC can double-post.
- **MEDIUM:** Asset purchase RPC has no idempotency; duplicate call creates duplicate JEs (double Dr Fixed Assets / Cr Cash).

### Ledger Corruption Risks
- **LOW:** Statement-level balance trigger and single-INSERT patterns (payroll, assets, post_journal_entry) limit imbalance risk. Credit note and invoice idempotency prevent duplicate AR/revenue from normal flows.

### Tenant Data Leakage Risks
- **CRITICAL:** `app/api/bills/[id]/payments/route.ts` (and sibling) have auth disabled and trust body.business_id → cross-tenant payment creation and bill access possible.

### Posting Chain Break Risks
- **LOW:** Invoice (trigger + idempotency), payment (draft guard + idempotency), credit note (trigger + idempotency + period), period close checks, AR formula and get_ar_balances_by_invoice are consistent. Revenue guard (292) allows credit_note.

### Runtime Crash Risks
- **LOW:** Reports use formatCurrencySafe; no evidence of unguarded null/undefined in critical report paths. API error handling returns 4xx/5xx with messages.

---

## SECTION 11 — Required Output Format

| Module | Status | Evidence | Risk |
|--------|--------|----------|------|
| Invoice posting | PARTIAL | 043 trigger; 190 RPC no draft check | MEDIUM |
| Payment posting | PASS | 043, 227, 258; draft guard; period | LOW |
| Credit note posting | PASS | 219, 043, 190, 292; API outstanding/tolerance | LOW |
| AR balance consistency | PASS | 288 get_ar_balances_by_invoice; 225 run_period_close_checks | LOW |
| Credit note accounting | PASS | 190 Cr AR/Dr revenue/tax; 292 revenue guard | LOW |
| Payroll posting | PARTIAL | 289 single JE, period; no RPC idempotency | MEDIUM |
| Assets & depreciation | PARTIAL | 291 single INSERT; depreciation idempotent; purchase not | MEDIUM |
| Period & snapshot | PASS | 225, 247, 169; assert in posting paths | LOW |
| Tenant security | PARTIAL | Bills payments auth disabled + body.business_id | CRITICAL |
| Trigger & ledger backbone | PASS | 188 statement-level balance; idempotency per type | LOW |
| Reporting | PASS | formatCurrencySafe; snapshot-based | LOW |
| Credit note edge cases | PASS | API guards; RLS | LOW |

---

**FINAL SCORE: 7 / 10**

(2 critical/medium tenant and financial risks; 3 medium financial/idempotency risks; remainder pass or low.)

**LAUNCH STATUS: NO GO**

**Reasons:**
1. **CRITICAL:** Bills payment route(s) have auth disabled and trust body.business_id → tenant isolation breach and must be fixed before launch.
2. **MEDIUM:** Invoice RPC should reject draft (defense-in-depth).
3. **MEDIUM:** Payroll and asset purchase posting should have DB-level idempotency (or explicit doc that only API may call and enforces once).

**If** bills payment auth is re-enabled and business_id is scoped to session/engagement only, **then** status becomes **GO WITH WARNINGS** (invoice draft guard and payroll/asset idempotency remain as hardening recommendations).

---

*Audit completed. Evidence references only; no fixes or suggestions beyond launch gate.*
