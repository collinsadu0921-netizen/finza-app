# INTERNAL WORKFLOW TEST REPORT — Expenses & Paid Invoices Not Reflecting in Reports

**Date:** 2026-02-01  
**Tester:** Principal Accounting Systems Engineer  
**Mode:** Read-only workflow analysis  
**Objective:** Identify why expenses and paid invoices are not appearing in Profit & Loss, Balance Sheet, and Accounting Portal reports.

---

## EXECUTIVE SUMMARY

**ROOT CAUSE IDENTIFIED:** **Period Resolution Mismatch**

Expenses and invoices ARE being posted to the ledger correctly, but reports are querying a different accounting period than the one containing the posted journal entries. This causes empty reports even when ledger data exists.

**Key Findings:**
1. ✅ **Expenses ARE posted automatically** via `trigger_auto_post_expense` (AFTER INSERT)
2. ✅ **Invoices ARE posted automatically** via `trigger_auto_post_invoice` (when status changes to 'sent')
3. ✅ **Payments ARE posted automatically** via `trigger_auto_post_payment` (AFTER INSERT)
4. ❌ **Reports default to current date period**, but posting uses transaction date (`expense.date`, `invoice.sent_at`/`issue_date`)
5. ❌ **Trial Balance snapshots filter by period boundaries**, excluding entries from other periods

---

## PART 1 — EXPENSE POSTING WORKFLOW

### 1.1 Expense Creation → Ledger Posting

**Workflow Steps:**

1. **User creates expense** via `POST /api/expenses/create`
   - **File:** `app/api/expenses/create/route.ts`
   - **Lines:** 57-82
   - **Action:** Inserts into `expenses` table with `date`, `amount`, `total`, tax fields

2. **Database trigger fires** (`trigger_auto_post_expense`)
   - **File:** `supabase/migrations/043_accounting_core.sql`
   - **Lines:** 1107-1110
   - **Trigger:** `AFTER INSERT ON expenses`
   - **Function:** `trigger_post_expense()` (lines 1081-1095)

3. **Trigger function calls** `post_expense_to_ledger(p_expense_id)`
   - **File:** `supabase/migrations/229_expense_posting_schema_aligned.sql`
   - **Lines:** 23-219
   - **Posting Date:** Uses `expense_row.date` (line 201)
   - **Period Guard:** `assert_accounting_period_is_open(business_id_val, expense_row.date)` (line 121)

4. **Journal entry created** with `date = expense.date`
   - **Accounts:** Expense (5100) Debit, Cash (1000) Credit, Tax accounts Debit
   - **Reference:** `reference_type = 'expense'`, `reference_id = expense.id`

**VERDICT:** ✅ **Expenses ARE posted to ledger automatically**

**Evidence:**
- Trigger exists: `trigger_auto_post_expense` (migration 043, line 1107)
- Function exists: `post_expense_to_ledger` (migration 229)
- Period guard ensures posting date is in an open period

---

### 1.2 Expense Posting Date Resolution

**Evidence:** `supabase/migrations/229_expense_posting_schema_aligned.sql` (line 201)

```sql
SELECT post_journal_entry(
  business_id_val,
  expense_row.date,  -- ← Uses expense.date, NOT CURRENT_DATE
  v_description,
  'expense',
  p_expense_id,
  journal_lines,
  ...
) INTO journal_id;
```

**VERDICT:** ✅ **Posting uses `expense.date`**, not current date

**Example Scenario:**
- Expense created on **2026-01-15** with `date = '2026-01-15'`
- Journal entry created with `date = '2026-01-15'`
- Period resolved: **January 2026** (`2026-01-01` to `2026-01-31`)

---

## PART 2 — INVOICE POSTING WORKFLOW

### 2.1 Invoice Creation → Ledger Posting

**Workflow Steps:**

1. **User creates invoice** (draft status)
   - **Status:** `'draft'`
   - **No posting occurs** (trigger checks for 'sent'/'paid' status)

2. **User sends invoice** via `POST /api/invoices/[id]/send`
   - **File:** `app/api/invoices/[id]/send/route.ts`
   - **Action:** Updates `status = 'sent'`, `sent_at = NOW()`

3. **Database trigger fires** (`trigger_auto_post_invoice`)
   - **File:** `supabase/migrations/043_accounting_core.sql`
   - **Lines:** 949-952
   - **Trigger:** `AFTER INSERT OR UPDATE OF status ON invoices`
   - **Function:** `trigger_post_invoice()` (lines 929-945)

4. **Trigger function calls** `post_invoice_to_ledger(p_invoice_id)`
   - **File:** `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql`
   - **Lines:** 17-220
   - **Posting Date:** Uses `COALESCE(sent_at, issue_date)` (lines 75-78)
   - **Period Guard:** `assert_accounting_period_is_open(business_id_val, posting_date)` (line 109)

5. **Journal entry created** with `date = posting_date`
   - **Accounts:** AR (1100) Debit, Revenue (4000) Credit, Tax accounts Credit
   - **Reference:** `reference_type = 'invoice'`, `reference_id = invoice.id`

**VERDICT:** ✅ **Invoices ARE posted to ledger automatically when sent**

---

### 2.2 Invoice Payment → Ledger Posting

**Workflow Steps:**

1. **User marks invoice as paid** via `POST /api/invoices/[id]/mark-paid`
   - **File:** `app/api/invoices/[id]/mark-paid/route.ts`
   - **Lines:** 122-136
   - **Action:** Creates `payments` record (NOT directly updating invoice status)

2. **Database trigger fires** (`trigger_auto_post_payment`)
   - **File:** `supabase/migrations/043_accounting_core.sql`
   - **Lines:** 973-976
   - **Trigger:** `AFTER INSERT ON payments`
   - **Function:** `trigger_post_payment()` (lines 955-969)

3. **Trigger function calls** `post_payment_to_ledger(p_payment_id)`
   - **Posting Date:** Uses `payment.date`
   - **Accounts:** Cash/Bank/MoMo Debit, AR (1100) Credit

4. **Invoice status updated** via `recalculate_invoice_status()` trigger
   - **File:** `supabase/migrations/129_fix_invoice_status_sync.sql`
   - **Status:** Derived from payment state (not authoritative)

**VERDICT:** ✅ **Payments ARE posted to ledger automatically**

---

### 2.3 Invoice Posting Date Resolution

**Evidence:** `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` (lines 74-81)

```sql
-- Posting date: sent_at when issued, else issue_date. Block if both null.
posting_date := COALESCE(
  (invoice_record.sent_at AT TIME ZONE 'UTC')::DATE,
  invoice_record.issue_date
);
```

**VERDICT:** ✅ **Posting uses `sent_at` or `issue_date`**, not current date

**Example Scenario:**
- Invoice created on **2026-01-10** with `issue_date = '2026-01-10'`
- Invoice sent on **2026-01-15** (`sent_at = '2026-01-15 10:00:00 UTC'`)
- Journal entry created with `date = '2026-01-15'` (from `sent_at`)
- Period resolved: **January 2026** (`2026-01-01` to `2026-01-31`)

---

## PART 3 — REPORT QUERY WORKFLOW

### 3.1 Profit & Loss Report Period Resolution

**Evidence:** `app/api/reports/profit-loss/route.ts` (lines 28-74)

**Period Resolution:**
```typescript
const startDate = searchParams.get("start_date")
const endDate = searchParams.get("end_date")

if (!startDate || !endDate) {
  return NextResponse.json(
    { error: "start_date and end_date are required." },
    { status: 400 }
  )
}

let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", startDate)  // Period start <= startDate
  .gte("period_end", endDate)      // Period end >= endDate
  .maybeSingle()
```

**VERDICT:** ⚠️ **P&L requires explicit `start_date`/`end_date` params**

**If params missing:** Returns 400 error (no default)

**If params provided:** Resolves period containing date range

---

### 3.2 Trial Balance Report Period Resolution

**Evidence:** `app/api/reports/trial-balance/route.ts` (lines 28-68)

**Period Resolution:**
```typescript
const asOfDate = searchParams.get("as_of_date") || new Date().toISOString().split("T")[0]
// ↑ DEFAULTS TO CURRENT DATE if param missing

let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", asOfDate)
  .gte("period_end", asOfDate)
  .maybeSingle()
```

**VERDICT:** ❌ **Trial Balance defaults to CURRENT DATE period**

**Example Scenario:**
- Today is **2026-02-01** (February)
- Expense posted on **2026-01-15** (January)
- Report queries: `asOfDate = '2026-02-01'` (default)
- Period resolved: **February 2026** (`2026-02-01` to `2026-02-28`)
- **January entries excluded** from snapshot

---

### 3.3 Balance Sheet Report Period Resolution

**Evidence:** `app/api/reports/balance-sheet/route.ts` (lines 28-68)

**Period Resolution:**
```typescript
const asOfDate = searchParams.get("as_of_date") || new Date().toISOString().split("T")[0]
// ↑ DEFAULTS TO CURRENT DATE if param missing

let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", asOfDate)
  .gte("period_end", asOfDate)
  .maybeSingle()
```

**VERDICT:** ❌ **Balance Sheet defaults to CURRENT DATE period**

**Same issue as Trial Balance:** Entries from previous months excluded

---

### 3.4 Accounting Portal Reports Period Resolution

**Evidence:** `app/api/accounting/reports/profit-and-loss/route.ts` (lines 32-94)

**Period Resolution:**
```typescript
const periodStart = searchParams.get("period_start")

if (!periodStart) {
  return NextResponse.json(
    { error: "PHASE 10: period_start is required. Canonical P&L requires an accounting period." },
    { status: 400 }
  )
}

let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", businessId)
  .eq("period_start", periodStart)  // ← Exact match
  .single()
```

**VERDICT:** ⚠️ **Accounting Portal requires explicit `period_start` param**

**If param missing:** Returns 400 error (no default)

**If param provided:** Resolves exact period by `period_start`

---

## PART 4 — TRIAL BALANCE SNAPSHOT GENERATION

### 4.1 Snapshot Generation Logic

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 56-207)

**Function:** `generate_trial_balance(p_period_id, p_generated_by)`

**Key Filter:**
```sql
-- Calculate period activity from ledger (ledger-only source)
SELECT 
  COALESCE(SUM(jel.debit), 0),
  COALESCE(SUM(jel.credit), 0)
INTO period_debit, period_credit
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.account_id = account_record.id
  AND je.business_id = period_record.business_id
  AND je.date >= period_record.period_start  -- ← Period boundary filter
  AND je.date <= period_record.period_end    -- ← Period boundary filter
```

**VERDICT:** ❌ **Snapshots filter journal entries by period boundaries**

**Impact:** If journal entry `date` falls outside the resolved period's `period_start`/`period_end`, it is excluded from the snapshot.

---

### 4.2 Snapshot Retrieval Logic

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 216-261)

**Function:** `get_trial_balance_from_snapshot(p_period_id)`

**Logic:**
1. Fetches snapshot from `trial_balance_snapshots` WHERE `period_id = p_period_id`
2. If snapshot not found, calls `generate_trial_balance(p_period_id, NULL)` to create it
3. Returns snapshot data

**VERDICT:** ✅ **Snapshots are generated on-demand if missing**

**BUT:** Snapshot only includes entries within the resolved period's boundaries

---

## PART 5 — ROOT CAUSE ANALYSIS

### 5.1 Period Resolution Mismatch

**Posting Side:**
- Expenses: Use `expense.date` → Resolves to period containing that date
- Invoices: Use `sent_at` or `issue_date` → Resolves to period containing that date
- Payments: Use `payment.date` → Resolves to period containing that date

**Reporting Side:**
- Trial Balance: Defaults to **current date** → Resolves to **current month period**
- Balance Sheet: Defaults to **current date** → Resolves to **current month period**
- Profit & Loss: Requires explicit dates (no default, but UI may default to current month)

**Mismatch Scenario:**
```
Timeline:
- 2026-01-15: Expense created with date = '2026-01-15'
- 2026-01-15: Expense posted → Journal entry date = '2026-01-15' → Period = January 2026
- 2026-02-01: User views Trial Balance (no as_of_date param)
- 2026-02-01: Report defaults to asOfDate = '2026-02-01' → Period = February 2026
- 2026-02-01: Snapshot generated for February 2026
- 2026-02-01: Snapshot filters: je.date >= '2026-02-01' AND je.date <= '2026-02-28'
- 2026-02-01: January entries (date = '2026-01-15') EXCLUDED → Empty report
```

---

### 5.2 Why VAT Report Works

**Evidence:** `app/api/reports/vat-control/route.ts` (lines 47-161)

**VAT Report Logic:**
```typescript
const startDate = searchParams.get("start_date")  // Required
const endDate = searchParams.get("end_date")      // Required

// Direct query (bypasses period system)
const { data: invoiceLines } = await supabase
  .from("journal_entry_lines")
  .select("...")
  .join("journal_entries", "journal_entry_id", "id")
  .gte("journal_entries.date", startDate)   // ← Direct date filter
  .lte("journal_entries.date", endDate)     // ← Direct date filter
```

**VERDICT:** ✅ **VAT report bypasses period system**

**Why it works:** Uses explicit date range filter directly on `journal_entries.date`, not period boundaries

---

## PART 6 — WORKFLOW TEST SCENARIOS

### Scenario 1: Expense Created Last Month, Report Viewed This Month

**Steps:**
1. **2026-01-15:** User creates expense with `date = '2026-01-15'`
2. **2026-01-15:** Trigger fires → `post_expense_to_ledger` called
3. **2026-01-15:** Journal entry created with `date = '2026-01-15'`
4. **2026-01-15:** Period resolved: January 2026 (`2026-01-01` to `2026-01-31`)
5. **2026-02-01:** User views Trial Balance (no `as_of_date` param)
6. **2026-02-01:** Report defaults to `asOfDate = '2026-02-01'`
7. **2026-02-01:** Period resolved: February 2026 (`2026-02-01` to `2026-02-28`)
8. **2026-02-01:** Snapshot generated for February 2026
9. **2026-02-01:** Snapshot filters: `je.date >= '2026-02-01' AND je.date <= '2026-02-28'`
10. **2026-02-01:** January entry (`date = '2026-01-15'`) **EXCLUDED**

**RESULT:** ❌ **Empty report** (expense exists in ledger but not in snapshot)

---

### Scenario 2: Invoice Sent Last Month, Paid This Month, Report Viewed This Month

**Steps:**
1. **2026-01-10:** User creates invoice with `issue_date = '2026-01-10'`
2. **2026-01-15:** User sends invoice → `status = 'sent'`, `sent_at = '2026-01-15 10:00:00 UTC'`
3. **2026-01-15:** Trigger fires → `post_invoice_to_ledger` called
4. **2026-01-15:** Journal entry created with `date = '2026-01-15'` (from `sent_at`)
5. **2026-01-15:** Period resolved: January 2026
6. **2026-02-01:** User marks invoice as paid → Payment created with `date = '2026-02-01'`
7. **2026-02-01:** Payment trigger fires → `post_payment_to_ledger` called
8. **2026-02-01:** Payment journal entry created with `date = '2026-02-01'`
9. **2026-02-01:** Period resolved: February 2026
10. **2026-02-01:** User views Balance Sheet (no `as_of_date` param)
11. **2026-02-01:** Report defaults to `asOfDate = '2026-02-01'`
12. **2026-02-01:** Period resolved: February 2026
13. **2026-02-01:** Snapshot generated for February 2026
14. **2026-02-01:** Snapshot filters: `je.date >= '2026-02-01' AND je.date <= '2026-02-28'`
15. **2026-02-01:** January invoice entry (`date = '2026-01-15'`) **EXCLUDED**
16. **2026-02-01:** February payment entry (`date = '2026-02-01'`) **INCLUDED**

**RESULT:** ❌ **Partial data** (payment appears, but invoice revenue missing)

---

### Scenario 3: Expense Created This Month, Report Viewed This Month

**Steps:**
1. **2026-02-05:** User creates expense with `date = '2026-02-05'`
2. **2026-02-05:** Trigger fires → Journal entry created with `date = '2026-02-05'`
3. **2026-02-05:** Period resolved: February 2026
4. **2026-02-05:** User views Trial Balance (no `as_of_date` param)
5. **2026-02-05:** Report defaults to `asOfDate = '2026-02-05'`
6. **2026-02-05:** Period resolved: February 2026
7. **2026-02-05:** Snapshot generated for February 2026
8. **2026-02-05:** Snapshot filters: `je.date >= '2026-02-01' AND je.date <= '2026-02-28'`
9. **2026-02-05:** February entry (`date = '2026-02-05'`) **INCLUDED**

**RESULT:** ✅ **Data appears correctly** (same period)

---

## PART 7 — VERIFICATION QUERIES

### Query 1: Check if Expenses Are Posted

```sql
-- Find expenses with journal entries
SELECT 
  e.id,
  e.date AS expense_date,
  e.total,
  je.id AS journal_entry_id,
  je.date AS journal_entry_date,
  ap.period_start,
  ap.period_end
FROM expenses e
LEFT JOIN journal_entries je ON je.reference_type = 'expense' AND je.reference_id = e.id
LEFT JOIN accounting_periods ap ON ap.business_id = e.business_id 
  AND je.date >= ap.period_start 
  AND je.date <= ap.period_end
WHERE e.business_id = '<business_id>'
ORDER BY e.date DESC;
```

**Expected:** All expenses should have corresponding journal entries

---

### Query 2: Check if Invoices Are Posted

```sql
-- Find invoices with journal entries
SELECT 
  i.id,
  i.issue_date,
  i.sent_at,
  i.status,
  je.id AS journal_entry_id,
  je.date AS journal_entry_date,
  ap.period_start,
  ap.period_end
FROM invoices i
LEFT JOIN journal_entries je ON je.reference_type = 'invoice' AND je.reference_id = i.id
LEFT JOIN accounting_periods ap ON ap.business_id = i.business_id 
  AND je.date >= ap.period_start 
  AND je.date <= ap.period_end
WHERE i.business_id = '<business_id>'
  AND i.status IN ('sent', 'paid', 'partially_paid')
ORDER BY i.issue_date DESC;
```

**Expected:** All sent/paid invoices should have corresponding journal entries

---

### Query 3: Check Period Resolution Mismatch

```sql
-- Find journal entries that fall outside current month period
SELECT 
  je.id,
  je.date AS journal_entry_date,
  je.reference_type,
  je.reference_id,
  ap_current.id AS current_period_id,
  ap_current.period_start AS current_period_start,
  ap_current.period_end AS current_period_end,
  ap_entry.id AS entry_period_id,
  ap_entry.period_start AS entry_period_start,
  ap_entry.period_end AS entry_period_end
FROM journal_entries je
JOIN accounting_periods ap_entry ON ap_entry.business_id = je.business_id 
  AND je.date >= ap_entry.period_start 
  AND je.date <= ap_entry.period_end
LEFT JOIN accounting_periods ap_current ON ap_current.business_id = je.business_id 
  AND CURRENT_DATE >= ap_current.period_start 
  AND CURRENT_DATE <= ap_current.period_end
WHERE je.business_id = '<business_id>'
  AND ap_entry.id != ap_current.id;  -- Entry period != current period
```

**Expected:** Should show entries posted in previous months that won't appear in current month reports

---

### Query 4: Check Snapshot Coverage

```sql
-- Compare journal entries vs snapshot data
SELECT 
  ap.id AS period_id,
  ap.period_start,
  ap.period_end,
  COUNT(DISTINCT je.id) AS journal_entry_count,
  CASE WHEN tbs.period_id IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END AS snapshot_status,
  tbs.account_count AS snapshot_account_count
FROM accounting_periods ap
LEFT JOIN journal_entries je ON je.business_id = ap.business_id 
  AND je.date >= ap.period_start 
  AND je.date <= ap.period_end
LEFT JOIN trial_balance_snapshots tbs ON tbs.period_id = ap.id
WHERE ap.business_id = '<business_id>'
GROUP BY ap.id, ap.period_start, ap.period_end, tbs.period_id, tbs.account_count
ORDER BY ap.period_start DESC;
```

**Expected:** Periods with journal entries should have snapshots

---

## PART 8 — ROOT CAUSE SUMMARY

### Primary Issue: Period Resolution Mismatch

**Posting:**
- Uses transaction date (`expense.date`, `invoice.sent_at`, `payment.date`)
- Resolves to period containing transaction date

**Reporting:**
- Trial Balance: Defaults to **current date** → Resolves to **current month period**
- Balance Sheet: Defaults to **current date** → Resolves to **current month period**
- Profit & Loss: Requires explicit dates (but UI may default to current month)

**Snapshot Generation:**
- Filters journal entries by period boundaries (`je.date >= period_start AND je.date <= period_end`)
- Only includes entries within the resolved period

**Result:**
- Entries posted in previous months are excluded from current month snapshots
- Reports appear empty even when ledger contains data

---

### Secondary Issue: No Automatic Period Selection

**Current Behavior:**
- Reports default to current date period
- Users must manually select the correct period

**Expected Behavior:**
- Reports should default to the period containing the latest journal entry
- Or default to the period with the most recent activity

**Impact:**
- New users see empty reports (no data in current month)
- Users must know to select previous periods manually

---

## PART 9 — RECOMMENDATIONS

### Immediate Fix: Use Automatic Period Resolver

**Solution:** Implement `resolve_default_accounting_period` (already created in migration 246)

**Integration:**
- `app/api/reports/trial-balance/route.ts`: Use resolver when `as_of_date` missing
- `app/api/reports/balance-sheet/route.ts`: Use resolver when `as_of_date` missing
- `app/api/reports/profit-loss/route.ts`: Use resolver when `start_date`/`end_date` missing

**Result:**
- Reports automatically select period with latest activity
- Empty reports eliminated for businesses with historical data

---

### Long-term Fix: Period-Aware UI Defaults

**Solution:** Update UI to:
1. Detect latest period with activity
2. Pre-select that period in date pickers
3. Display period status badge (OPEN/SOFT_CLOSED/LOCKED)

**Impact:**
- Better UX (users see relevant data immediately)
- Reduced confusion (clear indication of which period is shown)

---

## PART 10 — VERIFICATION CHECKLIST

- [ ] **Expenses are posted:** Check `journal_entries` WHERE `reference_type = 'expense'`
- [ ] **Invoices are posted:** Check `journal_entries` WHERE `reference_type = 'invoice'`
- [ ] **Payments are posted:** Check `journal_entries` WHERE `reference_type = 'payment'`
- [ ] **Period resolution mismatch:** Compare `journal_entry.date` vs report `asOfDate`
- [ ] **Snapshot coverage:** Check `trial_balance_snapshots` for all periods with entries
- [ ] **Report period selection:** Verify reports use correct period (not always current month)

---

**WORKFLOW TEST COMPLETE**

**CONCLUSION:** Expenses and invoices ARE being posted correctly. The issue is that reports default to the current month period, while entries may be posted in previous months. The automatic period resolver (migration 246) should resolve this issue when integrated into report routes.
