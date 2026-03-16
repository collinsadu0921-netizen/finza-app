# Accounting Period Creation — Call Sites and Runtime Paths Audit

**Scope:** All direct or indirect calls to `initialize_business_accounting_period`, `ensure_accounting_period`, and any `INSERT INTO accounting_periods`.  
**Goal:** Confirm whether any **service or retail runtime path (outside onboarding)** could invoke period creation unintentionally.  
**Read-only.** No fixes.

For each creation path: **file:line**, **caller**, **industry gate (if any)**.

---

## 1. initialize_business_accounting_period

| File | Line(s) | Caller | Industry gate |
|------|---------|--------|----------------|
| `app/api/onboarding/retail/finalize/route.ts` | **197–200** | POST /api/onboarding/retail/finalize (retail onboarding finalize) | **Yes.** Route returns 400 for non-retail at **50–55**: `if (business.industry !== "retail") { return NextResponse.json({ error: "Invalid business type: This endpoint is for Retail businesses only" }, { status: 400 }) }`. Service never reaches the RPC. |
| `supabase/migrations/177_retail_accounting_period_initialization.sql` | **45–88** | Function definition; only invoked by the app call above. | N/A (DB has no industry). |

**Conclusion:** The **only** application call to `initialize_business_accounting_period` is in retail onboarding finalize, behind an industry check. No service runtime path calls it. No other app route or RPC invokes it.

---

## 2. ensure_accounting_period

| File | Line(s) | Caller | Industry gate |
|------|---------|--------|----------------|
| `supabase/migrations/094_accounting_periods.sql` | **59–93** | Function definition. | N/A. |
| `supabase/migrations/094_accounting_periods.sql` | **105–107** | `assert_accounting_period_is_open(p_business_id, p_date)` — first caller in same migration. | **None.** DB has no industry. |
| `supabase/migrations/165_period_locking_posting_guards.sql` | **29–31** | `assert_accounting_period_is_open` (165 def) calls `ensure_accounting_period`. | **None.** |
| `supabase/migrations/166_controlled_adjustments_soft_closed.sql` | **112–114** | `assert_accounting_period_is_open` (166 def) calls `SELECT * FROM ensure_accounting_period(p_business_id, p_date)`. | **None.** |

**Who calls assert_accounting_period_is_open?** (All DB; no industry gate in any path.)

- **post_invoice_to_ledger** — e.g. `supabase/migrations/190_fix_posting_source_default_bug.sql` **399**
- **post_bill_to_ledger** — e.g. **190** **568**
- **post_expense_to_ledger** — e.g. **190** **735**
- **post_credit_note_to_ledger** — e.g. **190** **1321**
- **post_adjustment_to_ledger** — e.g. `supabase/migrations/189_fix_ledger_posting_authorization.sql` **809**
- **post_sale_to_ledger** — multiple migrations (e.g. **190**, **179**, **175**, **162**); retail/pos-heavy but DB does not check industry.
- **post_refund_*** / void paths — **191**, **192**
- **PO receive / PO payment** — **198** **637**, **786**
- **Layaway** — **197** **369**, **596**
- **Stock transfer** — **196** **351**
- **post_opening_balance** (opening balance posting) — **096** **69**, **099** **910**
- **post_journal_entry** (canonical, 3-arg) — **179** **94** (called by draft-journal post, etc.)

**How do posting functions get invoked at runtime?**

- **Invoices:** Trigger `trigger_auto_post_invoice` on `invoices` (AFTER INSERT OR UPDATE OF status) → `trigger_post_invoice()` → `post_invoice_to_ledger(NEW.id)` — **043:949–952**.
- **Credit notes:** Trigger on `credit_notes` (AFTER INSERT OR UPDATE OF status) → `trigger_post_credit_note()` → `post_credit_note_to_ledger(NEW.id)` — **043:1004–1008**.
- **Bills:** Trigger on `bills` (AFTER INSERT OR UPDATE OF status) → `trigger_post_bill()` → `post_bill_to_ledger(NEW.id)` — **043:1038–1042**.
- **Expenses:** Trigger on `expenses` (AFTER INSERT) → `trigger_post_expense()` → `post_expense_to_ledger(NEW.id)` — **043:1106–1110**.
- **Sales:** App calls `post_sale_to_ledger` from `app/api/sales/create/route.ts` **1309**; also DB triggers on sales where applicable.
- **Adjustments:** App calls adjustment-posting RPC / apply flow → `post_adjustment_to_ledger`.
- **Opening balances:** Accounting workspace opening-balance post → `post_opening_balance` → `assert_accounting_period_is_open`.

**Conclusion:** `ensure_accounting_period` is called only from `assert_accounting_period_is_open`. There is **no industry gate** in the DB. Any path that posts an invoice, bill, expense, credit note, adjustment, opening balance, or (where wired) sale will, when the period for that date is missing, cause `ensure_accounting_period` to run and create the period. **Service and retail** both have invoices, expenses, credit notes, and (for accounting workspace) adjustments and opening balances. So **yes — service and retail runtime paths outside onboarding can trigger period creation** via `ensure_accounting_period`. Behavior is by design (find-or-create for that date), but it is **outside** onboarding and **un-gated** by industry.

---

## 3. INSERT INTO accounting_periods

| File | Line(s) | Caller | Industry gate |
|------|---------|--------|----------------|
| `supabase/migrations/094_accounting_periods.sql` | **86–88** | Inside `ensure_accounting_period`. Runs when no period exists for (business_id, month of p_date). | **None.** Invoked by any posting path that calls `assert_accounting_period_is_open` (see §2). |
| `supabase/migrations/177_retail_accounting_period_initialization.sql` | **78–87** | Inside `initialize_business_accounting_period`. Runs when the business has **no** accounting periods. | **None in DB.** Only caller is `app/api/onboarding/retail/finalize/route.ts` **197**, which has an industry gate (retail only) at **50–55**. |

**Other INSERTs (not runtime business logic):**

- `finza-web/VERIFICATION_SCRIPTS.sql` **108–110** — test/verification script; not a service/retail runtime path.
- `finza-web/TEST_DATABASE_SEED.sql` **239**, **257** — test seed data; not runtime.
- Test files (e.g. `lib/accountingPeriods/__tests__/phase1b.validation.test.ts`) — comments only; no executed INSERT in app runtime.

---

## 4. Summary: Can service or retail runtime (outside onboarding) invoke period creation?

| Path | Service runtime? | Retail runtime? | Industry gate | Unintentional? |
|------|------------------|----------------|---------------|----------------|
| **initialize_business_accounting_period** (app call) | **No** | Only via onboarding finalize | **Yes** — retail-only at **50–55** | N/A — onboarding is intentional. |
| **ensure_accounting_period** (DB, from assert_accounting_period_is_open) | **Yes** | **Yes** | **None** | **Yes.** Any first invoice/bill/expense/credit-note/adjustment/opening-balance post for a date with no period creates that period. Service and retail both use these flows. No industry check. |
| **INSERT in 094** (inside ensure_accounting_period) | **Yes** | **Yes** | **None** | Same as above. |
| **INSERT in 177** (inside initialize_business_accounting_period) | **No** | Only via onboarding | **Yes** at route | N/A. |

**Direct answer:**  
**Yes.** A **service** or **retail** runtime path **outside onboarding** can trigger period creation. The path is:

1. User (or integration) creates/updates an **invoice**, **bill**, **expense**, or **credit note**, or posts an **adjustment** or **opening balance**, in a way that causes the corresponding posting function to run.
2. Posting function calls `assert_accounting_period_is_open(business_id, date)`.
3. `assert_accounting_period_is_open` calls `ensure_accounting_period(business_id, date)`.
4. If no row exists for that business and month, `ensure_accounting_period` performs `INSERT INTO accounting_periods` (**094:86–88**).

There is **no industry gate** in this chain. Service businesses use invoices, expenses, credit notes, and (in accounting workspace) adjustments and opening balances, so they can hit this path. Retail can too (invoices, bills, expenses, etc.). The creation is “unintentional” only in the sense that the caller did not explicitly request “create a period”; the design is find-or-create for the given date, so creation is a side effect of posting when no period exists.

**Only path that is explicitly gated by industry:**  
`initialize_business_accounting_period` is called only from `app/api/onboarding/retail/finalize/route.ts` **197**, and that route returns 400 for non-retail at **50–55**. No service path calls it.

---

**Document:** `ACCOUNTING_PERIOD_CREATION_PATHS_AUDIT.md`  
**Scope:** All calls to period-creation functions and INSERTs into `accounting_periods`. Read-only.
