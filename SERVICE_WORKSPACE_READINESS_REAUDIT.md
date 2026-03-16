# FINZA Service Workspace — Readiness Re-Audit

**Date:** 2025-02-13  
**Mode:** READ ONLY — Evidence from code, triggers, routes, runtime guards. No fixes, no refactoring, no design suggestions.

---

## 1. Core Revenue Flow Stability

**Stages audited:** Customer → Quote (Estimate) → Order → Invoice → Payment → Credit Note → Ledger Posting

| Stage | Creation | Status transitions | Ledger posting | Invoice balance recalc | Trigger integrity | Known crash paths |
|-------|----------|--------------------|----------------|-------------------------|--------------------|-------------------|
| **Customer** | Yes — `/api/customers`, `customers` table | status active/blocked | N/A | N/A | N/A | None found |
| **Estimate** | Yes — `POST /api/estimates/create` | send, convert | Does NOT post (by design) | N/A | N/A | None found |
| **Order** | Yes — `POST /api/orders/create`, convert-from-estimate | convert-to-invoice | Does NOT post | N/A | N/A | Documented: Order convert auth bypass (SERVICE_MODE_PRODUCTION_READINESS_REPORT M1) |
| **Invoice** | Yes — create, send, mark-paid APIs | draft → sent/paid/partially_paid/overdue | Yes — `trigger_auto_post_invoice` → `post_invoice_to_ledger` (migrations 226, 228); draft cannot post | Yes — `recalculate_invoice_status` (migration 129) | Invoice: post on sent/paid/partially_paid; period guard; draft guard | None in posting path; send can 500 if bootstrap not run (C2 doc) |
| **Payment** | Yes — `POST /api/payments/create`, mark-paid, MoMo | — | Yes — `trigger_post_payment` → `post_invoice_payment_to_ledger` (217, 227, 258); draft invoice blocked (227) | Yes — `trigger_update_invoice_status_with_credits` (129) | Payment insert/update/delete trigger recalc; period guard | None in trigger path |
| **Credit note** | Yes — create, PUT status=applied | draft → applied | Yes — `trigger_post_credit_note` → `post_credit_note_to_ledger` (219, 043); failure aborts txn (219) | Yes — `update_invoice_status_on_credit_note` (129) | Trigger atomicity: no EXCEPTION swallow; period enforcement propagates | None in trigger path |

**Evidence (sources):**

- Migration 129: `recalculate_invoice_status`, payment/credit_note triggers; formula `outstanding := total - total_paid - total_credits`; status derived from outstanding.
- Migration 219: `trigger_post_credit_note` calls `post_credit_note_to_ledger`; no EXCEPTION block — period/post errors abort and roll back status update.
- Migration 288: `get_ar_balances_by_invoice` includes `reference_type IN ('invoice','payment','credit_note')` so AR balance = invoice − payments − applied credits.
- Migration 227: Payment posting guarded against draft invoice.
- SERVICE_MODE_PRODUCTION_READINESS_REPORT: workflow matrix and blocking defects C2, M1, M2, M3.

**Output: PARTIAL**

- **PASS:** Creation works for all stages; status transitions exist; ledger posting exists for invoice, payment, credit note; invoice balance recalculation exists and is trigger-driven; trigger integrity (no swallowed errors for credit note/payment posting).
- **PARTIAL:** Order/invoice send/payments/credit-notes APIs have documented auth bypass (M1, M2, M3) for development; restore before production. Invoice send can 500 if accounting not initialized (C2). No crash paths in DB trigger chain itself.

---

## 2. Credit Note Apply Validation

**Checks:**

| Item | Evidence |
|------|----------|
| **Outstanding formula** | `outstandingCents = max(0, invoiceCents - paidCents - creditsCents)`; `outstanding = outstandingCents/100` (credit-notes [id] route.ts 229–233). |
| **Payment aggregation** | `existingPayments` from `payments` where `invoice_id`, `deleted_at IS NULL`; `totalPaid = reduce(amount)` (route 191–193, 223). |
| **Applied credit aggregation** | `existingCredits` from `credit_notes` where `invoice_id`, `status = 'applied'`, `deleted_at IS NULL`; current CN excluded by `c.id !== creditNoteId`; `totalCredits = reduce(total)` (197–202, 224–226). |
| **Rounding** | Cents-based: `invoiceCents`, `paidCents`, `creditsCents` rounded; `creditRounded = round(creditAmount*100)/100`; reject only when `creditRounded > outstanding + TOLERANCE` (248–250). |
| **Tolerance** | `TOLERANCE = 0.01` (249). |
| **Invoice status recalc trigger** | Migration 129: `trigger_update_invoice_on_credit_note` on credit_notes status change; calls `recalculate_invoice_status(NEW.invoice_id)`. |
| **Ledger posting trigger** | Migration 219: on `status = 'applied'`, `trigger_post_credit_note` calls `post_credit_note_to_ledger(NEW.id)` if no JE exists. |
| **invoice.total zero/missing** | Hard guard: `invoiceGross <= 0 || !Number.isFinite(invoiceGross)` → 400 "Invoice total is invalid or zero — cannot apply credit note" (216–220). Prior to that, invoice fetch 404 if not found (184–189). So zero/missing total does **not** cause false rejection of valid apply; it causes explicit 400/404. |

**Output: SAFE**

- Formula, aggregation, rounding, and tolerance match design. Invoice status and ledger triggers present. Zero/invalid invoice total is explicitly rejected and does not cause silent false rejection.

---

## 3. Payroll Integrity

| Item | Evidence |
|------|----------|
| **Gross chain** | Ghana: `grossSalary = basicSalary + allowances` (ghana.ts 167); `total_gross_salary` in DB (289). |
| **SSNIT base** | Ghana: SSNIT on **basic only** — `ssnitBase = basicSalary`; employee 5.5%, employer 13% (ghana.ts 174–176, 57–62). |
| **PAYE bands** | Ghana: 0–490 0%, 491–650 5%, 651–3850 10%, 3851–20000 17.5%, 20001–50000 25%, 50001+ 30%; progressive calculation in code (ghana.ts 116–155) and documented to match SQL `calculate_ghana_paye`. |
| **Allowance + deduction** | Gross = basic + allowances; taxable = gross − employee SSNIT; net = taxable − PAYE − otherDeductions (ghana.ts 167, 179, 185). Ledger: migration 289 — expense debit = `total_gross_salary` only (no double-count of allowances). |
| **post_payroll_to_ledger balance** | Migration 289: single INSERT for all 5 lines (DR gross + employer SSNIT; CR PAYE, SSNIT, net); period guard; column names `total_gross_salary`, `total_net_salary` (287 fix). |
| **Approval workflow** | API `payroll/runs/[id]` sets `journal_entry_id` after RPC (PAYROLL_LEDGER_POSTING_CANONICAL_AUDIT_AND_FIX); prevents duplicate post on re-approval. |

**Output: SAFE**

- Gross chain, SSNIT base, PAYE bands, and single-statement balanced insert with period enforcement are present and consistent. Approval links run to JE.

---

## 4. Assets + Depreciation

| Item | Evidence |
|------|----------|
| **Asset purchase posting** | Migration 291: `post_asset_purchase_to_ledger` — one INSERT for two lines (DR Fixed Assets 1600, CR payment account); period guard; updates `assets.acquisition_journal_entry_id`. |
| **Depreciation posting balanced** | Migration 291: `post_depreciation_to_ledger` — single INSERT for two lines (DR Depreciation Expense 5700, CR Accumulated Depreciation 1650); idempotency (raises if `journal_entry_id` already set); period guard. |
| **Disposal posting** | Migration 291: `post_asset_disposal_to_ledger` — single INSERT for four lines (290/291); period guard. |
| **Ledger consistency** | Statement-level balance trigger (188); all asset JEs use single-statement INSERT so trigger sees full entry. |

**Output: SAFE**

- Purchase, depreciation, and disposal use balanced single-statement inserts and period enforcement; no multi-insert imbalance.

---

## 5. Period Close

| Item | Evidence |
|------|----------|
| **Readiness API** | `run_period_close_checks` RPC (225); used by `app/api/accounting/periods/close/route.ts` (157) and `app/api/accounting/periods/readiness/route.ts` (94); audit-readiness route (61) exposes same RPC. |
| **Blocking logic** | Checks: trial balance balanced (zero tolerance); AR ledger vs operational; unposted WARN/FAIL mismatches (225). Returns `ok` + `failures` array. |
| **Period lock** | `assert_accounting_period_is_open` used in all posting functions (invoice, payment, credit_note, payroll, asset, expense, etc.); locked/soft_closed periods reject posting. |
| **Posting to closed periods** | Blocked by `assert_accounting_period_is_open` in posting paths; expense governance (233) blocks insert/update/delete when date in closed/locked period. |
| **Reopen + carry forward** | Reopen and carry-forward logic present (167, 168, 171, 172); prior period lock checks for rollforward. |

**Output: SAFE**

- Readiness RPC exists and is used by close and readiness APIs; blocking checks and period enforcement are in place; posting to closed periods is blocked.

---

## 6. Reporting Stability

| Item | Evidence |
|------|----------|
| **Trial balance** | API calls `get_trial_balance_from_snapshot` (trial-balance route 93); snapshot engine (247) with concurrency lock; SUM(debits)=SUM(credits) enforced. |
| **P&amp;L / Balance sheet** | Reports use period/snapshot resolution; ledger-only source (164). |
| **VAT report** | VAT routes and extraction exist (093, vat-returns, reports/vat). |
| **Null safety in formatters** | `formatCurrencySafe` (lib/currency/formatCurrency.ts): treats undefined/null/NaN as 0, never throws; `formatCurrency` uses `Number(amount ?? 0).toFixed(2)`. |

**Output: SAFE**

- Trial balance uses snapshot RPC; formatters are null-safe. No evidence of report paths that throw on null in formatters.

---

## 7. Access Control & Workspace Isolation

| Question | Evidence |
|----------|----------|
| **Can service users open /accounting/control-tower, /accounting/firm/*, /admin/accounting/*?** | **No.** `lib/accessControl.ts`: `isFirmOnlyRoute(pathname)` returns true for these prefixes (93–100). In STEP 4, if user is not in `accounting_firm_users` and `isFirmOnlyRoute(pathname)`, returns `redirectTo: "/accounting/access-denied"` (172–178). |
| **Middleware blocks unauthorized workspace access?** | **Yes.** `ProtectedLayout` (components/ProtectedLayout.tsx) calls `resolveAccess(supabase, userId, pathname)` (57); if `!decision.allowed`, redirects to `decision.redirectTo` (64–69). No middleware file found; layout is the guard. |
| **Sidebar-only protection?** | **No.** Protection is in `resolveAccess()`; sidebar is not the only guard. Firm-only routes also enforced in API: `requireFirmMemberForApi` (lib/requireFirmMember.ts) used in all `app/api/accounting/firm/*`, `app/api/admin/accounting/*`, `app/api/accounting/control-tower/*` routes — returns 403 if user not in `accounting_firm_users`. |

**Output: SECURE**

- Service users cannot reach firm-only pages (redirect to access-denied) or firm-only APIs (403). Enforcement is in both resolveAccess (UI) and API routes.

---

## 8. Ledger Integrity Backbone

| Item | Evidence |
|------|----------|
| **Double entry** | Migration 188: `enforce_double_entry_balance_statement` on `journal_entry_lines` AFTER INSERT FOR EACH STATEMENT; rejects if `ABS(total_debit - total_credit) > 0.01`. |
| **Statement-level balance** | Trigger is FOR EACH STATEMENT (188, 185); batch INSERTs (e.g. payroll 289, asset 291, payment 258) insert all lines in one statement so trigger sees balanced entry. |
| **Idempotent posting** | Payment: 258 idempotency; manual draft: 148 `post_manual_journal_draft_to_ledger` idempotent; opening balance: 151; credit note trigger checks for existing JE (219). |
| **Snapshot reporting** | Trial balance from snapshot (247); period close uses `get_trial_balance_from_snapshot` (225). |
| **Period enforcement** | `assert_accounting_period_is_open` in all posting functions (invoice, payment, credit_note, payroll, asset, expense, etc.). |

**Output: SAFE**

- Double entry enforced by statement-level trigger; idempotent posting and period enforcement are present.

---

## 9. Objective Readiness Score

| Module | Score (0–10) | Notes |
|--------|-------------|--------|
| Revenue Flow | 7 | End-to-end works; auth bypasses (M1–M3) and C2 documented; no trigger crash paths. |
| Accounting Engine | 8 | Period close, readiness, posting guards, AR by invoice (288) in place. |
| Credit Notes | 9 | Apply formula, tolerance, zero guard, triggers, ledger trigger atomic. |
| Payroll | 8 | Ghana gross/SSNIT/PAYE correct; ledger single-statement; approval sets journal_entry_id. |
| Assets | 8 | Purchase/depreciation/disposal single-statement; period guard. |
| Reporting | 8 | Trial balance snapshot; null-safe formatters; ledger-only reports. |
| Security | 9 | Firm-only routes and APIs enforced; resolveAccess + requireFirmMemberForApi; access-denied logging. |
| UX Stability | 7 | ProtectedLayout + resolveAccess; some auth bypasses in API for dev. |

**Overall readiness (average of module scores):** (7+8+9+8+8+8+9+7) / 8 = **8.0 / 10 → 80%.**

---

## 10. True Launch Blockers

**Only items that would cause financial misstatement, ledger corruption, legal/compliance exposure, or user data loss (UI polish ignored):**

1. **Order convert-to-invoice / convert-from-estimate auth bypass (M1)**  
   Body `business_id` not validated against session. Could allow posting to wrong business → **financial misstatement / data boundary**.

2. **Invoice send and payments create auth bypass (M2)**  
   Invoice lookup not scoped to user’s business. Could allow sending or paying another business’s invoice → **financial misstatement / data loss**.

3. **Credit note PUT [id] auth bypass (M3)**  
   Credit note select not filtered by business. Could allow applying credit notes to wrong business → **financial misstatement**.

4. **Invoice send without accounting initialized (C2)**  
   Send can 500 if bootstrap not run; no silent wrong state. Risk is failed send or inconsistent state if caller ignores error — **potential misstatement** if user retries or assumes success.

**Not listed as launch blockers (by definition):**

- UI polish, dashboard expense total fallback (N1), MoMo callback vs trigger duality (N2), estimate convert tax_fields (N3), sidebar visibility (protection is in resolveAccess + API).

---

**END REPORT**
