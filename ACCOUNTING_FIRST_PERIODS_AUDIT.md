# Accounting-First Workspace — Client Periods Audit

**Role:** Senior accounting systems auditor  
**Scope:** Accounting-first workspace ONLY. Read-only. No fixes, refactors, or design proposals.  
**Goal:** Explain how the presence or absence of accounting periods in a **client business** affects an accounting-first user (owner/admin/accountant) in Finza.

---

## 1. Report-by-report behavior by period state

### Profit & Loss

**Route:** `GET /api/accounting/reports/profit-and-loss`  
**File:** `app/api/accounting/reports/profit-and-loss/route.ts`

| Client period state | Report load or fail? | Error / guard (file:line) | Failure reason |
|---------------------|----------------------|---------------------------|-----------------|
| **(a) NO rows in `accounting_periods`** | **Fail** | **80–84**: `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | **Missing period_id:** Query `.from("accounting_periods").eq("business_id", businessId).eq("period_start", periodStart).single()` returns no row; route never gets `period.id` to pass to RPC. |
| **(b) HAS periods, OPEN** | **Load** | None. Route gets `period.id`, calls `get_profit_and_loss_from_trial_balance(p_period_id: period.id)` (**89**). | — |
| **(c) HAS periods, SOFT_CLOSED** | **Load** | None. Route does **not** filter or check `status`; same query by `business_id` + `period_start` returns the row; RPC runs. | — |
| **(d) HAS periods, LOCKED** | **Load** | None. Same as (c); no status check in route. | — |

**Evidence (no period → 404):**

```ts
// app/api/accounting/reports/profit-and-loss/route.ts 73-84
    // Get accounting period (need id for canonical functions)
    const { data: period, error: periodError } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", businessId)
      .eq("period_start", periodStart)
      .single()

    if (periodError || !period) {
      return NextResponse.json(
        { error: "Accounting period not found for period_start: " + periodStart },
        { status: 404 }
      )
    }
```

**Evidence (period_start required — no period_id without it):** **65–70**: if `!periodStart` → 400 "period_start is required". So with no periods, the client has no valid `period_start` to pass unless the UI lets them type one; if they pass a date for which no row exists, **80–84** → 404.

---

### Balance Sheet

**Route:** `GET /api/accounting/reports/balance-sheet`  
**File:** `app/api/accounting/reports/balance-sheet/route.ts`

| Client period state | Report load or fail? | Error / guard (file:line) | Failure reason |
|---------------------|----------------------|---------------------------|-----------------|
| **(a) NO rows** | **Fail** | **79–84**: `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | **Missing period_id** — same logic as P&L. |
| **(b) OPEN** | **Load** | None. **87**: `get_balance_sheet_from_trial_balance(p_period_id: period.id)`. | — |
| **(c) SOFT_CLOSED** | **Load** | None. No status check. | — |
| **(d) LOCKED** | **Load** | None. No status check. | — |

**Evidence:** **71–84** — `.from("accounting_periods").eq("business_id", businessId).eq("period_start", periodStart).single()`; **79–84** 404 when no row.

---

### Trial Balance

**Route:** `GET /api/accounting/reports/trial-balance`  
**File:** `app/api/accounting/reports/trial-balance/route.ts`

| Client period state | Report load or fail? | Error / guard (file:line) | Failure reason |
|---------------------|----------------------|---------------------------|-----------------|
| **(a) NO rows** | **Fail** | **80–84**: `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | **Missing period_id** — same pattern. |
| **(b) OPEN** | **Load** | None. **88–89**: `get_trial_balance_from_snapshot(p_period_id: period.id)`. | — |
| **(c) SOFT_CLOSED** | **Load** | None. No status check. | — |
| **(d) LOCKED** | **Load** | None. No status check. | — |

**Evidence:** **72–84** — same query and 404 as P&L/BS.

---

### VAT Report (VAT Export)

**Route:** `GET /api/accounting/exports/vat`  
**File:** `app/api/accounting/exports/vat/route.ts`

| Client period state | Report load or fail? | Error / guard (file:line) | Failure reason |
|---------------------|----------------------|---------------------------|-----------------|
| **(a) NO rows** | **Load** | None. **86–92**: `const { data: accountingPeriod } = await supabase.from("accounting_periods").select("status").eq(...).maybeSingle()` — result is **not** used to gate the request. **82–84**, **121–148**: code uses `periodStart` / `periodEnd` derived from query param `period` (YYYY-MM) and queries `journal_entry_lines` / `calculate_account_balance_as_of` directly. | **Not period_id–dependent:** VAT export uses param-derived dates and ledger only; it does not require a row in `accounting_periods`. |
| **(b) OPEN** | **Load** | N/A. Same behavior; `accountingPeriod` is fetched but not used to pass/fail. | — |
| **(c) SOFT_CLOSED** | **Load** | N/A. Same. | — |
| **(d) LOCKED** | **Load** | N/A. Same. | — |

**Evidence (VAT does not require period row):**

```ts
// app/api/accounting/exports/vat/route.ts 86-92, 121-148
    // Check accounting period exists and get status
    const { data: accountingPeriod } = await supabase
      .from("accounting_periods")
      .select("status")
      .eq("business_id", businessId)
      .eq("period_start", periodStart)
      .maybeSingle()

    // Resolve VAT control account code from control map
    const taxControlCodes = await getTaxControlAccountCodes(supabase, businessId)
    // ... then ...
    const { data: openingBalance } = await supabase.rpc("calculate_account_balance_as_of", { ... })
    const { data: periodLines } = await supabase.from("journal_entry_lines")...
```

There is no `if (!accountingPeriod) return 404`. Export proceeds using `periodStart`/`periodEnd` from the param.

---

## 2. Summary table — by period state

| Report | No periods (a) | Open (b) | Soft_closed (c) | Locked (d) |
|--------|-----------------|----------|------------------|------------|
| **Profit & Loss** | **404** — missing period_id (80–84) | Load | Load | Load |
| **Balance Sheet** | **404** — missing period_id (79–84) | Load | Load | Load |
| **Trial Balance** | **404** — missing period_id (80–84) | Load | Load | Load |
| **VAT Export** | **Load** — uses param dates, no period row required | Load | Load | Load |

**Failure reasons when they occur:** Only **missing period_id**. No report route checks **period status** (open/soft_closed/locked). Role checks (403) are done before period lookup (**45–59** in P&L, same pattern in BS/TB; VAT uses `can_accountant_access_business` **43–63**). Snapshot is used only when the route already has a `period.id` (P&L/BS/TB); VAT does not use snapshots.

---

## 3. Ledger posting impact (accounting-first user, client business)

Posting is triggered by **client** data (invoices, payments, adjustments) or by accounting-user actions (e.g. approving/post adjustments). The relevant guards are in DB functions and triggers, not in accounting-first–specific routes.

| Posting type | Can still post when client has no periods? | Can post when OPEN? | Can post when SOFT_CLOSED? | Can post when LOCKED? | Guard (file:line) |
|--------------|--------------------------------------------|---------------------|----------------------------|------------------------|-------------------|
| **Invoices** | **Yes** — `assert_accounting_period_is_open` calls `ensure_accounting_period` (**166:114**), which creates a period for that date if none exists (**094:85–88**), then asserts status. First invoice post can thus create the period and post. | Yes | No (regular) | No | **190:399** `PERFORM assert_accounting_period_is_open(business_id_val, invoice_record.issue_date)` inside `post_invoice_to_ledger`. **166:103–137**: locked → RAISE; soft_closed + non-adjustment → RAISE. |
| **Payments** | **Yes** — no period assert in payment posting path | Yes | Yes | Yes | **190:998–1122** `post_invoice_payment_to_ledger`: **no** `assert_accounting_period_is_open`. **043:965** trigger calls `post_payment_to_ledger(NEW.id)`. |
| **Adjustments** | **Yes** — `assert_accounting_period_is_open` uses `ensure_accounting_period` (**166:114**), so period is created for adjustment_date if missing; then status is checked | Yes | **No** (current code passes 2 args → p_is_adjustment FALSE) | No | **189:807–809** `PERFORM assert_accounting_period_is_open(p_business_id, p_adjustment_date)` in `post_adjustment_to_ledger`. **166:101** dropped 2-arg overload; only 3-arg `(p_business_id, p_date, p_is_adjustment DEFAULT FALSE)` exists, so 2-arg call ⇒ FALSE ⇒ blocked in soft_closed. **166:117–130** locked always blocks; soft_closed allows only when `p_is_adjustment = TRUE`. |

**Evidence — invoice posting period guard:**  
`supabase/migrations/190_fix_posting_source_default_bug.sql` **398–399**:

```sql
  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, invoice_record.issue_date);
```

**Evidence — payment posting has no period guard:**  
`supabase/migrations/190_fix_posting_source_default_bug.sql` **998–1048**: `post_invoice_payment_to_ledger` runs from `business_id_val := payment_record.business_id` through COA checks to `post_journal_entry` (**1091**). No call to `assert_accounting_period_is_open`. Same file uses that assert in invoice (399), bill (568), expense (735), credit_note (1321) — not in payment.

**Evidence — assert behavior (open / soft_closed / locked):**  
`supabase/migrations/166_controlled_adjustments_soft_closed.sql` **103–137**:

```sql
  -- PHASE 6: Hard enforcement - block locked periods (always)
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Accounting period is locked (period_start: %). Posting is blocked for all entries including adjustments. ...'
  END IF;

  -- PHASE 6: Allow adjustments in soft_closed periods
  IF period_record.status = 'soft_closed' THEN
    IF p_is_adjustment = TRUE THEN
      RETURN;   -- allowed
    ELSE
      RAISE EXCEPTION 'Accounting period is soft-closed (...). Regular postings are blocked. Only adjustments are allowed in soft-closed periods.';
    END IF;
  END IF;
```

**Which posting paths use the assert and which do not**

| Path | Uses `assert_accounting_period_is_open`? | File:line |
|------|------------------------------------------|-----------|
| `post_invoice_to_ledger` | Yes | 190:399 |
| `post_bill_to_ledger` | Yes | 190:568 |
| `post_expense_to_ledger` | Yes | 190:735 |
| `post_credit_note_to_ledger` | Yes | 190:1321 |
| `post_invoice_payment_to_ledger` | **No** | 190:998–1122 |
| `post_adjustment_to_ledger` | Yes (2 args ⇒ p_is_adjustment FALSE) | 189:809 |
| `post_journal_entry` (canonical) | No (callers assert) | 190:98–236 — no assert in body |

---

## 4. Snapshot behavior

**If `trial_balance_snapshots` is missing but periods exist, does the accounting report auto-generate it?**

**Yes.**  
`supabase/migrations/169_trial_balance_canonicalization.sql` **216–246**:

```sql
CREATE OR REPLACE FUNCTION get_trial_balance_from_snapshot(p_period_id UUID) ...
  SELECT * INTO snapshot_record
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id;

  -- If snapshot doesn't exist, generate it first
  IF NOT FOUND THEN
    PERFORM generate_trial_balance(p_period_id, NULL);
    SELECT * INTO snapshot_record
    FROM trial_balance_snapshots
    WHERE period_id = p_period_id;
  END IF;
```

P&L and BS call `get_profit_and_loss_from_trial_balance(p_period_id)` / `get_balance_sheet_from_trial_balance(p_period_id)`, which call `get_trial_balance_from_snapshot(p_period_id)`; that calls `generate_trial_balance(p_period_id, NULL)` when no snapshot exists. So for an existing `period_id`, the snapshot is created on demand.

**If periods do NOT exist, does snapshot generation ever occur?**

**No.**  
Snapshot generation is only reached when the route has a `period.id`. Routes get `period.id` from `accounting_periods` (**profit-and-loss 73–79**, **balance-sheet 71–77**, **trial-balance 73–79**). If the client has no rows, the route returns 404 (**80–84**) and never calls the RPC. So `get_trial_balance_from_snapshot` and `generate_trial_balance` are never run when there are no periods.  
`generate_trial_balance` itself (**169:76–84**) does `SELECT * INTO period_record FROM accounting_periods WHERE id = p_period_id` and raises if not found, so it only runs when a period row exists.

---

## 5. Governance — safeguards when client has no periods

**Does an accounting-first user have any hidden safeguard that prevents misleading reports when periods are missing?**

**For P&L, Balance Sheet, and Trial Balance:** Yes — the route **requires** a row in `accounting_periods` for the chosen `period_start`. If the client has no periods, the query returns no row and the route returns **404** with "Accounting period not found for period_start: ...". The user never sees a report built from an undefined or synthetic period; they get an explicit error.  
**File:line:** `app/api/accounting/reports/profit-and-loss/route.ts` **73–84** (and equivalent in balance-sheet and trial-balance).

**For VAT Export:** No. The route does **not** require a row in `accounting_periods`. It computes VAT from param-derived dates and ledger only. So when the client has **no** periods, P&L/BS/TB are blocked by 404, but VAT Export can still run and return numbers for the requested YYYY-MM. The system does **not** treat “no accounting periods” as “do not run any reports”; it only blocks the period-based reports.  
**File:line:** `app/api/accounting/exports/vat/route.ts` **86–92** — `accountingPeriod` is loaded but never used to block the request.

**Does the system rely entirely on period existence?**

- **For P&L, BS, TB:** Yes. Those reports depend on `period_id` and therefore on at least one row in `accounting_periods` for the client. No period ⇒ no report.
- **For VAT Export:** No. It relies on `business_id`, requested period (YYYY-MM), and ledger/account data, not on `accounting_periods` for pass/fail.

---

## 6. Final verdict

**Accounting-first users are CONDITIONALLY SAFE when client businesses lack accounting periods.**

- **Safe for P&L, Balance Sheet, Trial Balance:** The APIs return **404** when the client has no row in `accounting_periods` for the requested `period_start`. The user cannot get those reports without a real period; the safeguard is “no period_id ⇒ no report.”  
  **Evidence:** `app/api/accounting/reports/profit-and-loss/route.ts` **80–84**, `app/api/accounting/reports/balance-sheet/route.ts` **79–84**, `app/api/accounting/reports/trial-balance/route.ts` **80–84**.
- **Not safe for VAT in the “no periods” case:** VAT Export runs and returns data even when the client has no `accounting_periods`, so the accounting-first user can see a VAT-style report for a client that has no defined accounting periods. The system does not enforce “periods must exist” for VAT.  
  **Evidence:** `app/api/accounting/exports/vat/route.ts` **86–92** (fetch unused for gating), **121–156** (logic uses param and ledger only).

**Conditionally safe** means: safety depends on which report is used. Period-based reports (P&L, BS, TB) are protected by period existence; VAT Export is not.

---

**Document:** `ACCOUNTING_FIRST_PERIODS_AUDIT.md`  
**Scope:** Accounting-first workspace only. Evidence-based, read-only.
