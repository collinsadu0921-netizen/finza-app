# Service Workspace Accounting — System Behavior Audit

**Role:** Senior accounting systems auditor  
**Scope:** Service workspace only (not retail, not accounting workspace UI).  
**Constraint:** Read-only. No fixes, refactors, or design proposals.

---

## Section A: Ledger Posting Matrix (flow → ledger yes/no)

| Flow | Creates journal entries? | Tables written | Accounts / amounts | Posting missing / notes |
|------|---------------------------|----------------|--------------------|--------------------------|
| **a) Invoice creation** | **Only if status = 'sent' at insert.** | Trigger `trigger_auto_post_invoice` (AFTER INSERT OR UPDATE OF status ON invoices) runs `trigger_post_invoice()` → `post_invoice_to_ledger(NEW.id)`. That writes via `post_journal_entry()` → `journal_entries`, `journal_entry_lines`. | AR (debit total), Revenue 4000 (credit subtotal), tax control accounts from `invoices.tax_lines`. | If invoice is created with **status = 'draft'** (default in `/api/invoices/create`), trigger condition `NEW.status IN ('sent','paid','partially_paid')` is false → **no posting**. Posting occurs only when status later becomes sent (or paid/partially_paid). |
| **b) Invoice sent** | **Yes.** | On UPDATE of `invoices.status` to `'sent'`, same trigger fires → `post_invoice_to_ledger(NEW.id)` → `post_journal_entry()` → `journal_entries`, `journal_entry_lines`. | Same as (a): AR, Revenue 4000, tax accounts per `invoices.tax_lines`. | **Guard:** `post_invoice_to_ledger` calls `assert_accounting_period_is_open(business_id, invoice.issue_date)`. If the period for `issue_date` is closed or missing, posting **raises** and the trigger fails. No journal rows are written; invoice status update may roll back (trigger is AFTER UPDATE). |
| **c) Order → invoice conversion** | **Only if invoice is created with status = 'sent'.** | Convert route inserts into `invoices` (and `invoice_items`). No direct ledger RPC. Posting is **only** via the same trigger on `invoices`. Default in code is `status: "draft"`; `status: "sent"` only if `body.status === "sent"`. | Same as (a) when trigger runs. | **Default path (draft):** Insert is draft → **no posting**. Posting happens only when the user later sends the invoice (status → sent) or when convert is called with `body.status === "sent"`. |
| **d) Record payment** (incl. overpayment) | **Yes.** | Trigger `trigger_auto_post_payment` (AFTER INSERT ON payments) runs `trigger_post_payment()` → `post_payment_to_ledger(NEW.id)` (alias for `post_invoice_payment_to_ledger`) → `post_journal_entry()` → `journal_entries`, `journal_entry_lines`. | Cash/Bank/MoMo (debit amount), AR (credit amount). | **No period guard** in `post_invoice_payment_to_ledger` (migration 190). Payment posting can succeed even when the period for the invoice’s `issue_date` is closed. **Overpayment:** `/api/payments/create` now validates `amountNum > remainingRounded` and returns 400; if that check were bypassed or removed, overpayment would post (AR over-credited, cash over-debited). |

**Trigger and function references**

- Invoice posting: `supabase/migrations/043_accounting_core.sql` — `trigger_post_invoice()` (lines 929–946), `CREATE TRIGGER trigger_auto_post_invoice` (948–952). Condition: `NEW.status IN ('sent','paid','partially_paid') AND (OLD.status IS NULL OR OLD.status = 'draft')`.
- Payment posting: same file — `trigger_post_payment()` (956–970), `CREATE TRIGGER trigger_auto_post_payment` (972–976). Fires on every INSERT into `payments` when `NEW.deleted_at IS NULL` and no existing `journal_entries` row for that payment.
- `post_invoice_to_ledger`: `supabase/migrations/190_fix_posting_source_default_bug.sql` (353–510). Calls `assert_accounting_period_is_open(business_id_val, invoice_record.issue_date)` at 398–399.
- `post_invoice_payment_to_ledger`: same migration (998–1122). No call to `assert_accounting_period_is_open`.

---

## Section B: Blocking guards (file + line + reason)

These guards cause `/reports/profit-loss` and `/reports/balance-sheet` to return **410** for all callers (including service). There is no service-specific branch; the return is unconditional at the top of the handler.

### Profit & Loss — `/api/reports/profit-loss`

| File | Line(s) | Guard / reason |
|------|---------|----------------|
| `app/api/reports/profit-loss/route.ts` | **5–14** | Unconditional `return NextResponse.json({ code: "LEDGER_READ_BLOCKED", error: "This report uses ledger data. Use accounting workspace reports.", canonical_alternative: "/api/accounting/reports/profit-and-loss" }, { status: 410 })` before any auth or business logic. Comment: "INVARIANT 2: Block ledger reads from operational Financial Reports." |

### Balance Sheet — `/api/reports/balance-sheet`

| File | Line(s) | Guard / reason |
|------|---------|----------------|
| `app/api/reports/balance-sheet/route.ts` | **5–14** | Unconditional `return NextResponse.json({ code: "LEDGER_READ_BLOCKED", error: "This report uses ledger data. Use accounting workspace reports.", canonical_alternative: "/api/accounting/reports/balance-sheet" }, { status: 410 })` before any auth or business logic. Comment: "INVARIANT 2: Block ledger reads from operational Financial Reports." |

### Data source those reports expect (when unblocked)

The **blocked** code paths (after the return) in the same files, and the **accounting** report routes, all assume:

- **Profit & Loss:** `get_profit_and_loss_from_trial_balance(p_period_id)`.
- **Balance Sheet:** `get_balance_sheet_from_trial_balance(p_period_id)`.

Those RPCs:

- Call `get_trial_balance_from_snapshot(p_period_id)`.
- That reads `trial_balance_snapshots` for `period_id`; if missing, it runs `generate_trial_balance(p_period_id)`.
- `generate_trial_balance` (migration 169) reads **only** from:
  - `period_opening_balances` (per period/account),
  - `journal_entry_lines` joined to `journal_entries`, filtered by `je.date` in `[period_start, period_end]`.

So the data source is **ledger-only**: `journal_entries`, `journal_entry_lines`, `period_opening_balances`, and the derived table `trial_balance_snapshots`. No direct read from `invoices`, `payments`, or other operational tables.

---

## Section C: Expected inaccuracies if P&L (or Balance Sheet) were enabled for service today

If the 410 guard were removed and the existing operational report logic ran for service users, without any other changes:

1. **Revenue understated or zero**
   - Invoices created as draft and never sent never post. Only when status becomes sent does `post_invoice_to_ledger` run.
   - Order → invoice creates draft by default; posting happens only after “send” or if convert was called with `status: "sent"`.
   - So any draft-only or “created but not yet sent” invoices would not appear in P&L.

2. **Revenue missing when invoice posting fails (period closed)**
   - `post_invoice_to_ledger` calls `assert_accounting_period_is_open(business_id, invoice.issue_date)`. If that period is closed or missing, the trigger raises and no journal entry is created.
   - The invoice is still “sent” in operational data, but ledger has no revenue (and no AR, no tax). P&L would understate revenue for those invoices.

3. **AR and cash misstated when payment posts but invoice did not**
   - Payment posting has **no** period check. So a payment can post (AR credit, cash/bank debit) even when the related invoice could not post (e.g. period closed).
   - Result: AR is reduced in the ledger without ever having been increased by the invoice; cash is debited. Trial balance and Balance Sheet would show AR understated (or negative) and a distorted linkage between receivables and revenue.

4. **Overpayment**
   - If overpayment were again accepted (e.g. validation removed or bypassed), the payment trigger would still post the full amount. Ledger would show AR over-credited and cash over-debited; outstanding balances and any AR-based report would be wrong. Current code rejects overpayment in `/api/payments/create`.

5. **Period and snapshot dependency**
   - Operational profit-loss (blocked) path uses `start_date`/`end_date` to find a row in `accounting_periods` that contains that range. If no periods exist (e.g. service-only business that never used accounting), the lookup fails (404) before any RPC runs.
   - P&L and Balance Sheet always require a `period_id`; they do not run on “raw” ledger without a period. So enabling the current operational route would still require at least one accounting period for the business.

6. **Tax and multi-currency**
   - Tax amounts in the ledger come from `post_invoice_to_ledger` using `invoices.tax_lines` and the configured tax ledger accounts. If invoice never posts, tax is missing in reports; no separate “operational tax” feed is used by the canonical P&L/Balance Sheet.
   - Reports do not apply a currency layer; they use the numeric balances from the trial balance. Any multi-currency or FX logic would need to be elsewhere; mismatches would show as wrong magnitudes if ledger amounts were in another currency than the report’s intended one.

---

## Section D: Accounting workspace delta

- **Same ledger and same report functions**  
  Accounting workspace reports use the same RPCs and the same underlying data:
  - `get_profit_and_loss_from_trial_balance(p_period_id)`
  - `get_balance_sheet_from_trial_balance(p_period_id)`
  - Both consume `get_trial_balance_from_snapshot(p_period_id)` → `trial_balance_snapshots` / `generate_trial_balance` → `journal_entry_lines` + `journal_entries` + `period_opening_balances`.

- **What accounting workspace adds on top of raw ledger**
  1. **Period choice and validation:** Reports take `business_id` and `period_start`, resolve to `accounting_periods.id`, and call the RPCs with `p_period_id`. No report runs without a period.
  2. **Access control:** Role checks (admin/owner/accountant or accountant readonly) in the route before calling the RPCs (`getUserRole`, `isUserAccountantReadonly`). Unauthorized users get 403.
  3. **System accounts:** `create_system_accounts(p_business_id)` is run so required accounts exist before building the trial balance.
  4. **Period lifecycle (outside these routes):** Accounting workspace hosts period closing, reopening, locking. Those flows affect whether **new** postings are allowed (`assert_accounting_period_is_open` in posting functions); they do not change how the report RPCs read already-posted data.
  5. **Approvals and posting for manual entries:** Manual journal drafts, opening balance imports, etc. are approved and posted in the accounting workspace; those flows write into the same `journal_entries` / `journal_entry_lines` that the report RPCs read.

Accounting reports do **not** add a separate “approved view” of the same ledger: they read the same tables and snapshots. The extra constraints (period open, role, etc.) govern **who** can run reports and **when** new entries can be posted, not a different data source for P&L/Balance Sheet.

---

## Section E: Risk summary (HIGH / MEDIUM / LOW per issue)

| Issue | Severity | Description |
|-------|----------|-------------|
| Invoice created as draft never posts; revenue missing in P&L until “send” | **HIGH** | Default service flows (create draft, convert to draft) produce no ledger entries. P&L/Balance Sheet would understate or omit that revenue and AR until the invoice is sent. |
| Invoice posting fails (period closed/missing) while payment posting succeeds | **HIGH** | Payment trigger has no period guard. Payments can post into closed or arbitrary periods; invoices cannot. Leads to AR/cash and trial balance inconsistencies. |
| No accounting periods for service-only businesses | **HIGH** | Operational report logic (and accounting report logic) requires `accounting_periods`. If service workspace never creates periods, report calls would fail at period lookup (404 or equivalent) before any P&L/Balance Sheet data is returned. |
| Overpayment posting (if validation were removed) | **MEDIUM** | Current payment create route rejects overpayment. If that check were removed or bypassed, payment trigger would still post the full amount → AR and cash misstated. |
| Draft-only and “convert but not send” workflow | **MEDIUM** | Common service path (order → convert → draft invoice, send later) means zero ledger impact until send. Enabling P&L without changing when posting happens would show incomplete revenue. |
| Tax and currency representation in reports | **LOW** | Tax and currency are only as correct as the posted journal lines. If invoices do not post or post to wrong period, tax and currency implications are wrong implicitly; the report RPCs do not add further tax or FX logic. |

---

**Document:** `SERVICE_ACCOUNTING_AUDIT.md`  
**Scope:** Service workspace accounting behavior and report dependencies.  
**No code or design changes implied.**
