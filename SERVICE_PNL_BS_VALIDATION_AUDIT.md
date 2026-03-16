# Service P&L / Balance Sheet — Validation Audit

**Role:** Senior accounting systems auditor  
**Scope:** Service workspace ONLY. Read-only. No fixes, refactors, design proposals, or retail discussion.  
**Goal:** Validate whether service business owners can safely see P&L and Balance Sheet TODAY, and what breaks if unblocked.

---

## 1. Evidence table (file:line)

| Subject | File | Line(s) | Quote or finding |
|--------|------|---------|-------------------|
| Invoice posting trigger condition | `supabase/migrations/043_accounting_core.sql` | 931–934 | `IF (NEW.status IN ('sent', 'paid', 'partially_paid') AND (OLD.status IS NULL OR OLD.status = 'draft'))` |
| Invoice posting trigger invocation | `supabase/migrations/043_accounting_core.sql` | 941 | `PERFORM post_invoice_to_ledger(NEW.id);` |
| Invoice posting period guard | `supabase/migrations/190_fix_posting_source_default_bug.sql` | 398–399 | `-- GUARD: Assert accounting period is open` then `PERFORM assert_accounting_period_is_open(business_id_val, invoice_record.issue_date);` |
| Payment posting trigger condition | `supabase/migrations/043_accounting_core.sql` | 957–965 | `IF NEW.deleted_at IS NULL` and `IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference_type = 'payment' AND reference_id = NEW.id)` |
| Payment posting invocation | `supabase/migrations/043_accounting_core.sql` | 965 | `PERFORM post_payment_to_ledger(NEW.id);` |
| Payment posting period guard | `supabase/migrations/190_fix_posting_source_default_bug.sql` | 998–1122 | **None.** No call to `assert_accounting_period_is_open`. Function goes from `business_id_val := payment_record.business_id` (1045) to COA guards and `post_journal_entry` (1089). |
| assert_accounting_period_is_open (invoice uses 2-arg) | `supabase/migrations/166_controlled_adjustments_soft_closed.sql` | 103–137 | Current def: `(p_business_id, p_date, p_is_adjustment DEFAULT FALSE)`. Resolves period via `ensure_accounting_period(p_business_id, p_date)`; raises if status = 'locked'; blocks non-adjustments in 'soft_closed'. |
| Profit-loss 410 return | `app/api/reports/profit-loss/route.ts` | 5–14 | Unconditional `return NextResponse.json({ code: "LEDGER_READ_BLOCKED", ... }, { status: 410 })` before any auth or DB access. |
| Balance-sheet 410 return | `app/api/reports/balance-sheet/route.ts` | 5–14 | Same pattern: unconditional 410 before any logic. |
| Blocked profit-loss logic (if 410 removed) | `app/api/reports/profit-loss/route.ts` | 16–64 | `getUser` → `getCurrentBusiness` → `start_date`/`end_date` required → query `accounting_periods` by date range → if no period, 404 → `get_profit_and_loss_from_trial_balance(p_period_id: period.id)`. |
| Blocked balance-sheet logic (if 410 removed) | `app/api/reports/balance-sheet/route.ts` | 16–67 | Same pattern: `getUser` → `getCurrentBusiness` → `as_of_date` → query `accounting_periods` for that date → if no period, 404 → `get_balance_sheet_from_trial_balance(p_period_id: period.id)`. |
| get_profit_and_loss_from_trial_balance | `supabase/migrations/169_trial_balance_canonicalization.sql` | 270–301 | Takes `p_period_id`; selects from `get_trial_balance_from_snapshot(p_period_id)` where `account_type IN ('income', 'expense')`. |
| get_balance_sheet_from_trial_balance | `supabase/migrations/169_trial_balance_canonicalization.sql` | 308–338 | Takes `p_period_id`; selects from `get_trial_balance_from_snapshot(p_period_id)` where `account_type IN ('asset', 'liability', 'equity')`. |
| get_trial_balance_from_snapshot | `supabase/migrations/169_trial_balance_canonicalization.sql` | 216–264 | Takes `p_period_id`. Reads `trial_balance_snapshots` for `period_id = p_period_id`; if not found, calls `generate_trial_balance(p_period_id, NULL)` then re-reads snapshot. |
| generate_trial_balance | `supabase/migrations/169_trial_balance_canonicalization.sql` | 56–207 | Takes `p_period_id`, `p_generated_by`. Reads `accounting_periods` (by id), `accounts` (by business_id), `period_opening_balances` (period_id, account_id), `journal_entry_lines` JOIN `journal_entries` (by account, business_id, date in period). Writes `trial_balance_snapshots`. |

---

## 2. Posting matrix (event → posts? → guard? → failure mode)

| Event | Posts? | Guard? | Failure mode if violated |
|-------|--------|--------|----------------------------|
| **Invoice inserted/updated with status draft** | **No** | N/A | Trigger condition false (OLD.status IS NULL OR 'draft', NEW not in sent/paid/partially_paid). No JE. |
| **Invoice status → sent / paid / partially_paid** | **Yes** | **Yes** | `post_invoice_to_ledger` runs; `assert_accounting_period_is_open(business_id, issue_date)` at 190:399. If period missing/locked/soft_closed → **RAISE**; trigger fails; status update can roll back. |
| **Payment inserted** | **Yes** | **No** | `trigger_post_payment` → `post_payment_to_ledger` → `post_invoice_payment_to_ledger` (190:998). No `assert_accounting_period_is_open`. Payment posts regardless of invoice’s or payment’s period. |
| **Invoice in closed/missing period** | No (guard raises) | Yes | Posting aborted; no JE. |
| **Payment when invoice period closed** | Yes | No | Payment JEs written; AR credited, cash debited even though invoice never posted → AR distortion. |

**Matrix summary**

| Event | Creates JEs? | Period guard in posting path? | Failure mode |
|-------|--------------|--------------------------------|---------------|
| Invoice draft → sent/paid | Yes (when condition true) | Yes (invoice `issue_date`) | If guard raises: no JE; trigger fails. |
| Payment INSERT | Yes | **No** | Payment can post when invoice did not → AR/cash mismatch. |

---

## 3. Report blocking — 410 is unconditional

### Profit-loss

**File:** `app/api/reports/profit-loss/route.ts`

**Exact early return (lines 5–14):**

```ts
export async function GET(request: NextRequest) {
  // INVARIANT 2: Block ledger reads from operational Financial Reports
  return NextResponse.json(
    {
      code: "LEDGER_READ_BLOCKED",
      error: "This report uses ledger data. Use accounting workspace reports.",
      canonical_alternative: "/api/accounting/reports/profit-and-loss",
    },
    { status: 410 }
  )

  // BLOCKED: All code below is unreachable
  try {
    const supabase = ...
```

**What would run if 410 were removed:**  
Auth → `getCurrentBusiness` → require `start_date` and `end_date` (400 if missing) → query `accounting_periods` for `business_id` and date range (404 if no row) → `create_system_accounts` → `get_profit_and_loss_from_trial_balance(p_period_id: period.id)` → transform and return. No role check; any user with a current business could call it.

### Balance-sheet

**File:** `app/api/reports/balance-sheet/route.ts`

**Exact early return (lines 5–14):** Same structure — `return NextResponse.json({ code: "LEDGER_READ_BLOCKED", ... }, { status: 410 })` at top of GET.

**What would run if 410 were removed:**  
Auth → `getCurrentBusiness` → `as_of_date` (default today) → query `accounting_periods` for that date (404 if no row) → `create_system_accounts` → `get_balance_sheet_from_trial_balance(p_period_id: period.id)` → transform and return. Again no role check.

---

## 4. Report data dependency chain

Canonical report RPCs and their inputs/reads:

| RPC | Required input | Tables read | Notes |
|-----|----------------|------------|-------|
| **get_profit_and_loss_from_trial_balance** | `p_period_id` (UUID) | Via `get_trial_balance_from_snapshot(p_period_id)`: see below. Filters rows with `account_type IN ('income', 'expense')`. | 169:270–301 |
| **get_balance_sheet_from_trial_balance** | `p_period_id` (UUID) | Via `get_trial_balance_from_snapshot(p_period_id)`. Filters `account_type IN ('asset', 'liability', 'equity')`. | 169:308–338 |
| **get_trial_balance_from_snapshot** | `p_period_id` (UUID) | `trial_balance_snapshots` WHERE `period_id = p_period_id`. If no row: calls `generate_trial_balance(p_period_id, NULL)`, then re-reads `trial_balance_snapshots`. | 169:216–264 |
| **generate_trial_balance** | `p_period_id`, `p_generated_by` | **Read:** `accounting_periods` (id = p_period_id), `accounts` (business_id, not deleted), `period_opening_balances` (period_id, account_id), `journal_entry_lines` JOIN `journal_entries` (account_id, business_id, date in period). **Write:** `trial_balance_snapshots` (upsert by period_id). | 169:56–207 |

**Required inputs for running P&L or Balance Sheet from these RPCs:**

- **period_id** — UUID of a row in `accounting_periods`.
- **accounting_periods** — At least one row per business for the requested period; otherwise the **route** has no `period.id` to pass. Operational routes resolve period by querying `accounting_periods` by `business_id` and date; if the query returns no row, they respond 404 and never call the RPCs.

**Dependency chain (order):**

1. Route obtains `period_id` from `accounting_periods` (query by business + dates).
2. Route calls `get_profit_and_loss_from_trial_balance(p_period_id)` or `get_balance_sheet_from_trial_balance(p_period_id)`.
3. Those call `get_trial_balance_from_snapshot(p_period_id)`.
4. `get_trial_balance_from_snapshot` reads `trial_balance_snapshots` for that `period_id`; if missing, calls `generate_trial_balance(p_period_id, NULL)`.
5. `generate_trial_balance` reads `accounting_periods`, `accounts`, `period_opening_balances`, `journal_entry_lines`, `journal_entries`; writes `trial_balance_snapshots`.

---

## 5. Service-only failure modes (evidence-based)

| Failure mode | Can happen? | File:line proof |
|--------------|-------------|------------------|
| **Invoice created as draft → no JE** | **YES** | 043:931–934: post only when `NEW.status IN ('sent','paid','partially_paid')` and `(OLD.status IS NULL OR OLD.status = 'draft')`. Draft insert has `OLD` null, `NEW.status = 'draft'` → condition false → no `post_invoice_to_ledger`, no JE. |
| **Invoice sent in closed/missing period → posting fails** | **YES** | 190:398–399: `post_invoice_to_ledger` calls `assert_accounting_period_is_open(business_id_val, invoice_record.issue_date)`. 166:117–130: assert raises for status `locked` or (for non-adjustments) `soft_closed`. So send in closed period → trigger raises → no JE. |
| **Payment can post even if invoice didn’t post → AR distortion** | **YES** | 190:998–1122: `post_invoice_payment_to_ledger` has no call to `assert_accounting_period_is_open`. 043:955–966: payment INSERT fires `trigger_post_payment` → `post_payment_to_ledger` → that implementation is `post_invoice_payment_to_ledger`. So payment posts regardless of invoice period. Result: AR credited, cash debited without prior invoice AR debit → AR understated/negative, cash overstated. |
| **Service business with no accounting_periods → report cannot run** | **YES** | profit-loss 47–59: route queries `accounting_periods` with `business_id`, `lte("period_start", startDate)`, `gte("period_end", endDate)`, `maybeSingle()`. If no row → `!period` → 404 “No accounting period found” (55–59). balance-sheet 42–54: same idea for `as_of_date`. Neither route creates periods; both need an existing row to get `period.id`. |

---

## 6. Minimum safe unblock conditions (Go/No-Go checklist)

Conditions that must hold **before** a service owner is allowed to see P&L or Balance Sheet. Not design—concrete checks only.

- **Periods exist**
  - **Check:** For the service business, `accounting_periods` has at least one row.  
  - **Concrete:** `SELECT 1 FROM accounting_periods WHERE business_id = :business_id LIMIT 1` returns a row.  
  - **If false:** Report path returns 404 (no period) and never runs the report RPCs.

- **Invoice posting consistent**
  - **Check:** Invoices post only when status is sent/paid/partially_paid; and posting is blocked when the period for `issue_date` is not open.  
  - **Concrete:** (1) No JE with `reference_type = 'invoice'` exists for invoices that still have `status = 'draft'`. (2) `post_invoice_to_ledger` (190:398–399) calls `assert_accounting_period_is_open(business_id, issue_date)` — already enforced in DB.

- **Payment posting consistent**
  - **Check:** Payments do not post when the relevant period (e.g. payment date or invoice issue date) is closed; or when the related invoice has not been posted.  
  - **Concrete:** Today there is **no** period guard in `post_invoice_payment_to_ledger` (190:998–1122). So “payment posting consistent with period/openness” is **false** until a guard is added.  
  - **Check (weaker):** At least “no payment without a corresponding invoice JE when invoice is sent.” Not enforced in DB today; only “payment can post even if invoice didn’t” is prevented by adding a period (or invoice-post) check to payment posting.

- **Report inputs available**
  - **Check:** Caller can resolve a `period_id` for the business and requested range.  
  - **Concrete:** `accounting_periods` contains a row for that business and that range/date; route uses it to get `period.id` and call `get_*_from_trial_balance(period.id)`.

- **Access control**
  - **Check:** Only allowed roles (e.g. owner/admin or accountant) can trigger the report.  
  - **Concrete:** Operational report routes (profit-loss, balance-sheet) do **not** check role; they only use `getCurrentBusiness`. So “only owner/accountant” is **false** for those routes until a role check is added (or until service uses accounting routes, which already enforce role).

**Go/No-Go summary**

| Condition | Must be true? | Today (service) |
|-----------|----------------|-----------------|
| At least one `accounting_periods` row for business | Yes | No for many service-only businesses (no automatic creation in service path). |
| Invoice posting only when sent/paid/partially_paid | Yes | Yes (trigger condition). |
| Invoice posting blocked for closed/missing period | Yes | Yes (assert in `post_invoice_to_ledger`). |
| Payment posting blocked when period closed / invoice not posted | Yes (for consistency) | **No** — payment posting has no period guard. |
| Report caller has role allowed to see P&L/BS | Yes | N/A while 410 is in place; if 410 removed, **no** — operational routes do not check role. |

**Verdict:** Service owners **cannot** be said to safely see P&L/BS with the **current** code unless: (1) they use a path that already enforces role and period (e.g. accounting report routes), and (2) either the business already has periods or the flow that builds the report/period list creates a period when none exist, and (3) payment posting is later aligned with period (and optionally invoice-post) rules so that “payment posts, invoice didn’t” cannot occur.

---

## 7. Service paths: period creation and payment-posting safeguards

**Task:** Confirm whether any existing SERVICE user path (1) creates `accounting_periods` automatically, or (2) prevents payment posting when invoice posting failed.  
**Checks:** Service onboarding flows; call sites of `initialize_business_accounting_period`; callers of `post_invoice_payment_to_ledger`.

### 7.1 Does any SERVICE path create `accounting_periods` automatically?

**Answer: NO — no existing safeguard.**

**Evidence:**

| Check | Result | File:line proof |
|-------|--------|------------------|
| **Call sites of `initialize_business_accounting_period`** | Only one application call; it is **retail-only** | `app/api/onboarding/retail/finalize/route.ts` **197**: `await supabase.rpc("initialize_business_accounting_period", { p_business_id: businessId, p_start_date: ... })`. Same file **50–55**: `if (business.industry !== "retail") { return ... "This endpoint is for Retail businesses only" }`. So SERVICE users never hit this route. |
| **Service onboarding flows** | None create periods | `app/business-setup/page.tsx` **76–86**: Inserts business (name, industry, start_date, onboarding_step: "business_profile"); redirects to `/onboarding`. No RPC, no `accounting_periods`. `app/onboarding/page.tsx` **78–81**: If `industry === "retail"` redirects to `/onboarding/retail`; service users stay on generic onboarding and only update `onboarding_step` via Supabase (no period API). No service-specific finalize API exists. `app/api/onboarding/` contains only `retail/finalize/route.ts` — no `service/` or generic finalize that calls `initialize_business_accounting_period`. |

**Conclusion:** No SERVICE user path calls `initialize_business_accounting_period` or creates `accounting_periods`. Period creation is only in the **retail** onboarding finalize route.

---

### 7.2 Does any SERVICE path prevent payment posting when invoice posting failed?

**Answer: NO — no existing safeguard.**

**Evidence:**

| Check | Result | File:line proof |
|-------|--------|------------------|
| **Callers of `post_invoice_payment_to_ledger`** | Only the DB trigger; no app-level guard | **DB:** `supabase/migrations/043_accounting_core.sql` **965**: `PERFORM post_payment_to_ledger(NEW.id);` inside `trigger_post_payment` (trigger on `payments` INSERT). `post_payment_to_ledger` is alias for `post_invoice_payment_to_ledger` (190:858–989, 998–1122). **App:** No route or service calls `post_invoice_payment_to_ledger` or `post_payment_to_ledger`. `app/api/invoices/[id]/mark-paid/route.ts` **122** only documents that the trigger posts; it does not call the RPC or check period/invoice-post. |
| **Payment create path (service)** | Inserts into `payments`; no check for period open or “invoice posted” | `app/api/payments/create/route.ts` **121–170**: Validates invoice exists, amount &gt; 0, amount ≤ remaining balance. **184–208**: Inserts into `payments`. No check for accounting period open, no check for existence of a journal entry for the invoice. Trigger runs on INSERT and calls `post_invoice_payment_to_ledger`, which has no `assert_accounting_period_is_open` (190:998–1122). |
| **Mark-paid path (service)** | Same: inserts payment; trigger posts; no guard | `app/api/invoices/[id]/mark-paid/route.ts` **96–110**: Inserts into `payments`. **120–123**: Comment states “The database trigger will automatically … Post payment to ledger via post_invoice_payment_to_ledger()”. No check that invoice is posted or that the period is open before insert. |

**Conclusion:** Payment posting is invoked only by the trigger on `payments` INSERT. No SERVICE path checks “invoice period open” or “invoice has been posted” before inserting a payment. `post_invoice_payment_to_ledger` does not call `assert_accounting_period_is_open`. Therefore no existing path prevents payment posting when invoice posting failed.

---

**Document:** `SERVICE_PNL_BS_VALIDATION_AUDIT.md`  
**Scope:** Service workspace validation only. Evidence-based, read-only. No code or design changes.
