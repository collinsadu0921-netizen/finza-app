# Daily Aggregation & Ledger Balancing Rules
**Retail → Accounting (Per Store × Per Day, Multi-Store Safe)**

**Version:** 1.0  
**Date:** 2025-01-27  
**Mode:** Architecture & Rules Only  
**Status:** Binding Accounting Semantics  
**Scope:** Resolve aggregation, rounding, and balancing so ledger is ALWAYS balanced

---

## RESTRICTIONS (NON-NEGOTIABLE)

- ❌ Do NOT write or modify code
- ❌ Do NOT change VAT logic or rates
- ❌ Do NOT recalculate tax in Accounting
- ❌ Do NOT touch POS, cashier sessions, or UI
- ❌ Do NOT assume single-store
- ❌ Do NOT weaken double-entry rules
- ✅ This step **must mathematically close the ledger**

---

## 1. PURPOSE

Define **deterministic aggregation and balancing rules** so that:

- Every **Store × Day** event produces a **balanced journal entry**
- VAT integrity is preserved exactly as calculated in Retail
- Multi-store safety is guaranteed
- Replay and retry never change totals
- Accountants can audit and trust the ledger

This step resolves the **rounding ambiguity identified in Step 2B**.

---

## 2. FUNDAMENTAL ACCOUNTING INVARIANT (LOCKED)

For every posted Store-Day journal entry:

```
SUM(debits) = SUM(credits)
```

This invariant is **absolute**.  
No exception. No tolerance. No implicit rounding.

If this cannot be satisfied, **posting must not occur**.

**Enforcement:**
- Database trigger validates balance (migration `185_fix_ledger_balance_trigger_statement_level.sql`)
- Tolerance: `0.01` (for floating-point precision, not for rounding adjustments)
- Rounding adjustments MUST be explicit (not hidden in tolerance)

---

## 3. AGGREGATION ORDER (MANDATORY)

Aggregation MUST follow this exact order:

### Step 1 — Select Eligible Sales

**Criteria (as defined in Step 2B):**
- `sales.store_id = event.store_id` (store match)
- `sales.payment_status = 'paid'` (exclude unpaid/partial)
- `sales.is_voided = false` OR `sales.is_voided IS NULL` (exclude voided)
- `sales.is_refund = false` OR `sales.is_refund IS NULL` (exclude refunds)
- `DATE(sales.created_at AT TIME ZONE store.timezone) = event.calendar_date` (date match)

**Result:** Set of eligible `sales.id` values

---

### Step 2 — Aggregate Tax (FIRST)

**Grouping:**
- Group strictly by `tax_code` (e.g., `"VAT"`, `"NHIL"`, `"GETFUND"`)
- Each tax code produces one aggregated tax line

**Aggregation (per tax_code):**
```sql
-- Pseudo-code for tax aggregation
FOR each tax_code IN (VAT, NHIL, GETFUND):
  tax_base = SUM(
    (tax_line->>'base')::NUMERIC 
    FROM sales.tax_lines 
    WHERE tax_line->>'code' = tax_code
  )
  
  tax_amount = SUM(
    (tax_line->>'amount')::NUMERIC 
    FROM sales.tax_lines 
    WHERE tax_line->>'code' = tax_code
  )
  
  tax_rate = AVG(
    (tax_line->>'rate')::NUMERIC 
    FROM sales.tax_lines 
    WHERE tax_line->>'code' = tax_code
  )
  
  ledger_account_code = tax_line->>'ledger_account_code' 
    -- MUST be consistent across all sales (validation required)
  
  ledger_side = tax_line->>'ledger_side' 
    -- MUST be 'credit' for sales (validation required)
```

**Critical Rules:**
- Values are taken **verbatim** from `sales.tax_lines` JSONB
- NO recomputation, NO rate application
- NO rounding at this stage (preserve full precision)
- If `ledger_account_code` differs across sales → validation error

**Result:** Array of aggregated tax lines (one per tax_code)

---

### Step 3 — Aggregate Revenue

**Calculation:**
```
gross_sales = SUM(sales.amount) 
  -- Sum of all eligible sales.amount values

total_tax_amount = SUM(tax_summary[].tax_amount)
  -- Sum of all aggregated tax amounts from Step 2

net_revenue = gross_sales - total_tax_amount
  -- Revenue excluding tax
```

**Precision:**
- Use full precision (no rounding at this stage)
- `gross_sales` and `total_tax_amount` are exact sums
- `net_revenue` is exact difference

**Result:** `gross_sales`, `net_revenue`, `total_tax_amount`

---

### Step 4 — Aggregate COGS & Inventory

**Calculation:**
```sql
cogs = SUM(
  COALESCE(sale_items.cogs, 0)
  FROM sale_items
  WHERE sale_items.sale_id IN (eligible_sale_ids)
)

inventory_delta = cogs
  -- Inventory reduction equals COGS
```

**Precision:**
- Use full precision (no rounding at this stage)
- `cogs` is exact sum of `sale_items.cogs`
- `inventory_delta` equals `cogs` exactly

**Result:** `cogs`, `inventory_delta`

---

### Step 5 — Validate Internal Consistency (Pre-Posting)

**Validation Check:**
```
gross_sales = net_revenue + total_tax_amount
```

**If false → event is invalid and must not be posted**

**Tolerance:**
- Allow floating-point precision tolerance: `ABS(gross_sales - (net_revenue + total_tax_amount)) < 0.0001`
- If difference exceeds tolerance → validation error

**Rationale:**
- This validates that aggregation is mathematically correct
- If this fails, there's a bug in aggregation logic
- Event must be rejected (not posted)

**Result:** Validation pass/fail

---

## 4. ROUNDING POLICY (EXPLICIT & FINAL)

### Accepted Reality

- Aggregation across many sales **will produce fractional differences**
- These differences are **not VAT errors**
- They are arithmetic aggregation artifacts from:
  - Summing many rounded tax amounts
  - Floating-point arithmetic precision
  - Tax calculation rounding at sale time

### Chosen Strategy (MANDATORY)

✅ **Option A — Explicit Rounding Adjustment Line**

This is the **only permitted strategy**.

**Rationale:**
- Transparent and auditable
- Preserves VAT integrity (VAT amounts never altered)
- Matches real-world retail accounting practice
- Allows accountants to see and understand rounding

**Alternatives Rejected:**
- ❌ Option B: Adjust revenue (violates VAT integrity)
- ❌ Option C: Adjust tax (violates VAT integrity)
- ❌ Option D: Ignore rounding (violates double-entry)

---

## 5. ROUNDING ADJUSTMENT RULES

### 5.1 Rounding Delta Definition

**After Aggregation (Steps 1-4):**

Calculate preliminary journal entry totals:

```
preliminary_debit_total = gross_sales + cogs
preliminary_credit_total = net_revenue + SUM(tax_summary[].tax_amount) + inventory_delta
```

**Rounding Delta:**
```
rounding_delta = preliminary_debit_total - preliminary_credit_total
```

**Properties:**
- Delta may be positive or negative
- Delta is expected to be **small** (typically < 0.50 for normal days)
- Delta must never be ignored
- Delta represents the arithmetic difference from aggregation

**Example:**
```
gross_sales = 12500.00
net_revenue = 10250.00
total_tax = 2250.00 (sum of VAT + NHIL + GETFUND)
cogs = 6500.00
inventory_delta = 6500.00

preliminary_debit_total = 12500.00 + 6500.00 = 19000.00
preliminary_credit_total = 10250.00 + 2250.00 + 6500.00 = 19000.00
rounding_delta = 19000.00 - 19000.00 = 0.00
```

**With Rounding:**
```
gross_sales = 12500.00
net_revenue = 10249.87 (after aggregation rounding)
total_tax = 2250.13 (after aggregation rounding)
cogs = 6500.00
inventory_delta = 6500.00

preliminary_debit_total = 12500.00 + 6500.00 = 19000.00
preliminary_credit_total = 10249.87 + 2250.13 + 6500.00 = 19000.00
rounding_delta = 19000.00 - 19000.00 = 0.00
```

**With Actual Rounding Difference:**
```
gross_sales = 12500.00
net_revenue = 10249.87
total_tax = 2250.10 (sum of rounded tax amounts)
cogs = 6500.00
inventory_delta = 6500.00

preliminary_debit_total = 12500.00 + 6500.00 = 19000.00
preliminary_credit_total = 10249.87 + 2250.10 + 6500.00 = 18999.97
rounding_delta = 19000.00 - 18999.97 = 0.03
```

---

### 5.2 Rounding Adjustment Account

**Account Specification:**
- **Account Code:** `3999` (recommended, configurable per business)
- **Account Name:** `Rounding Adjustments` (or `Rounding Differences`)
- **Account Type:** `revenue` (or `expense`, per COA policy)
- **Scope:** One per business (shared across all stores)

**Account Resolution:**
- Resolved via `get_account_by_code(business_id, '3999')`
- Must exist in `chart_of_accounts`
- Must be active (`is_active = true`)
- If missing → posting MUST fail

**Account Policy:**
- Business can choose account type (revenue or expense)
- Business can choose account code (if not `3999`)
- Account must be configured before first posting
- Account is shared across all stores (not per-store)

---

### 5.3 Posting the Rounding Line

#### If `rounding_delta > 0` (Debits exceed Credits)

**Action:**
- Add rounding line as **credit** to rounding account
- Amount: `rounding_delta`

**Journal Entry Line:**
```
account_id: rounding_account_id (3999)
debit: 0
credit: rounding_delta
description: "Rounding adjustment - Store: {store_name} - Date: {calendar_date}"
```

**Rationale:**
- Credits are less than debits
- Need to increase credits to balance
- Rounding account receives credit

#### If `rounding_delta < 0` (Credits exceed Debits)

**Action:**
- Add rounding line as **debit** to rounding account
- Amount: `ABS(rounding_delta)`

**Journal Entry Line:**
```
account_id: rounding_account_id (3999)
debit: ABS(rounding_delta)
credit: 0
description: "Rounding adjustment - Store: {store_name} - Date: {calendar_date}"
```

**Rationale:**
- Debits are less than credits
- Need to increase debits to balance
- Rounding account receives debit

#### If `rounding_delta = 0` (Perfect Balance)

**Action:**
- Do NOT post rounding line
- Journal entry is already balanced

**Rationale:**
- No adjustment needed
- Avoid unnecessary rounding lines

---

### 5.4 Constraints on Rounding

**Rounding Line Position:**
- Rounding line MUST be **last line** in journal entry
- Rounding line MUST reference store + date in description
- Rounding line MUST use rounding account (3999)

**Rounding Amount Tolerance:**
- Rounding amount MUST be ≤ predefined tolerance
- **Recommended tolerance:** `0.5% of gross_sales` OR `5.00` (whichever is smaller)
- **Example:** For `gross_sales = 1000.00`, tolerance = `5.00`
- **Example:** For `gross_sales = 10000.00`, tolerance = `50.00`
- If exceeded → posting MUST fail and be flagged for review

**Tolerance Check:**
```
IF ABS(rounding_delta) > MIN(0.005 * gross_sales, 5.00) THEN
  → Posting MUST fail
  → Event marked as `failed`
  → Error: "Rounding delta exceeds tolerance: {rounding_delta}"
END IF
```

**Rationale:**
- Large rounding differences indicate aggregation errors
- Not normal arithmetic artifacts
- Requires investigation before posting

---

## 6. FINAL JOURNAL ENTRY STRUCTURE (WITH ROUNDING)

### Complete Journal Entry Lines

**Debits (in order):**
1. **CASH** — `gross_sales`
   - Account: CASH control account (resolved via control mapping)
   - Debit: `gross_sales`
   - Credit: `0`
   - Description: `"Store sales receipt - {store_name}"`

2. **COGS** — `cogs`
   - Account: Account code `5000` (COGS)
   - Debit: `cogs`
   - Credit: `0`
   - Description: `"Cost of goods sold - {store_name}"`

3. **Rounding Adjustment (if delta < 0)** — `ABS(rounding_delta)`
   - Account: Account code `3999` (Rounding Adjustments)
   - Debit: `ABS(rounding_delta)`
   - Credit: `0`
   - Description: `"Rounding adjustment - Store: {store_name} - Date: {calendar_date}"`

**Credits (in order):**
1. **Revenue** — `net_revenue`
   - Account: Account code `4000` (Revenue)
   - Debit: `0`
   - Credit: `net_revenue`
   - Description: `"Sales revenue - {store_name}"`

2. **Tax Payables** — One line per `tax_summary[]` item
   - For each tax code (VAT, NHIL, GETFUND):
     - Account: `tax_summary[].ledger_account_code`
     - Debit: `0`
     - Credit: `tax_summary[].tax_amount`
     - Description: `"{tax_code} tax - {store_name}"`

3. **Inventory** — `inventory_delta`
   - Account: Account code `1200` (Inventory)
   - Debit: `0`
   - Credit: `inventory_delta`
   - Description: `"Inventory reduction - {store_name}"`

4. **Rounding Adjustment (if delta > 0)** — `rounding_delta`
   - Account: Account code `3999` (Rounding Adjustments)
   - Debit: `0`
   - Credit: `rounding_delta`
   - Description: `"Rounding adjustment - Store: {store_name} - Date: {calendar_date}"`

### Invariant Enforcement

**Final Balance Check:**
```
debit_total = gross_sales + cogs + (if delta < 0: ABS(rounding_delta) else 0)
credit_total = net_revenue + SUM(tax_amounts) + inventory_delta + (if delta > 0: rounding_delta else 0)

MUST satisfy: debit_total = credit_total
```

**Database Validation:**
- `post_journal_entry()` function validates balance
- Database trigger validates balance (migration `185`)
- Tolerance: `0.01` (for floating-point precision only)
- Rounding adjustment ensures exact balance

---

## 7. VAT INTEGRITY GUARANTEES

### VAT Amounts Never Altered

**Rule:**
- VAT amounts from `sales.tax_lines` are **never modified**
- VAT bases from `sales.tax_lines` are **never modified**
- VAT rates from `sales.tax_lines` are **never modified**
- Rounding adjustment **MUST NOT touch VAT accounts**

**Enforcement:**
- Rounding adjustment goes to account `3999` only
- VAT accounts (e.g., `2100`) are never adjusted
- VAT amounts in journal entry match event `tax_summary[]` exactly

### VAT Reporting Independence

**Rule:**
- VAT reports continue to read from `sales.tax_lines` only
- Ledger VAT amounts may differ from VAT report totals (due to rounding)
- This is **intentional** and **acceptable**

**Rationale:**
- VAT reports use per-sale data (no aggregation rounding)
- Ledger uses aggregated data (with rounding adjustment)
- Both are correct for their purposes
- Ledger ≠ VAT report source of truth (by design)

**Example:**
- VAT Report: Sum of `sales.tax_lines[].amount` = `2250.13`
- Ledger VAT: Aggregated `tax_summary[].tax_amount` = `2250.10`
- Rounding adjustment: `0.03` (in account 3999)
- Both are correct (different aggregation methods)

---

## 8. FAILURE RULES

### Posting MUST FAIL if:

1. **Rounding Delta Exceeds Tolerance:**
   - `ABS(rounding_delta) > MIN(0.005 * gross_sales, 5.00)`
   - Error: `"Rounding delta exceeds tolerance: {rounding_delta}. Expected < {tolerance}"`
   - Event marked as `failed`
   - Requires investigation

2. **Required Rounding Account Missing:**
   - Account code `3999` does not exist
   - Error: `"Rounding adjustment account (3999) not found"`
   - Event marked as `failed`
   - Retry after account created

3. **Account Resolution Fails:**
   - Any required account missing (CASH, Revenue, COGS, Inventory, Tax accounts)
   - Error: `"Account {account_code} not found"`
   - Event marked as `failed`
   - Retry after account created

4. **Event Internal Consistency Check Fails:**
   - `gross_sales != net_revenue + total_tax_amount` (beyond tolerance)
   - Error: `"Event internal consistency check failed: gross_sales ({gross}) != net_revenue ({net}) + total_tax ({tax})"`
   - Event marked as `failed`
   - Requires investigation (aggregation bug)

5. **Event Violates Step 2B Schema:**
   - Missing required fields
   - Invalid data types
   - Error: `"Event schema validation failed: {details}"`
   - Event marked as `failed`
   - Requires event re-emission

### Failure Consequences

**Event Status:**
- Event marked as `failed` (not `pending`)
- Event remains immutable (not modified)
- Event can be retried after correction

**No Journal Entry:**
- No journal entry created
- No partial posting
- Ledger remains unchanged

**Retry Allowed:**
- After fixing root cause (account created, investigation complete)
- Retry uses same event data (idempotent)
- Retry produces same result (deterministic)

---

## 9. REPLAY & IDEMPOTENCY SAFETY

### Deterministic Rounding Calculation

**Rule:**
- Rounding calculation MUST be deterministic
- Same event → same rounding delta
- No timestamps, randomness, or mutable state

**Calculation Order:**
1. Aggregate sales (deterministic order: by `sales.id`)
2. Aggregate tax (deterministic order: by `tax_code`)
3. Calculate totals (deterministic arithmetic)
4. Calculate rounding delta (deterministic)
5. Post rounding line (deterministic)

**Enforcement:**
- Use `ORDER BY sales.id` for deterministic aggregation
- Use `ORDER BY tax_code` for deterministic tax grouping
- No random number generation
- No time-based calculations

### Replay Safety

**Rule:**
- Replaying same event MUST produce identical journal entry
- Rounding delta MUST be identical
- Journal entry lines MUST be identical

**Idempotency Check:**
- Check for existing journal entry before posting
- If exists → skip (already posted)
- If not exists → post (with rounding adjustment)

**Replay Process:**
1. Check idempotency key: `{store_id}_{calendar_date}`
2. If entry exists → skip
3. If not exists → calculate rounding delta (deterministic)
4. Post journal entry with rounding adjustment
5. Mark event as `posted`

---

## 10. MULTI-STORE SAFETY (CONFIRMED)

### Store Isolation

**Rule:**
- Rounding is calculated **per store per day**
- Each store-day has independent rounding delta
- No cross-store netting
- No global rounding pool

**Enforcement:**
- Rounding delta calculated from store-specific sales only
- Rounding account (3999) is shared, but rounding amounts are per-store
- Store A rounding must never affect Store B

**Example:**
- Store A: `rounding_delta = 0.03` (credit to 3999)
- Store B: `rounding_delta = -0.02` (debit to 3999)
- Both post independently
- Rounding account (3999) shows net: `0.03 - 0.02 = 0.01` credit

### Parallel Processing

**Rule:**
- Store events can be posted in parallel
- Rounding calculations are independent
- No coordination needed between stores

**Enforcement:**
- Each store-day event processed independently
- Rounding delta calculated from that store's sales only
- No shared state or locking required

---

## 11. AUDIT & ACCOUNTANT EXPECTATIONS

### Accountant Visibility

**Accountants must be able to:**

1. **See Daily Sales Summary Per Store:**
   - Journal entry description includes store name and date
   - Can filter ledger by store via `reference_id`
   - Can see `gross_sales`, `net_revenue`, `cogs` per store

2. **See VAT Exactly as Reported:**
   - VAT amounts in ledger match event `tax_summary[]`
   - VAT accounts show exact aggregated tax amounts
   - VAT reports (from `sales.tax_lines`) may differ (acceptable)

3. **See Transparent Rounding Line:**
   - Rounding line clearly labeled in journal entry
   - Rounding amount visible and auditable
   - Rounding account (3999) shows all rounding adjustments

4. **Trace Rounding to Aggregation Reality:**
   - Can verify: `gross_sales = net_revenue + total_tax + rounding`
   - Can see rounding is small (within tolerance)
   - Can understand rounding is from aggregation, not errors

5. **Close Periods Without Manual Fixes:**
   - All journal entries are balanced (no manual adjustments needed)
   - Rounding adjustments are explicit (no hidden corrections)
   - Period close workflow is smooth

### Real-World Alignment

**This mirrors real-world retail accounting systems:**
- Daily sales summaries (not per-sale)
- Explicit rounding adjustments (transparent)
- VAT integrity preserved (tax amounts never altered)
- Multi-store isolation (independent store accounting)

---

## 12. ACCEPTANCE CRITERIA

Step 2C is complete only if all of the following are true:

### Ledger Always Balances
- ✅ Every journal entry satisfies `SUM(debits) = SUM(credits)`
- ✅ Rounding adjustment ensures exact balance
- ✅ Database trigger validates balance
- ✅ No manual adjustments required

### VAT Integrity Preserved
- ✅ VAT amounts never altered (copied from `sales.tax_lines`)
- ✅ VAT bases never altered
- ✅ Rounding adjustment does not touch VAT accounts
- ✅ VAT reports continue to read from `sales.tax_lines`

### Rounding is Explicit and Auditable
- ✅ Rounding line clearly visible in journal entry
- ✅ Rounding amount within tolerance
- ✅ Rounding account (3999) shows all adjustments
- ✅ Accountants can trace rounding to aggregation

### Replay Produces Identical Results
- ✅ Same event → same rounding delta
- ✅ Same event → same journal entry
- ✅ Deterministic aggregation order
- ✅ No random or time-based calculations

### Multi-Store Isolation Intact
- ✅ Rounding calculated per store per day
- ✅ No cross-store netting
- ✅ Store failures are independent
- ✅ Parallel processing safe

### No Silent Corrections Exist
- ✅ All adjustments are explicit (rounding line)
- ✅ No hidden balance corrections
- ✅ No tolerance-based silent fixes
- ✅ All differences are visible and auditable

---

## 13. EXAMPLE: COMPLETE JOURNAL ENTRY WITH ROUNDING

### Event Data

```json
{
  "event_type": "RETAIL_STORE_DAY_CLOSED",
  "store_id": "660e8400-e29b-41d4-a716-446655440001",
  "calendar_date": "2025-01-27",
  "sales_count": 47,
  "totals": {
    "gross_sales": 12500.00,
    "net_revenue": 10249.87,
    "cogs": 6500.00,
    "inventory_delta": 6500.00
  },
  "tax_summary": [
    {
      "tax_code": "NHIL",
      "tax_amount": 256.25,
      "ledger_account_code": "2100"
    },
    {
      "tax_code": "GETFUND",
      "tax_amount": 256.25,
      "ledger_account_code": "2100"
    },
    {
      "tax_code": "VAT",
      "tax_amount": 1614.38,
      "ledger_account_code": "2100"
    }
  ]
}
```

### Aggregation Calculation

```
gross_sales = 12500.00
net_revenue = 10249.87
total_tax = 256.25 + 256.25 + 1614.38 = 2126.88
cogs = 6500.00
inventory_delta = 6500.00

preliminary_debit_total = 12500.00 + 6500.00 = 19000.00
preliminary_credit_total = 10249.87 + 2126.88 + 6500.00 = 18876.75
rounding_delta = 19000.00 - 18876.75 = 123.25
```

**Note:** This example shows a large rounding delta for illustration. In practice, rounding deltas should be much smaller (< 0.50 typically).

### Rounding Tolerance Check

```
tolerance = MIN(0.005 * 12500.00, 5.00) = MIN(62.50, 5.00) = 5.00
ABS(rounding_delta) = 123.25 > 5.00
→ Posting MUST FAIL (rounding delta exceeds tolerance)
```

**In practice, rounding deltas should be much smaller. This example would indicate an aggregation error requiring investigation.**

### Corrected Example (Small Rounding Delta)

```
gross_sales = 12500.00
net_revenue = 10249.87
total_tax = 2126.88
cogs = 6500.00
inventory_delta = 6500.00

preliminary_debit_total = 12500.00 + 6500.00 = 19000.00
preliminary_credit_total = 10249.87 + 2126.88 + 6500.00 = 18876.75
rounding_delta = 19000.00 - 18876.75 = 123.25

Wait, this still doesn't balance. Let me recalculate:

Actually, if net_revenue = 10249.87 and total_tax = 2126.88:
gross_sales should be = 10249.87 + 2126.88 = 12376.75

But event says gross_sales = 12500.00
This violates internal consistency check!

Let me use a realistic example:
```

### Realistic Example (Small Rounding)

```
gross_sales = 12500.00
net_revenue = 10250.00
total_tax = 2250.00 (exact sum)
cogs = 6500.00
inventory_delta = 6500.00

preliminary_debit_total = 12500.00 + 6500.00 = 19000.00
preliminary_credit_total = 10250.00 + 2250.00 + 6500.00 = 19000.00
rounding_delta = 19000.00 - 19000.00 = 0.00

→ No rounding adjustment needed (perfect balance)
```

### Example with Small Rounding Delta

```
gross_sales = 12500.00
net_revenue = 10249.97
total_tax = 2250.02 (sum of rounded tax amounts)
cogs = 6500.00
inventory_delta = 6500.00

preliminary_debit_total = 12500.00 + 6500.00 = 19000.00
preliminary_credit_total = 10249.97 + 2250.02 + 6500.00 = 18999.99
rounding_delta = 19000.00 - 18999.99 = 0.01

tolerance = MIN(0.005 * 12500.00, 5.00) = 5.00
ABS(rounding_delta) = 0.01 < 5.00 → OK

→ Post rounding line: Credit 3999 by 0.01
```

### Final Journal Entry

**Journal Entry Header:**
- `date`: `2025-01-27`
- `description`: `"Retail sales - Store: Accra Main Store - Date: 2025-01-27"`
- `reference_type`: `"store_day"`
- `reference_id`: `"660e8400-e29b-41d4-a716-446655440001_2025-01-27"`

**Journal Entry Lines:**

1. CASH (1000): Debit `12500.00`
2. Revenue (4000): Credit `10249.97`
3. NHIL Payable (2100): Credit `256.25`
4. GETFUND Payable (2100): Credit `256.25`
5. VAT Payable (2100): Credit `1737.52` (2250.02 - 256.25 - 256.25)
6. COGS (5000): Debit `6500.00`
7. Inventory (1200): Credit `6500.00`
8. Rounding Adjustment (3999): Credit `0.01`

**Balance Check:**
- Debit Total: `12500.00 + 6500.00 = 19000.00`
- Credit Total: `10249.97 + 256.25 + 256.25 + 1737.52 + 6500.00 + 0.01 = 19000.00`
- ✅ Balanced: `19000.00 = 19000.00`

---

## CONCLUSION

This document defines the **deterministic aggregation and balancing rules** for Retail → Accounting daily events under **Option 3: Per Store × Per Day** posting granularity.

**Key Principles:**
- ✅ Ledger always balances (explicit rounding adjustment)
- ✅ VAT integrity preserved (tax amounts never altered)
- ✅ Rounding is transparent and auditable
- ✅ Multi-store safe (independent store-day rounding)
- ✅ Idempotent and replay-safe (deterministic calculations)

**Next Steps:**
- Implement aggregation logic (Retail side)
- Implement rounding adjustment logic (Accounting side)
- Add rounding account (3999) to chart of accounts
- Add tolerance validation
- Add rounding line to journal entry posting

---

**End of Document**
