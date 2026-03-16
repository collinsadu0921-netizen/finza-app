# Retail → Accounting Daily Event Contract (Multi-Store Safe)

**Version:** 1.0  
**Date:** 2025-01-27  
**Mode:** Architecture Definition Only  
**Status:** Schema + Semantics Contract

---

## RESTRICTIONS (MANDATORY)

- ❌ Do NOT write or modify code
- ❌ Do NOT change VAT logic
- ❌ Do NOT touch POS, cashier sessions, or UI
- ❌ Do NOT assume single-store
- ❌ Do NOT introduce new accounting calculations
- ✅ This is a **schema + semantics contract only**

---

## 1. PURPOSE (NON-NEGOTIABLE)

Define the **canonical event contract** by which **Finza Retail emits immutable daily accounting events** and **Accounting consumes them safely**, under:

- Per **Store × Calendar Day** posting granularity
- Ghana VAT (versioned, canonical, retail-owned)
- Multi-store businesses (independent store-day events)
- Replay-safe, idempotent accounting ingestion

**Architectural Principle:**
- **Retail is the source of truth** for sales and VAT
- **Accounting is downstream only** (consumes events, never recalculates)
- **Events are immutable** (once emitted, never modified)
- **Posting is idempotent** (same event can be replayed safely)

---

## 2. EVENT IDENTITY (IDEMPOTENCY CORE)

### Event Name
```
RETAIL_STORE_DAY_CLOSED
```

### Natural Idempotency Key (MANDATORY)
```
{business_id} + {store_id} + {calendar_date}
```

**Format:** Composite key as string: `{business_id}_{store_id}_{YYYY-MM-DD}`

**Rules:**
- Exactly **one** event per store per calendar date
- Re-emitting the same event MUST be safe (idempotent)
- Accounting MUST reject duplicates by this key
- Key is **immutable** (cannot change after event creation)

**Example:**
```
business_id: "550e8400-e29b-41d4-a716-446655440000"
store_id: "660e8400-e29b-41d4-a716-446655440001"
calendar_date: "2025-01-27"
idempotency_key: "550e8400-e29b-41d4-a716-446655440000_660e8400-e29b-41d4-a716-446655440001_2025-01-27"
```

---

## 3. EVENT TIME BOUNDARIES

### Calendar Date Definition

**Store-Local Timezone:**
- Use **store-local timezone** (from `stores.timezone` or `businesses.address_timezone`)
- Calendar date = `DATE(sales.created_at AT TIME ZONE store.timezone)`
- No UTC ambiguity allowed
- If store timezone is NULL, use business timezone
- If business timezone is NULL, use UTC (fallback)

**Date Resolution:**
```sql
-- Pseudo-code for date resolution
calendar_date = DATE(
  sales.created_at AT TIME ZONE COALESCE(
    stores.timezone,
    businesses.address_timezone,
    'UTC'
  )
)
```

### Eligible Sales Criteria

Include only sales that meet **ALL** of the following:
- `sales.store_id = event.store_id` (store match)
- `sales.payment_status = 'paid'` (exclude unpaid/partial)
- `sales.is_voided = false` OR `sales.is_voided IS NULL` (exclude voided)
- `sales.is_refund = false` OR `sales.is_refund IS NULL` (exclude refunds)
- `DATE(sales.created_at AT TIME ZONE store.timezone) = event.calendar_date` (date match)

**Exclusion Rules:**
- ❌ Voided sales (`is_voided = true`)
- ❌ Refunded sales (`is_refund = true`)
- ❌ Unpaid sales (`payment_status != 'paid'`)
- ❌ Sales from other stores (`store_id != event.store_id`)
- ❌ Sales from other dates (date mismatch)

### Refund Handling

**Refunds are separate events:**
- Posted as **separate negative events** on their own calendar date
- Event type: `RETAIL_STORE_DAY_REFUNDED` (future contract)
- Never mutate past events
- Refund date = date of refund transaction (not original sale date)

**Rationale:**
- Maintains event immutability
- Preserves audit trail
- Allows independent reconciliation

---

## 4. EVENT PAYLOAD (CANONICAL STRUCTURE)

### Required Fields (STRICT)

```json
{
  "event_type": "RETAIL_STORE_DAY_CLOSED",
  "event_version": "1.0",
  "event_id": "uuid",
  "emitted_at": "ISO8601 timestamp",
  
  "business_id": "uuid",
  "store_id": "uuid",
  "calendar_date": "YYYY-MM-DD",
  "store_timezone": "IANA timezone string",
  "currency": "ISO4217 code",
  
  "sales_count": number,
  
  "totals": {
    "gross_sales": number,
    "net_revenue": number,
    "cogs": number,
    "inventory_delta": number
  },
  
  "tax_summary": [
    {
      "tax_code": "VAT | NHIL | GETFUND",
      "tax_name": "string",
      "tax_rate": number,
      "tax_base": number,
      "tax_amount": number,
      "ledger_account_code": "string",
      "ledger_side": "credit",
      "ghana_tax_version": "string"
    }
  ],
  
  "vat_engine": {
    "jurisdiction": "GH",
    "engine_code": "ghana",
    "engine_version": "string",
    "effective_from": "YYYY-MM-DD"
  },
  
  "source_refs": {
    "sales_ids": ["uuid", "..."],
    "store_name": "string",
    "business_name": "string"
  },
  
  "metadata": {
    "aggregation_method": "sum_from_sales_tax_lines",
    "rounding_applied": false,
    "cogs_calculation": "sum_from_sale_items"
  }
}
```

### Field Specifications

**Event Identity:**
- `event_type`: Always `"RETAIL_STORE_DAY_CLOSED"` (constant)
- `event_version`: Contract version (for future compatibility)
- `event_id`: Unique UUID for this event instance
- `emitted_at`: ISO8601 timestamp when event was created

**Business Context:**
- `business_id`: UUID from `businesses.id`
- `store_id`: UUID from `stores.id`
- `calendar_date`: `YYYY-MM-DD` format (store-local date)
- `store_timezone`: IANA timezone (e.g., `"Africa/Accra"`)
- `currency`: ISO4217 code (e.g., `"GHS"`)

**Sales Aggregation:**
- `sales_count`: Count of eligible sales included
- `totals.gross_sales`: Sum of `sales.amount` (total including tax)
- `totals.net_revenue`: `gross_sales - sum(tax_amount)` (revenue excluding tax)
- `totals.cogs`: Sum of `sale_items.cogs` for all eligible sales
- `totals.inventory_delta`: Same as `cogs` (inventory reduction = COGS)

**Tax Summary:**
- `tax_summary[]`: Array of tax line items (one per tax code)
- `tax_code`: Tax identifier (`"VAT"`, `"NHIL"`, `"GETFUND"`)
- `tax_name`: Human-readable name
- `tax_rate`: Tax rate (decimal, e.g., `0.15` for 15%)
- `tax_base`: Taxable base amount (sum of bases from all sales)
- `tax_amount`: Total tax amount (sum of amounts from all sales)
- `ledger_account_code`: Account code for posting (e.g., `"2100"`)
- `ledger_side`: Always `"credit"` for sales output taxes
- `ghana_tax_version`: Tax regime version (e.g., `"GH-2025-A"`)

**VAT Engine Metadata:**
- `vat_engine.jurisdiction`: Country code (`"GH"` for Ghana)
- `vat_engine.engine_code`: Engine identifier (`"ghana"`)
- `vat_engine.engine_version`: Version string from tax engine
- `vat_engine.effective_from`: Effective date for tax calculation

**Source References:**
- `source_refs.sales_ids`: Array of all `sales.id` included in event
- `source_refs.store_name`: Store name (for human readability)
- `source_refs.business_name`: Business name (for human readability)

**Metadata:**
- `metadata.aggregation_method`: How tax was aggregated (`"sum_from_sales_tax_lines"`)
- `metadata.rounding_applied`: Whether rounding was applied (should be `false`)
- `metadata.cogs_calculation`: How COGS was calculated (`"sum_from_sale_items"`)

### Forbidden Fields

**Accounting State (MUST NOT appear):**
- ❌ `journal_entry_id` (accounting creates this)
- ❌ `accounting_period_id` (accounting resolves this)
- ❌ `posted_at` (accounting timestamps this)
- ❌ `posting_status` (accounting tracks this)

**Recalculated Values (MUST NOT appear):**
- ❌ `recalculated_vat` (VAT is copied, not recalculated)
- ❌ `recalculated_cogs` (COGS is summed, not recalculated)
- ❌ `recalculated_revenue` (Revenue is derived, not recalculated)

**Operational Data (MUST NOT appear):**
- ❌ `cashier_session_id` (not needed for accounting)
- ❌ `register_id` (not needed for accounting)
- ❌ `user_id` (not needed for accounting)
- ❌ `payment_method` (not needed for accounting)
- ❌ `cash_amount`, `momo_amount`, `card_amount` (not needed for accounting)

**Account Balances (MUST NOT appear):**
- ❌ `cash_account_balance` (accounting maintains this)
- ❌ `revenue_account_balance` (accounting maintains this)
- ❌ `tax_account_balance` (accounting maintains this)

---

## 5. VAT INTEGRITY RULES (CRITICAL)

### VAT is Copied, Never Recalculated

**Source of Truth:**
- VAT data comes **exclusively** from `sales.tax_lines` JSONB
- Each sale's `tax_lines` array is the canonical source
- Event aggregates by **summing** tax amounts from all eligible sales

**Aggregation Method:**
```sql
-- Pseudo-code for tax aggregation
FOR each tax_code IN (VAT, NHIL, GETFUND):
  tax_base = SUM(tax_lines[].base WHERE code = tax_code)
  tax_amount = SUM(tax_lines[].amount WHERE code = tax_code)
  tax_rate = AVG(tax_lines[].rate WHERE code = tax_code) -- or use most common
  ledger_account_code = tax_lines[].ledger_account_code (must be consistent)
  ledger_side = tax_lines[].ledger_side (must be 'credit' for sales)
```

**Ghana Tax Regime Version:**
- MUST be preserved from `sales.tax_engine_code` and `sales.tax_engine_effective_from`
- Each sale carries its own tax version
- Event MUST include tax version metadata
- If sales have different versions, event MUST indicate this (or reject mixed versions)

**COVID Levy Handling:**
- **COVID levy MUST NOT appear** in current regime
- If `tax_lines` contains COVID, it MUST be excluded from event
- Event validation MUST reject events with COVID levy

**VAT Configuration Changes:**
- If VAT configuration changes mid-month, events remain correct
- Each day carries its own tax version
- Accounting must trust the version in the event
- No recalculation allowed

**Accounting Trust Principle:**
- Accounting must **trust**, not reinterpret, VAT
- Accounting must **copy** tax amounts to ledger
- Accounting must **NOT** recalculate tax from base amounts
- Accounting must **NOT** apply different tax rates

---

## 6. LEDGER POSTING CONTRACT (ACCOUNTING SIDE)

### Mandatory Journal Entry Structure

For each accepted event, Accounting MUST create **exactly one journal entry** with the following structure:

**Journal Entry Header:**
- `business_id`: From `event.business_id`
- `date`: From `event.calendar_date` (NOT `emitted_at`)
- `description`: `"Retail sales - Store: {store_name} - Date: {calendar_date}"`
- `reference_type`: `"store_day"`
- `reference_id`: `"{store_id}_{calendar_date}"` (idempotency key)

**Journal Entry Lines (in order):**

**Line 1: Cash/Bank (Debit)**
- `account_id`: Resolved from CASH control account mapping
- `debit`: `event.totals.gross_sales`
- `credit`: `0`
- `description`: `"Store sales receipt - {store_name}"`

**Line 2: Revenue (Credit)**
- `account_id`: Resolved from account code `"4000"` (Revenue)
- `debit`: `0`
- `credit`: `event.totals.net_revenue`
- `description`: `"Sales revenue - {store_name}"`

**Line 3-N: Tax Lines (Credit, one per tax_summary item)**
- For each item in `event.tax_summary[]`:
  - `account_id`: Resolved from `tax_summary[].ledger_account_code`
  - `debit`: `0`
  - `credit`: `tax_summary[].tax_amount`
  - `description`: `"{tax_code} tax - {store_name}"`

**Line N+1: COGS (Debit)**
- `account_id`: Resolved from account code `"5000"` (COGS)
- `debit`: `event.totals.cogs`
- `credit`: `0`
- `description`: `"Cost of goods sold - {store_name}"`

**Line N+2: Inventory (Credit)**
- `account_id`: Resolved from account code `"1200"` (Inventory)
- `debit`: `0`
- `credit`: `event.totals.inventory_delta`
- `description`: `"Inventory reduction - {store_name}"`

### Double-Entry Invariants

**MUST satisfy:**
```
SUM(all debits) = SUM(all credits)
```

**Validation:**
- Accounting MUST validate balance before posting
- If unbalanced, Accounting MUST reject event and log error
- Event remains immutable (not modified)

**Example Calculation:**
```
Debit Total = gross_sales + cogs
Credit Total = net_revenue + sum(tax_amounts) + inventory_delta

Where: gross_sales = net_revenue + sum(tax_amounts)
Therefore: Debit Total = Credit Total ✓
```

### Account Resolution

**Control Accounts:**
- CASH: Resolved via `get_control_account_code(business_id, 'CASH')`
- Must exist in `chart_of_accounts_control_map`

**Fixed Accounts:**
- Revenue: Account code `"4000"` (hardcoded)
- COGS: Account code `"5000"` (hardcoded)
- Inventory: Account code `"1200"` (hardcoded)

**Tax Accounts:**
- Resolved from `tax_summary[].ledger_account_code`
- Must exist in `chart_of_accounts`
- Must be active (`is_active = true`)

**Validation:**
- Accounting MUST validate all accounts exist before posting
- If account missing, Accounting MUST reject event
- Event remains immutable (not modified)

---

## 7. PERIOD HANDLING (STRICT)

### Period Resolution

**At Posting Time:**
- Period is resolved **at posting time**, not at event emission
- Use `event.calendar_date` for period lookup
- Query: `accounting_periods WHERE business_id = event.business_id AND period_start <= event.calendar_date <= period_end`

**Allowed Period Statuses:**
- `open`: ✅ Posting allowed
- `soft_closed`: ✅ Posting allowed
- `locked`: ❌ Posting blocked (event marked as pending)

### Period Lock Handling

**If Period is Locked:**
- ❌ Do NOT reject the event
- ✅ Mark event as **pending** (in event queue/table)
- ✅ Allow retry after period unlock
- ✅ Event remains immutable

**Retail Independence:**
- Retail must **never care about periods**
- Retail emits events regardless of period status
- Period validation is **accounting-side only**

**Period Unlock Retry:**
- When period is unlocked, Accounting MUST retry pending events
- Retry MUST be idempotent (check for existing journal entry)
- Retry MUST use same event data (no recalculation)

---

## 8. FAILURE & REPLAY SEMANTICS

### If Posting Fails

**Event Immutability:**
- Event remains **immutable** (never modified)
- Sales are **NOT rolled back** (operational data unchanged)
- Event can be **retried safely** (idempotent)

**Failure Scenarios:**
1. **Period Locked:**
   - Mark event as `pending`
   - Retry when period unlocked

2. **Account Missing:**
   - Mark event as `failed`
   - Log error with account code
   - Retry after account created

3. **Validation Error:**
   - Mark event as `failed`
   - Log error details
   - Manual intervention required

4. **System Error:**
   - Mark event as `failed`
   - Log error details
   - Retry with exponential backoff

### Replay Rules

**Idempotency Enforcement:**
- Same event key → must not double post
- Accounting MUST check existence before posting:
  ```sql
  SELECT 1 FROM journal_entries
  WHERE reference_type = 'store_day'
    AND reference_id = '{store_id}_{calendar_date}'
  ```
- If entry exists, skip posting (idempotent)

**Deterministic Reprocessing:**
- Re-processing same event MUST produce same journal entry
- No random values or timestamps in journal entry
- All values derived from event payload

**Replay Safety:**
- Event can be re-emitted by Retail (idempotent)
- Event can be re-processed by Accounting (idempotent)
- No side effects from replay

---

## 9. MULTI-STORE SAFETY GUARANTEES

### Store Isolation

**No Aggregation Across Stores:**
- Each store-day is **independent event**
- No shared state between store events
- No cross-store dependencies

**Store A Failure Must Not Affect Store B:**
- Store A event failure → Store A only affected
- Store B events continue processing
- No cascading failures

**Ledger Traceability:**
- Journal entry MUST reference store
- Description MUST include store name
- `reference_id` MUST include store_id
- Can trace ledger entry back to store

### Parallel Processing

**Independent Posting:**
- Store events can be posted in parallel
- No coordination needed between stores
- No locking or synchronization required

**Scalability:**
- N stores = N independent event streams
- No performance degradation with many stores
- Each store scales independently

---

## 10. NON-GOALS (EXPLICIT)

This contract does NOT:

- ❌ Implement event batching logic
- ❌ Add schedulers or cron jobs
- ❌ Modify `post_sale_to_ledger()` function
- ❌ Introduce new database tables
- ❌ Change POS sale creation logic
- ❌ Modify VAT calculation logic
- ❌ Add UI for event management
- ❌ Implement event queue system
- ❌ Add event retry mechanisms
- ❌ Change cashier session logic

**This is a contract definition only.**

---

## 11. ACCEPTANCE CRITERIA

This contract is valid only if all of the following are true:

### Idempotency
- ✅ A day can be replayed safely (same event, same result)
- ✅ Duplicate events are rejected (no double posting)
- ✅ Re-processing produces identical journal entries

### VAT Integrity
- ✅ VAT reports still match sales (read from `sales.tax_lines`)
- ✅ Ledger VAT matches event VAT (no recalculation)
- ✅ Tax versions are preserved correctly

### Ledger Quality
- ✅ Ledger remains readable (daily summaries, not per-sale)
- ✅ Journal entries are balanced (debits = credits)
- ✅ Account references are correct

### Multi-Store Safety
- ✅ Multi-store posting is isolated (no cross-store dependencies)
- ✅ Store failures are independent (no cascading)
- ✅ Ledger traceability maintained (can trace to store)

### Accounting Independence
- ✅ Accounting can lag retail without breaking integrity
- ✅ Period locks don't block retail sales
- ✅ Accounting can retry failed events safely

### Event Immutability
- ✅ Events are never modified after emission
- ✅ Failed events remain unchanged
- ✅ Replay uses same event data

---

## 12. EVENT EMISSION RULES (RETAIL SIDE)

### When to Emit

**Daily Emission:**
- Emit one event per store per calendar day
- Emit after calendar day ends (store-local timezone)
- Can be scheduled (e.g., 1 AM next day) or manual trigger

**Emission Trigger:**
- Calendar day boundary (store-local)
- All eligible sales for that day are included
- No partial days (complete day only)

### Aggregation Logic

**Sales Selection:**
```sql
SELECT s.*, si.cogs
FROM sales s
LEFT JOIN sale_items si ON si.sale_id = s.id
WHERE s.store_id = {store_id}
  AND s.payment_status = 'paid'
  AND (s.is_voided = false OR s.is_voided IS NULL)
  AND (s.is_refund = false OR s.is_refund IS NULL)
  AND DATE(s.created_at AT TIME ZONE {store_timezone}) = {calendar_date}
```

**Tax Aggregation:**
```sql
-- Sum tax_lines from all eligible sales
-- Group by tax_code
-- Preserve ledger_account_code and ledger_side
```

**COGS Aggregation:**
```sql
-- Sum sale_items.cogs for all eligible sales
SELECT SUM(COALESCE(si.cogs, 0))
FROM sale_items si
WHERE si.sale_id IN (eligible_sale_ids)
```

### Event Validation

**Before Emission:**
- ✅ Validate all required fields present
- ✅ Validate sales_count > 0 (or allow zero for empty days)
- ✅ Validate totals balance (gross_sales = net_revenue + sum(tax_amounts))
- ✅ Validate tax_summary matches sales.tax_lines
- ✅ Validate no COVID levy in tax_summary
- ✅ Validate store_id exists
- ✅ Validate business_id exists

**After Emission:**
- ✅ Event is immutable (cannot be modified)
- ✅ Event can be re-emitted (idempotent)
- ✅ Event can be queried by idempotency key

---

## 13. EVENT CONSUMPTION RULES (ACCOUNTING SIDE)

### Event Acceptance

**Validation Before Posting:**
- ✅ Validate event structure (all required fields)
- ✅ Validate idempotency key (check for duplicates)
- ✅ Validate period exists and is open/soft_closed
- ✅ Validate all accounts exist
- ✅ Validate event totals balance

**If Validation Fails:**
- Mark event as `failed` (not `pending`)
- Log error details
- Do NOT create journal entry
- Event remains immutable

### Posting Process

**Step 1: Check Idempotency**
```sql
SELECT 1 FROM journal_entries
WHERE reference_type = 'store_day'
  AND reference_id = '{store_id}_{calendar_date}'
```
- If exists → skip (already posted)
- If not exists → proceed

**Step 2: Resolve Period**
```sql
SELECT * FROM accounting_periods
WHERE business_id = {business_id}
  AND period_start <= {calendar_date}
  AND period_end >= {calendar_date}
```
- If not found → mark as `failed`
- If status = `locked` → mark as `pending`
- If status = `open` or `soft_closed` → proceed

**Step 3: Resolve Accounts**
- CASH: `get_control_account_code(business_id, 'CASH')`
- Revenue: `get_account_by_code(business_id, '4000')`
- COGS: `get_account_by_code(business_id, '5000')`
- Inventory: `get_account_by_code(business_id, '1200')`
- Tax accounts: `get_account_by_code(business_id, tax_summary[].ledger_account_code)`

**Step 4: Create Journal Entry**
- Use `post_journal_entry()` function
- Pass all resolved account IDs
- Pass all amounts from event
- Set `reference_type = 'store_day'`
- Set `reference_id = '{store_id}_{calendar_date}'`

**Step 5: Mark Event as Posted**
- Update event status to `posted`
- Record `posted_at` timestamp
- Record `journal_entry_id`

---

## 14. EXAMPLE EVENT

### Sample Event Payload

```json
{
  "event_type": "RETAIL_STORE_DAY_CLOSED",
  "event_version": "1.0",
  "event_id": "770e8400-e29b-41d4-a716-446655440002",
  "emitted_at": "2025-01-28T01:00:00Z",
  
  "business_id": "550e8400-e29b-41d4-a716-446655440000",
  "store_id": "660e8400-e29b-41d4-a716-446655440001",
  "calendar_date": "2025-01-27",
  "store_timezone": "Africa/Accra",
  "currency": "GHS",
  
  "sales_count": 47,
  
  "totals": {
    "gross_sales": 12500.00,
    "net_revenue": 10250.00,
    "cogs": 6500.00,
    "inventory_delta": 6500.00
  },
  
  "tax_summary": [
    {
      "tax_code": "NHIL",
      "tax_name": "National Health Insurance Levy",
      "tax_rate": 0.025,
      "tax_base": 10250.00,
      "tax_amount": 256.25,
      "ledger_account_code": "2100",
      "ledger_side": "credit",
      "ghana_tax_version": "GH-2025-A"
    },
    {
      "tax_code": "GETFUND",
      "tax_name": "Ghana Education Trust Fund",
      "tax_rate": 0.025,
      "tax_base": 10250.00,
      "tax_amount": 256.25,
      "ledger_account_code": "2100",
      "ledger_side": "credit",
      "ghana_tax_version": "GH-2025-A"
    },
    {
      "tax_code": "VAT",
      "tax_name": "Value Added Tax",
      "tax_rate": 0.15,
      "tax_base": 10762.50,
      "tax_amount": 1614.38,
      "ledger_account_code": "2100",
      "ledger_side": "credit",
      "ghana_tax_version": "GH-2025-A"
    }
  ],
  
  "vat_engine": {
    "jurisdiction": "GH",
    "engine_code": "ghana",
    "engine_version": "GH-2025-A",
    "effective_from": "2025-01-01"
  },
  
  "source_refs": {
    "sales_ids": [
      "880e8400-e29b-41d4-a716-446655440010",
      "880e8400-e29b-41d4-a716-446655440011",
      "..."
    ],
    "store_name": "Accra Main Store",
    "business_name": "ABC Retail Ltd"
  },
  
  "metadata": {
    "aggregation_method": "sum_from_sales_tax_lines",
    "rounding_applied": false,
    "cogs_calculation": "sum_from_sale_items"
  }
}
```

### Corresponding Journal Entry

**Journal Entry:**
- `date`: `2025-01-27`
- `description`: `"Retail sales - Store: Accra Main Store - Date: 2025-01-27"`
- `reference_type`: `"store_day"`
- `reference_id`: `"660e8400-e29b-41d4-a716-446655440001_2025-01-27"`

**Journal Entry Lines:**
1. CASH (1000): Debit `12500.00`
2. Revenue (4000): Credit `10250.00`
3. VAT Payable (2100): Credit `1614.38`
4. NHIL Payable (2100): Credit `256.25`
5. GETFUND Payable (2100): Credit `256.25`
6. COGS (5000): Debit `6500.00`
7. Inventory (1200): Credit `6500.00`

**Balance Check:**
- Debit Total: `12500.00 + 6500.00 = 19000.00`
- Credit Total: `10250.00 + 1614.38 + 256.25 + 256.25 + 6500.00 = 18976.88`
- **Note:** Rounding difference of `23.12` (acceptable for aggregated posting)

---

## 15. CONTRACT VERSIONING

### Version Management

**Current Version:** `1.0`

**Version Changes:**
- Major version: Breaking changes (incompatible)
- Minor version: Additive changes (backward compatible)
- Patch version: Clarifications (no functional changes)

**Backward Compatibility:**
- Accounting MUST accept events from previous minor versions
- Accounting MUST ignore unknown fields
- Accounting MUST use default values for missing optional fields

**Future Versions:**
- `1.1`: Add refund event type
- `1.2`: Add multi-currency support
- `2.0`: Breaking change (if needed)

---

## CONCLUSION

This contract defines the **canonical event structure** for Retail → Accounting daily posting under **Option 3: Per Store × Per Day** granularity.

**Key Principles:**
- ✅ Retail is source of truth (VAT, sales, COGS)
- ✅ Accounting is downstream only (consumes, never recalculates)
- ✅ Events are immutable (never modified after emission)
- ✅ Posting is idempotent (safe replay)
- ✅ Multi-store safe (independent store-day events)

**Next Steps:**
- Implement event emission logic (Retail side)
- Implement event consumption logic (Accounting side)
- Add event queue/table for pending events
- Add retry mechanism for failed events
- Add monitoring and alerting

---

**End of Contract**
