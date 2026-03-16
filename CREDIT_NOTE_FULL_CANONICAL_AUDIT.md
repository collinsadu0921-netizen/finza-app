# FINZA — Credit Note Full Canonical Audit

## PHASE 1 — Entry Flow Trace

### Creation flow
1. **UI:** `app/credit-notes/create/page.tsx` — User selects invoice (or picks from list), fills line items, date, reason, notes. Calls `POST /api/credit-notes/create` with `business_id`, `invoice_id`, `date`, `items`, `apply_taxes`, etc.
2. **API:** `app/api/credit-notes/create/route.ts` — Validates auth, business, invoice; computes tax via `getCanonicalTaxResultFromLineItems`; checks credit note total ≤ invoice balance (invoice.total − payments − applied credits); optionally runs reconciliation (VALIDATE, non-blocking); generates credit number and public token; inserts `credit_notes` (status `draft`) and `credit_note_items`. **Does not post to ledger.**
3. **Ledger:** No ledger action on create. Posting happens only when status becomes `applied` (see below).

### Apply flow (draft/issued → applied)
1. **UI:** `app/credit-notes/[id]/view/page.tsx` — User clicks "Apply"; `handleApply` → `runApply` → `PUT /api/credit-notes/[id]` with `{ status: "applied" }`.
2. **API:** `app/api/credit-notes/[id]/route.ts` (PUT) — Validates auth and business access; if `status === "applied"` and was not already applied: computes invoice balance (invoice total − payments − other applied credits, excluding this CN); rejects if credit note total > remaining balance; runs reconciliation check (VALIDATE, non-blocking); then **updates** `credit_notes` set `status = 'applied'` (and reason/notes if provided).
3. **DB trigger:** On `credit_notes` AFTER UPDATE, `trigger_post_credit_note` (migration 219) runs: if `NEW.status = 'applied'` and no journal entry exists for this credit note, it calls `post_credit_note_to_ledger(NEW.id)`. If that raises (e.g. period closed), the transaction rolls back and the status update is not committed.
4. **Ledger:** `post_credit_note_to_ledger(p_credit_note_id)` (migration 190): reads `credit_notes` (must be status `applied`), asserts `assert_accounting_period_is_open(business_id, date)`, parses `tax_lines` (canonical `lines`), validates AR and revenue (4000) and tax accounts, builds journal_lines (AR credit = total, Revenue debit = subtotal, tax reversals), calls `post_journal_entry(..., 'system')`. **Uses posting engine; single batch INSERT of lines → balance trigger satisfied.**

### Edit flow
- **API:** Same `PUT /api/credit-notes/[id]` — Only `status`, `reason`, `notes` are updatable. No edit of amounts or line items after create (no PATCH for items). **Correct:** immutable amounts once created; only status/notes change.

### Invoice balance reconciliation (operational)
- **DB:** `calculate_invoice_balance(invoice_uuid)` (migration 040): `invoice_total − sum(payments.amount) − sum(credit_notes.total WHERE status = 'applied')`. Used by trigger `update_invoice_status_on_credit_note` when a credit note is applied: updates invoice status to paid / partially_paid and `paid_at` when balance ≤ 0.
- **Trigger order:** On credit_notes UPDATE: `update_invoice_status_on_credit_note` (040) and `trigger_post_credit_note` (219) both run. If posting fails, transaction rolls back so both invoice status and credit note status stay unchanged.

---

## PHASE 2 — Accounting Correctness

### Ledger posting (post_credit_note_to_ledger)
- **Period:** `assert_accounting_period_is_open(business_id_val, cn_record.date)` is called. **OK.**
- **COA:** AR via control key, Revenue 4000, tax accounts from `tax_lines` meta. **OK.**
- **Reversal logic:** AR **credit** = `cn_record.total`; Revenue **debit** = `subtotal`; tax lines reversed (original credit → debit, original debit → credit). **OK.**
- **Balance:** Journal built in memory and passed to `post_journal_entry()`, which validates debits = credits and inserts all lines in one batch. **OK.**
- **Idempotency:** Trigger checks `NOT EXISTS (journal_entries WHERE reference_type = 'credit_note' AND reference_id = NEW.id)` before calling `post_credit_note_to_ledger`. **OK.**

### Invoice reconciliation (expected vs ledger)
- **Expected balance (app layer):** `invoice.total − sum(payments) − sum(applied credit_notes.total)` — used in create/apply APIs and in `lib/accounting/reconciliation/engine-impl.ts` for `reconcileInvoice`. **OK.**
- **Ledger balance (RPC):** `get_ar_balances_by_invoice` (migration 224) returns per-invoice AR balance **only from journal_entries where reference_type = 'invoice'**. It **does not** include:
  - `reference_type = 'payment'` (AR credit when payment is posted)
  - `reference_type = 'credit_note'` (AR credit when credit note is posted)
- **Result:** For any invoice with payments or applied credit notes, the RPC returns an **inflated** AR balance (invoice gross only). Reconciliation then compares:
  - **expectedBalance** = invoice − payments − credits (correct)
  - **ledgerBalance** = invoice AR only (too high)
  - **Delta** = positive and large → **FAIL** or **WARN**.
- **Period close:** `run_period_close_checks` (225) uses the same RPC and compares `ar_ledger` to `inv_expected` (invoice − payments − credits). Same bug: ledger side excludes payment and credit_note JEs, so period close can falsely report "Period AR does not match operational expected" or "unresolved AR mismatches". **Broken.**

---

## PHASE 3 — Authority & Period Enforcement

- **Authority:** Create/apply APIs use `getCurrentBusiness` and business_id checks; RLS on `credit_notes` and `credit_note_items` by business ownership. **OK.**
- **Period:** Posting path uses `assert_accounting_period_is_open(business_id, cn_record.date)`. Trigger does not swallow errors (219: no EXCEPTION block). **OK.**

---

## PHASE 4 — UI → API → Ledger Chain

| Step | Component | Finding |
|------|-----------|--------|
| Create | UI → POST create | Sends invoice_id, items, date; API validates balance and inserts draft. **OK.** |
| Apply | UI → PUT [id] status=applied | API validates balance, updates row; trigger posts to ledger. **OK.** |
| Ledger | trigger → post_credit_note_to_ledger | Period guard, COA, post_journal_entry batch. **OK.** |
| Reconciliation | Engine uses get_ar_balances_by_invoice | RPC omits payment and credit_note JEs. **BROKEN.** |

---

## PHASE 5 — Failure Paths

1. **Apply when period closed:** `post_credit_note_to_ledger` raises → transaction rolls back → status stays non-applied, invoice status unchanged. **Correct.**
2. **Apply when credit > remaining balance:** API rejects 400 before UPDATE. **Correct.**
3. **Reconciliation after apply:** Expected = invoice − payments − credits; ledger (from RPC) = invoice AR only → mismatch. **Broken** until RPC is fixed.
4. **Create when no country / tax error:** API returns 400. **Correct.**
5. **Items insert fails after credit_notes insert:** API deletes the credit note and returns 500. **Correct.**

---

## PHASE 6 — Trigger Safety & Double-Entry

- **Balance enforcement:** `post_journal_entry` inserts all lines in one statement; statement-level balance trigger sees full entry. **OK.**
- **Trigger atomicity:** No EXCEPTION handler in `trigger_post_credit_note`; posting errors abort the transaction. **OK.**
- **Immutable ledger:** No UPDATE/DELETE on journal_entries/journal_entry_lines from credit note path. **OK.**

---

## ROOT CAUSE OF RECONCILIATION FAILURE

**Broken:** `get_ar_balances_by_invoice` only considers `reference_type = 'invoice'`. Per-invoice AR balance must include:
- Invoice JEs (debit AR)
- Payment JEs for that invoice (credit AR)
- Credit note JEs for that invoice (credit AR)

**Fix:** Extend the RPC to include payment and credit_note journal entries linked to the same invoice (via `payments.invoice_id` and `credit_notes.invoice_id`), and sum AR lines for all of them per invoice.

---

## FIX APPLIED

- **Migration 288_get_ar_balances_include_payments_credit_notes.sql** updates `get_ar_balances_by_invoice` so that:
  - It still uses the same period and AR account.
  - It includes JEs where:
    - `reference_type = 'invoice'` and `reference_id` = invoice id, OR
    - `reference_type = 'payment'` and `reference_id` IN (SELECT id FROM payments WHERE invoice_id = that invoice AND deleted_at IS NULL), OR
    - `reference_type = 'credit_note'` and `reference_id` IN (SELECT id FROM credit_notes WHERE invoice_id = that invoice AND status = 'applied' AND deleted_at IS NULL).
  - For each invoice, the returned balance is the sum of (debit − credit) on the AR account across all those JEs.

No other changes: no schema change to credit_notes, no change to post_credit_note_to_ledger, no change to trigger or API logic.

---

## VALIDATION

- After fix: For an invoice with payments and/or applied credit notes, `get_ar_balances_by_invoice` should return a balance equal to `invoice.total − payments − applied_credits` (within rounding).
- Period close check (225) should pass when ledger and operational data are in sync.
- Reconcile invoice (engine-impl) should show OK when ledger and operational data are in sync.

---

## FILES REFERENCE

| Area | Files |
|------|--------|
| Schema / triggers | 040_credit_notes.sql, 092 (tax_lines), 219_credit_note_trigger_atomicity.sql |
| Posting | 190_fix_posting_source_default_bug.sql (post_credit_note_to_ledger) |
| API | app/api/credit-notes/create/route.ts, app/api/credit-notes/[id]/route.ts |
| UI | app/credit-notes/create/page.tsx, app/credit-notes/[id]/view/page.tsx |
| Reconciliation | lib/accounting/reconciliation/engine-impl.ts, arBalancesRpc.ts |
| AR RPC | 224_get_ar_balances_by_invoice_rpc.sql |
| Period close | 225_period_close_checks_rpc_and_log.sql |
