# Event Emission Timing, Cut-Offs & Completeness Guarantees
**Retail → Accounting (Per Store × Per Day)**

**Version:** 1.0  
**Date:** 2025-01-27  
**Status:** Binding Architecture Specification  
**Mode:** Semantics Only (No Code)

---

## RESTRICTIONS (MANDATORY)

- ❌ Do NOT write or modify code
- ❌ Do NOT touch POS, cashier sessions, or UI
- ❌ Do NOT change VAT logic
- ❌ Do NOT assume single-store
- ❌ Do NOT weaken immutability or idempotency
- ✅ Define **WHEN** an event is emitted and **WHAT guarantees completeness**

---

## 1. PURPOSE

Define **when** a Store × Day event is emitted and **what conditions guarantee** that:

- All eligible sales are included
- No eligible sales are missed
- No future sales are accidentally included
- Replays are safe
- Multi-store behavior is deterministic

This step answers:
- *When is a store-day considered "closed"?*
- *What is the exact cutoff?*
- *How do we ensure completeness without blocking POS?*

---

## 2. CANONICAL TIME AXIS (LOCKED)

### Store-Local Time Is Authoritative

**Rule:**
- Each store operates on **store-local timezone**
- Calendar day boundaries are resolved using store-local time
- UTC is **never** used for day boundaries (only for storage)

**Timezone Resolution (Priority Order):**
1. `stores.timezone` (IANA timezone string, e.g., `"Africa/Accra"`)
2. `businesses.address_timezone` (IANA timezone string)
3. Fallback: `UTC` (only if both are NULL)

**Calendar Day Boundaries:**
```
Store Day D:
Start: D 00:00:00.000000 (store-local timezone)
End:   D 23:59:59.999999 (store-local timezone)
```

**Date Resolution Formula:**
```sql
-- Pseudo-code for date resolution
store_timezone = COALESCE(
  stores.timezone,
  businesses.address_timezone,
  'UTC'
)

calendar_date = DATE(
  sales.created_at AT TIME ZONE store_timezone
)
```

**This rule is non-negotiable.**

**Rationale:**
- Stores operate in local time (cashiers, customers, business hours)
- Day boundaries must match store operations
- UTC conversion would cause day boundary misalignment

---

## 3. DEFINITION: "STORE DAY CLOSED"

### Formal Definition

A **Store × Day** is considered **closed** when:

> The store-local clock has passed **00:00:00.000000 of the next calendar day**.

**Mathematical Definition:**
```
Store-Day D is closed at:
(D + 1 day) 00:00:00.000000 in store-local timezone
```

**Example:**
- Store timezone: `Africa/Accra` (UTC+0)
- Calendar date: `2025-01-27`
- Store-day closes at: `2025-01-28 00:00:00 Africa/Accra`
- In UTC: `2025-01-28 00:00:00 UTC` (same as Accra)

**Example (Different Timezone):**
- Store timezone: `America/New_York` (UTC-5)
- Calendar date: `2025-01-27`
- Store-day closes at: `2025-01-28 00:00:00 America/New_York`
- In UTC: `2025-01-28 05:00:00 UTC` (5 hours later)

**Critical Rule:**
- Store-day closure is **time-based**, not operation-based
- Closure does NOT depend on:
  - POS being idle
  - Cashiers logging out
  - Registers closing
  - Accounting state

---

## 4. EMISSION TIMING RULE (MANDATORY)

### Earliest Allowed Emission Time

An event for `{store_id, calendar_date = D}`:

- ❌ **MUST NOT** be emitted before store-day is closed
- ✅ **MAY** be emitted **any time after** store-day closes

**Valid Emission Window:**
```
[D+1 00:00:00.000000, ∞)
```

Where:
- `D+1` = next calendar day in store-local timezone
- `∞` = no upper bound (emission can happen days/weeks later)

**Formal Rule:**
```
emission_time >= (D + 1 day) 00:00:00.000000 (store-local)
```

**Example:**
- Calendar date: `2025-01-27`
- Store timezone: `Africa/Accra`
- Earliest emission: `2025-01-28 00:00:00 Africa/Accra`
- Valid emissions: `2025-01-28 01:00:00`, `2025-01-28 10:00:00`, `2025-01-29 00:00:00`, etc.

**No Upper Bound:**
- There is **no upper bound** on emission time
- Accounting lag is explicitly allowed
- Events can be emitted days or weeks later
- No expiration or timeout

**Rationale:**
- Ensures all sales for day D are included
- Prevents partial-day events
- Allows asynchronous processing
- Supports offline POS sync scenarios

---

## 5. EMISSION STRATEGY (RECOMMENDED, NOT REQUIRED)

### Recommended Strategy (Operationally Safe)

**Scheduled Emission:**
- Emit events **once per day per store**
- Recommended emission time: Between `01:00–03:00` store-local time
- Rationale:
  - Avoids edge cases around midnight
  - All late-night sales settled
  - No POS interference
  - Standard batch processing window

**Alternative Strategies (Also Valid):**
- Manual trigger (admin-initiated)
- Event-driven (triggered by external system)
- On-demand (when accounting requests)

**Explicit Non-Requirement:**
- ❌ Emission does NOT need to be real-time
- ❌ Emission does NOT depend on register closure
- ❌ Emission does NOT depend on cashier sessions
- ❌ Emission does NOT require all registers to be closed
- ❌ Emission does NOT require POS to be idle

**Sales Completeness:**
- Sales completeness is **time-based**, not session-based
- Time boundary (midnight) is the only requirement
- Operational state (registers, sessions) is irrelevant

---

## 6. COMPLETENESS GUARANTEE (CRITICAL)

### Completeness Rule (LOCKED)

An emitted event for `{store_id, calendar_date = D}` MUST include:

> **All and only** sales that satisfy:
```
store_id = {store_id}
AND payment_status = 'paid'
AND (is_voided = false OR is_voided IS NULL)
AND (is_refund = false OR is_refund IS NULL)
AND DATE(created_at AT TIME ZONE store_timezone) = D
```

### Guarantees Achieved By:

**1. Time-Based Cutoff:**
- Emission happens **after** day boundary (D+1 00:00:00)
- All sales for day D have `created_at` before emission
- No sales from day D+1 can be included (emission is after boundary)

**2. Immutable Sales Records:**
- Sales are immutable after creation (`created_at` never changes)
- Sales cannot be backdated (system enforces `created_at <= NOW()`)
- Sales eligibility is determined by `created_at` timestamp

**3. Emission After Day Boundary:**
- Emission timing ensures day D is complete
- No partial-day events possible
- All eligible sales for day D are included

**No Dependency On:**
- ❌ POS being "idle"
- ❌ Cashiers logging out
- ❌ Registers closing
- ❌ Accounting state
- ❌ Network connectivity
- ❌ System load

**Rationale:**
- Time-based cutoff is deterministic and unambiguous
- Operational state is irrelevant for completeness
- Sales eligibility is determined by timestamp, not state

---

## 7. LATE-ARRIVING SALES (EDGE CASE HANDLING)

### Scenario: Late Insert

A sale may be:
- Created late (e.g., offline POS sync, delayed network)
- Timestamped correctly in the past (using `created_at` from original transaction)

**Rule:**
- Eligibility is determined by `created_at` timestamp
- NOT by insert time (when sale record is created in database)
- NOT by emission time (when event is emitted)

**Example:**
- Sale occurred: `2025-01-27 23:30:00 Africa/Accra`
- Sale `created_at`: `2025-01-27 23:30:00` (correct timestamp)
- Sale inserted: `2025-01-28 02:00:00` (late sync)
- Event emitted: `2025-01-28 01:00:00` (before late sale inserted)

**Result:**
- Sale is **NOT included** in event (emitted before sale inserted)
- Sale belongs to day `2025-01-27` (by `created_at`)
- Event for `2025-01-27` is already emitted (immutable)

### If a Late Sale Appears AFTER Emission

**This is NOT a correction of the past event.**

**Required Handling (Future Step):**
- Late sale must be handled via:
  - Adjustment event (future contract), or
  - Next-day corrective mechanism (future contract)

**Strict Rule:**
- ❌ Never mutate an emitted event
- ❌ Never re-open a closed store-day
- ❌ Never re-emit an event with additional sales
- ✅ Corrections are additive and explicit

**Rationale:**
- Events are immutable (Step 3A)
- Re-emitting would violate idempotency
- Corrections must be explicit (adjustment events)

**Deferred:**
- Late sale handling is deferred to refund/adjustment events (future step)
- This step only defines completeness for on-time sales

---

## 8. ZERO-SALES DAYS (EXPLICIT RULE)

### If a Store Has Zero Eligible Sales

Two acceptable strategies:

#### Option A (RECOMMENDED)

**Emit a Zero-Sales Event:**
- `sales_count = 0`
- `totals.gross_sales = 0`
- `totals.net_revenue = 0`
- `totals.cogs = 0`
- `totals.inventory_delta = 0`
- `tax_summary = []` (empty array)
- Status lifecycle identical to non-zero events

**Benefits:**
- ✅ Continuous ledger days (no gaps)
- ✅ Easier reconciliation (explicit "no activity" record)
- ✅ Clear audit trail (day exists even if no sales)
- ✅ Simpler accounting queries (no need to infer missing days)

**Tradeoffs:**
- Slightly more storage (one event per day, even if zero)
- Slightly more processing (one event per day)

#### Option B

**Do Not Emit Event:**
- No event created for zero-sales days
- Accounting infers "no activity" from absence of event

**Benefits:**
- Less storage (no zero-sales events)
- Less processing (no events to process)

**Tradeoffs:**
- ❌ Gaps in ledger days (harder reconciliation)
- ❌ Harder audits (must infer missing days)
- ❌ More complex accounting queries (must handle missing days)

**Recommendation:** **Option A** (emit zero-sales events)

**Rationale:**
- Explicit is better than implicit
- Easier reconciliation and auditing
- Consistent event stream (one per day)
- Matches real-world retail accounting practice

---

## 9. MULTI-STORE INDEPENDENCE

### Store Calendar Independence

**Rule:**
- Each store has its **own calendar**
- Each store has its **own emission timing**
- Each store has its **own failure lifecycle**

**Explicitly Allowed:**
- Store A emits on time (`2025-01-28 01:00:00`)
- Store B emits late (`2025-01-28 10:00:00`)
- Store C fails emission (retry later)
- None affect each other

**No Global "Business Day":**
- There is **no global "business day"**
- Each store operates independently
- Store A's day closure does not affect Store B

**Example:**
- Store A (Accra, UTC+0): Day `2025-01-27` closes at `2025-01-28 00:00:00 UTC`
- Store B (New York, UTC-5): Day `2025-01-27` closes at `2025-01-28 05:00:00 UTC`
- Both stores can emit independently
- No coordination needed

**Concurrency:**
- Stores can emit in parallel
- No shared locks or coordination
- Each store processes independently

---

## 10. IDEMPOTENT EMISSION GUARANTEE

### Retail Emission Logic MUST Satisfy

**Idempotency Rule:**
- Emitting same `{store_id, calendar_date}` twice:
  - Returns existing event (if exists)
  - Does not change payload (immutable)
  - Does not change status (if already `emitted`)

**Enforcement:**
- Unique constraint: `UNIQUE (business_id, store_id, calendar_date)`
- Database-level enforcement (cannot be bypassed)
- Retail emission uses `INSERT ... ON CONFLICT DO NOTHING` or `UPSERT`

**Retry Safety:**
- Retail can retry emission (idempotent)
- Same store-day → same event (no duplicates)
- Safe to retry after network failures, system restarts, etc.

**Rationale:**
- Prevents duplicate events (database constraint)
- Safe retry mechanism (idempotent)
- Matches Step 3A idempotency model

---

## 11. FAILURE IS NOT ROLLBACK

### If Emission Fails

**Operational Impact:**
- ❌ Sales are **NOT rolled back**
- ❌ POS is **NOT blocked**
- ❌ Cashiers are **NOT affected**
- ❌ Accounting state is irrelevant

**Emission Failure Scenarios:**
1. **Network failure** (cannot write to database)
2. **Database error** (constraint violation, etc.)
3. **System error** (application crash, etc.)

**Consequences:**
- Sales remain in database (unchanged)
- POS continues operating (unaffected)
- Event is not created (retry later)
- Accounting cannot post (no event to consume)

**Recovery:**
- Retry emission (idempotent)
- Same sales → same event (deterministic)
- No side effects from retry

**Rationale:**
- Emission failure is **operational**, not financial
- Sales are already committed (immutable)
- Event emission is downstream (does not affect sales)

---

## 12. EMISSION VALIDATION (PRE-EMISSION)

### Before Emission, Retail MUST Validate

**1. Store Exists:**
- `store_id` exists in `stores` table
- Store belongs to `business_id`
- Store is active (not deleted)

**2. Business Exists:**
- `business_id` exists in `businesses` table
- Business is active (not deleted)

**3. Timezone Resolution:**
- Store timezone can be resolved (from `stores.timezone` or `businesses.address_timezone`)
- If both NULL, use UTC (fallback)

**4. Day Boundary Check:**
- Current time (store-local) >= (D + 1) 00:00:00
- Day D is closed (cannot emit before closure)

**5. Eligible Sales Exist (or Zero):**
- Query eligible sales for day D
- If zero sales → emit zero-sales event (Option A) or skip (Option B)
- If sales exist → proceed with aggregation

**If Validation Fails:**
- Do NOT emit event
- Log error
- Retry later (after validation passes)

---

## 13. AGGREGATION COMPLETENESS CHECK

### During Aggregation, Retail MUST Verify

**1. Sales Selection Completeness:**
- All eligible sales for day D are included
- No eligible sales are excluded
- No ineligible sales are included

**2. Date Boundary Accuracy:**
- All included sales have `DATE(created_at AT TIME ZONE store_timezone) = D`
- No sales from day D-1 or D+1 are included

**3. Store Boundary Accuracy:**
- All included sales have `store_id = {store_id}`
- No sales from other stores are included

**4. Eligibility Criteria:**
- All included sales have `payment_status = 'paid'`
- All included sales are not voided (`is_voided = false OR NULL`)
- All included sales are not refunds (`is_refund = false OR NULL`)

**5. Aggregation Consistency:**
- `gross_sales = SUM(sales.amount)` for eligible sales
- `net_revenue = gross_sales - SUM(tax_amounts)`
- `cogs = SUM(sale_items.cogs)` for eligible sales
- `tax_summary` matches `sales.tax_lines` aggregation

**If Completeness Check Fails:**
- Do NOT emit event
- Log error with details
- Retry after investigation

---

## 14. EMISSION TIMING EXAMPLES

### Example 1: Standard Emission

**Store:** Accra Main Store  
**Timezone:** `Africa/Accra` (UTC+0)  
**Calendar Date:** `2025-01-27`

**Timeline:**
- `2025-01-27 23:59:59` - Last sale of day
- `2025-01-28 00:00:00` - Day closes (store-local)
- `2025-01-28 01:00:00` - Event emitted (scheduled)

**Result:**
- Event includes all sales from `2025-01-27 00:00:00` to `2025-01-27 23:59:59`
- No sales from `2025-01-28` are included
- Event is complete and immutable

---

### Example 2: Late Emission

**Store:** Accra Main Store  
**Timezone:** `Africa/Accra` (UTC+0)  
**Calendar Date:** `2025-01-27`

**Timeline:**
- `2025-01-27 23:59:59` - Last sale of day
- `2025-01-28 00:00:00` - Day closes (store-local)
- `2025-01-28 10:00:00` - Event emitted (late, but valid)

**Result:**
- Event includes all sales from `2025-01-27 00:00:00` to `2025-01-27 23:59:59`
- No sales from `2025-01-28` are included (emission is after day boundary)
- Event is complete and immutable

---

### Example 3: Multi-Store Different Timezones

**Store A:** Accra Main Store  
**Timezone:** `Africa/Accra` (UTC+0)  
**Calendar Date:** `2025-01-27`

**Store B:** New York Store  
**Timezone:** `America/New_York` (UTC-5)  
**Calendar Date:** `2025-01-27`

**Timeline:**
- `2025-01-28 00:00:00 UTC` - Store A day closes
- `2025-01-28 05:00:00 UTC` - Store B day closes (5 hours later)
- `2025-01-28 01:00:00 UTC` - Store A event emitted
- `2025-01-28 06:00:00 UTC` - Store B event emitted

**Result:**
- Store A event includes sales from `2025-01-27 00:00:00` to `2025-01-27 23:59:59` (Accra time)
- Store B event includes sales from `2025-01-27 00:00:00` to `2025-01-27 23:59:59` (New York time)
- Both events are independent and complete

---

### Example 4: Zero-Sales Day (Option A)

**Store:** Accra Main Store  
**Timezone:** `Africa/Accra` (UTC+0)  
**Calendar Date:** `2025-01-27`

**Timeline:**
- `2025-01-27` - No sales occurred (store closed, holiday, etc.)
- `2025-01-28 00:00:00` - Day closes
- `2025-01-28 01:00:00` - Event emitted (zero-sales event)

**Result:**
- Event with `sales_count = 0`
- All totals are zero
- `tax_summary = []`
- Event is complete and immutable
- Accounting can see explicit "no activity" record

---

### Example 5: Late-Arriving Sale (Edge Case)

**Store:** Accra Main Store  
**Timezone:** `Africa/Accra` (UTC+0)  
**Calendar Date:** `2025-01-27`

**Timeline:**
- `2025-01-27 23:30:00` - Sale occurred (offline POS)
- `2025-01-28 00:00:00` - Day closes
- `2025-01-28 01:00:00` - Event emitted (before late sale sync)
- `2025-01-28 02:00:00` - Late sale synced to database

**Result:**
- Event does NOT include late sale (emitted before sync)
- Late sale belongs to day `2025-01-27` (by `created_at`)
- Event for `2025-01-27` is already emitted (immutable)
- Late sale must be handled via adjustment event (future step)

---

## 15. EMISSION FAILURE SCENARIOS

### Scenario 1: Network Failure

**What Happens:**
- Retail attempts to emit event
- Network connection fails
- Event not created in database

**Consequences:**
- Sales remain in database (unchanged)
- POS continues operating (unaffected)
- Event emission retried later (idempotent)

**Recovery:**
- Retry emission (same sales → same event)
- No side effects from retry

---

### Scenario 2: Database Constraint Violation

**What Happens:**
- Retail attempts to emit event
- Unique constraint violation (event already exists)
- Event not created (duplicate)

**Consequences:**
- Existing event remains (unchanged)
- No duplicate event created
- Idempotency enforced (safe retry)

**Recovery:**
- Return existing event (idempotent)
- No action needed

---

### Scenario 3: Aggregation Error

**What Happens:**
- Retail attempts to aggregate sales
- Aggregation logic fails (bug, data corruption, etc.)
- Event not created

**Consequences:**
- Sales remain in database (unchanged)
- Event not created
- Error logged for investigation

**Recovery:**
- Fix aggregation bug
- Retry emission (same sales → same event)
- No side effects from retry

---

## 16. ACCEPTANCE CRITERIA

Step 3B is complete only if all of the following are true:

### Store-Day Boundary Is Time-Based and Unambiguous
- ✅ Day boundary defined by store-local midnight
- ✅ Timezone resolution is deterministic (priority order)
- ✅ No UTC ambiguity for day boundaries

### Emission Never Includes Partial Days
- ✅ Emission only happens after day closes (D+1 00:00:00)
- ✅ All sales for day D are included (complete)
- ✅ No sales from day D+1 are included (future sales excluded)

### Emission Never Depends on POS or Sessions
- ✅ Time-based cutoff (not state-based)
- ✅ No dependency on register closure
- ✅ No dependency on cashier sessions
- ✅ No dependency on POS idle state

### Late Accounting Does Not Affect Retail
- ✅ No upper bound on emission time
- ✅ Accounting lag is explicitly allowed
- ✅ Retail is unaffected by accounting state

### Multi-Store Emission Is Independent
- ✅ Each store has own calendar
- ✅ Each store has own emission timing
- ✅ No global "business day"
- ✅ Stores can emit independently

### Zero-Sales Days Are Handled Explicitly or by Policy
- ✅ Policy defined (Option A or Option B)
- ✅ Zero-sales days are handled consistently
- ✅ No ambiguity about missing days

### Immutability Is Preserved
- ✅ Events are immutable after emission
- ✅ Late sales do not mutate past events
- ✅ Corrections are additive (future step)

---

## 17. EMISSION QUERY PATTERN

### Retail Emission Logic (Pseudo-Code)

```sql
-- Step 1: Resolve store timezone
store_timezone = COALESCE(
  stores.timezone,
  businesses.address_timezone,
  'UTC'
)

-- Step 2: Verify day is closed
current_time = NOW() AT TIME ZONE store_timezone
day_closed_time = (calendar_date + INTERVAL '1 day')::DATE || ' 00:00:00' AT TIME ZONE store_timezone

IF current_time < day_closed_time THEN
  ERROR "Day is not closed yet. Cannot emit event before (D+1) 00:00:00"
END IF

-- Step 3: Check if event already exists (idempotency)
IF EXISTS (
  SELECT 1 FROM retail_store_day_events
  WHERE business_id = {business_id}
    AND store_id = {store_id}
    AND calendar_date = {calendar_date}
) THEN
  RETURN existing_event (idempotent)
END IF

-- Step 4: Select eligible sales
eligible_sales = SELECT * FROM sales
WHERE store_id = {store_id}
  AND payment_status = 'paid'
  AND (is_voided = false OR is_voided IS NULL)
  AND (is_refund = false OR is_refund IS NULL)
  AND DATE(created_at AT TIME ZONE store_timezone) = {calendar_date}

-- Step 5: Aggregate (Step 2C rules)
-- ... aggregation logic ...

-- Step 6: Create event
INSERT INTO retail_store_day_events (
  event_id,
  business_id,
  store_id,
  calendar_date,
  idempotency_key,
  status,
  event_payload,
  emitted_at,
  ...
) VALUES (
  gen_random_uuid(),
  {business_id},
  {store_id},
  {calendar_date},
  {idempotency_key},
  'emitted',
  {event_payload},
  NOW()
)
ON CONFLICT (business_id, store_id, calendar_date) DO NOTHING
```

---

## CONCLUSION

This document defines the **emission timing, cut-offs, and completeness guarantees** for Retail → Accounting daily events under **Option 3: Per Store × Per Day** posting granularity.

**Key Principles:**
- ✅ Store-local timezone is authoritative (day boundaries)
- ✅ Time-based cutoff (not state-based)
- ✅ Emission after day closure (D+1 00:00:00)
- ✅ Completeness guaranteed by time boundary
- ✅ Multi-store independence (separate calendars)
- ✅ Immutability preserved (no mutation of past events)

**Next Steps:**
- Implement emission timing logic (Retail side)
- Implement timezone resolution
- Implement completeness validation
- Add zero-sales day handling
- Add late sale handling (future step)

---

**End of Document**
