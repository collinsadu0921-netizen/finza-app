# Event Storage & Idempotency Model
**Retail → Accounting (Per Store × Per Day)**

**Version:** 1.0  
**Date:** 2025-01-27  
**Status:** Binding Architecture Specification  
**Mode:** Data Model + Semantics Only (No Code)

---

## RESTRICTIONS (MANDATORY)

- ❌ Do NOT write or modify code
- ❌ Do NOT touch POS, cashier sessions, or UI
- ❌ Do NOT change VAT logic
- ❌ Do NOT assume single-store
- ❌ Do NOT weaken idempotency rules
- ✅ Define **where events live**, **how idempotency is enforced**, and **how failures are tracked**

---

## 1. PURPOSE

Define the **canonical storage model** for Retail → Accounting daily events so that:

- Each **Store × Calendar Day** produces exactly **one immutable event**
- Events are **replay-safe and idempotent**
- Accounting can retry safely without duplication
- Multi-store businesses scale without contention
- Failures are observable and recoverable

This step answers:
- *Where does the event live?*
- *How do we prevent double posting?*
- *How do we retry safely?*

---

## 2. EVENT STORAGE LOCATION (AUTHORITATIVE)

### Canonical Table: `retail_store_day_events`

**Ownership:** Retail (emits events)  
**Consumer:** Accounting (consumes events)  
**Source of Truth:** Retail (immutable after emission)

This table is the **only authoritative record** of store-day aggregation.

**Critical Rule:**
- Accounting must **never infer** or rebuild events from sales
- Accounting must **only read** from this table
- Events are **immutable** after emission

**Rationale:**
- Single source of truth for daily aggregation
- Prevents accounting from recalculating (preserves VAT integrity)
- Enables replay and retry without re-aggregation

---

## 3. TABLE SEMANTICS (NO SQL, CONTRACT ONLY)

### Core Identity Fields (NON-NEGOTIABLE)

**`event_id` (UUID)**
- Unique identifier for this event instance
- Generated at emission time (UUID v4)
- Used for event tracking and audit trail
- Never changes after creation

**`business_id` (UUID)**
- Owner business (references `businesses.id`)
- Used for business-scoped queries
- Part of idempotency key

**`store_id` (UUID)**
- Store emitting the event (references `stores.id`)
- Used for store-scoped queries
- Part of idempotency key

**`calendar_date` (DATE)**
- Store-local calendar date (YYYY-MM-DD format)
- Used for date-scoped queries
- Part of idempotency key
- Never changes after creation

**`idempotency_key` (TEXT)**
- Composite key: `{business_id}_{store_id}_{calendar_date}`
- MUST be unique (enforced by database constraint)
- MUST be immutable (never changes)
- Used for replay protection and duplicate detection

**Uniqueness Rule:**
- Exactly **one row per (business_id, store_id, calendar_date)**
- Enforced by `UNIQUE (business_id, store_id, calendar_date)` constraint
- Database-level enforcement (cannot be bypassed)

**Example:**
```
business_id: "550e8400-e29b-41d4-a716-446655440000"
store_id: "660e8400-e29b-41d4-a716-446655440001"
calendar_date: "2025-01-27"
idempotency_key: "550e8400-e29b-41d4-a716-446655440000_660e8400-e29b-41d4-a716-446655440001_2025-01-27"
```

---

### Event Payload Storage

**`event_payload` (JSONB)**
- Stores the **entire Step 2B + 2C event** (complete event contract)
- Must include all required fields from event contract:
  - `event_type`: `"RETAIL_STORE_DAY_CLOSED"`
  - `event_version`: `"1.0"`
  - `totals`: `{ gross_sales, net_revenue, cogs, inventory_delta }`
  - `tax_summary`: Array of tax line items
  - `vat_engine`: VAT engine metadata
  - `source_refs`: `{ sales_ids, store_name, business_name }`
  - `metadata`: Aggregation metadata

**Rules:**
- Payload is written **once** (at emission time)
- Payload is **never updated** (immutable)
- Any correction requires **new event** (future versioning)
- Payload format must match Step 2B event contract exactly

**Rationale:**
- Complete event snapshot (no need to re-aggregate)
- Immutable record (audit trail)
- Versioned (future compatibility)

---

### Event Status & Lifecycle

**`status` (TEXT)**
- Current state of event in lifecycle
- Allowed values: `'emitted'`, `'posting'`, `'posted'`, `'failed'`, `'pending'`
- Enforced by CHECK constraint
- Updated by Accounting (not Retail)

**`emitted_at` (TIMESTAMP WITH TIME ZONE)**
- When Retail emitted the event
- Set at event creation (immutable)
- Used for emission timing and audit

**`posted_at` (TIMESTAMP WITH TIME ZONE)**
- When Accounting successfully posted to ledger
- Set when status changes to `'posted'` (immutable after set)
- NULL until posting succeeds

**`journal_entry_id` (UUID)**
- Reference to created journal entry (references `journal_entries.id`)
- Set when status changes to `'posted'`
- NULL until posting succeeds
- Used for reconciliation: `event → journal_entry`

---

### Failure Tracking (Observability)

**`last_error_code` (TEXT)**
- Machine-readable error code (e.g., `"PERIOD_LOCKED"`, `"ACCOUNT_MISSING"`, `"ROUNDING_EXCEEDS_TOLERANCE"`)
- Updated on each failure attempt
- NULL if no errors
- Used for error categorization and filtering

**`last_error_message` (TEXT)**
- Human-readable error message
- Updated on each failure attempt
- NULL if no errors
- Used for debugging and user-facing errors

**`last_attempt_at` (TIMESTAMP WITH TIME ZONE)**
- When Accounting last attempted to post
- Updated on each attempt (success or failure)
- NULL until first attempt
- Used for retry timing and monitoring

**`attempt_count` (INTEGER)**
- Number of posting attempts (including retries)
- Incremented on each attempt
- Starts at 0, increments on each try
- Used for retry limits and monitoring

**Rules:**
- Failure metadata updated only by Accounting
- Payload never touched (immutable)
- Errors must be human-readable
- All failure fields can be NULL (no errors yet)

---

### Metadata & Audit Fields

**`store_name` (TEXT)**
- Store name at emission time (from `stores.name`)
- Denormalized for query performance
- Immutable after emission
- Used for human-readable queries

**`business_name` (TEXT)**
- Business name at emission time (from `businesses.name`)
- Denormalized for query performance
- Immutable after emission
- Used for human-readable queries

**`emitted_by` (UUID)**
- User who triggered event emission (references `auth.users.id`)
- NULL if system-emitted (scheduled job)
- Used for audit trail

**`created_at` (TIMESTAMP WITH TIME ZONE)**
- When event row was created (default: NOW())
- Immutable (database default)
- Used for chronological queries

**`updated_at` (TIMESTAMP WITH TIME ZONE)**
- When event row was last updated (default: NOW(), updated on status change)
- Updated by Accounting on status changes
- Used for monitoring and debugging

---

## 4. EVENT STATUS STATE MACHINE (STRICT)

### Allowed States

| Status | Meaning | Mutability | Who Sets | When |
|--------|---------|------------|----------|------|
| `emitted` | Retail emitted, not yet consumed | Immutable | Retail | At emission |
| `posting` | Accounting is attempting post | Mutable | Accounting | During posting attempt |
| `posted` | Successfully posted to ledger | Immutable | Accounting | After successful post |
| `failed` | Permanent failure | Immutable | Accounting | After failure (non-retryable) |
| `pending` | Blocked by period lock | Mutable | Accounting | When period locked |

### State Transition Rules

**Allowed Transitions:**
```
emitted → posting → posted
emitted → posting → pending
emitted → posting → failed
pending → posting → posted
pending → posting → failed
```

**Forbidden Transitions:**
- ❌ `posted → *` (posted events are immutable)
- ❌ `failed → *` (failed events are immutable, require manual intervention)
- ❌ `emitted → posted` (must go through `posting` state)
- ❌ `posting → emitted` (cannot go backwards)

**State Mutability:**
- `emitted`: Immutable (set by Retail, never changes)
- `posting`: Mutable (temporary state during posting attempt)
- `posted`: Immutable (final success state)
- `failed`: Immutable (final failure state, requires manual intervention)
- `pending`: Mutable (can retry when period unlocks)

**Payload Immutability:**
- Payload **never changes** in any state
- Status changes do not modify payload
- Any correction requires new event (future versioning)

---

## 5. IDEMPOTENCY ENFORCEMENT (CORE)

### Layer 1 — Storage-Level Idempotency

**Database Constraint:**
- `UNIQUE (business_id, store_id, calendar_date)`
- Enforced at database level (cannot be bypassed)
- Prevents duplicate events for same store-day

**Retail Emission Behavior:**
- Retail emitting same day twice:
  - **Option A:** No-op (return existing event)
  - **Option B:** Raise error (idempotency violation)
  - **Recommended:** Option A (idempotent emission)

**Implementation:**
- Use `INSERT ... ON CONFLICT DO NOTHING` or `UPSERT`
- If conflict → return existing event (idempotent)
- If no conflict → create new event

**Rationale:**
- Prevents duplicate events at source
- Safe to retry emission (idempotent)
- Database enforces uniqueness (cannot be bypassed)

---

### Layer 2 — Accounting-Level Idempotency

**Pre-Posting Check:**
Before posting, Accounting MUST check:

```sql
SELECT 1 FROM journal_entries
WHERE business_id = {business_id}
  AND reference_type = 'store_day'
  AND reference_id = '{store_id}_{calendar_date}'
LIMIT 1
```

**Rules:**
- If journal entry exists → skip posting (idempotent success)
- If not exists → proceed to post
- Check must be atomic (within transaction)

**Reference ID Format:**
- `reference_type = 'store_day'` (constant)
- `reference_id = '{store_id}_{calendar_date}'` (matches idempotency key pattern)

**Rationale:**
- Prevents double posting at ledger level
- Safe to retry posting (idempotent)
- Independent of event table (defense in depth)

---

### Layer 3 — Event-Level Idempotency

**Deterministic Posting:**
- Accounting may retry same event N times
- Same `event_id` + same payload must always yield same journal entry
- Deterministic behavior enforced by Step 2C rules

**Enforcement:**
- Aggregation order is deterministic (Step 2C)
- Rounding calculation is deterministic (Step 2C)
- Account resolution is deterministic (same accounts)
- No random values or timestamps in journal entry

**Retry Safety:**
- Event can be re-processed by Accounting (idempotent)
- Same event → same journal entry (deterministic)
- No side effects from replay

**Rationale:**
- Ensures replay produces identical results
- Prevents drift from retries
- Mathematically guaranteed by Step 2C rules

---

## 6. FAILURE TRACKING (OBSERVABILITY)

### Failure Metadata

**`last_error_code` (TEXT)**
- Machine-readable error code
- Examples:
  - `"PERIOD_LOCKED"` - Period is locked
  - `"ACCOUNT_MISSING"` - Required account not found
  - `"ROUNDING_EXCEEDS_TOLERANCE"` - Rounding delta too large
  - `"EVENT_INVALID"` - Event schema validation failed
  - `"INTERNAL_CONSISTENCY_FAILED"` - Event totals don't balance
- NULL if no errors
- Updated on each failure attempt

**`last_error_message` (TEXT)**
- Human-readable error message
- Includes context (account code, period date, etc.)
- NULL if no errors
- Updated on each failure attempt

**`last_attempt_at` (TIMESTAMP WITH TIME ZONE)**
- When Accounting last attempted to post
- Updated on each attempt (success or failure)
- NULL until first attempt
- Used for retry timing

**`attempt_count` (INTEGER)**
- Number of posting attempts (including retries)
- Starts at 0
- Incremented on each attempt
- Used for retry limits and monitoring

**Rules:**
- Failure metadata updated only by Accounting
- Payload never touched (immutable)
- Errors must be human-readable
- All failure fields can be NULL (no errors yet)

---

### Failure Scenarios

**1. Period Locked:**
- `status = 'pending'`
- `last_error_code = 'PERIOD_LOCKED'`
- `last_error_message = 'Period {period_start} is locked. Event will be retried when period unlocks.'`
- `attempt_count` incremented
- Event remains immutable

**2. Account Missing:**
- `status = 'failed'`
- `last_error_code = 'ACCOUNT_MISSING'`
- `last_error_message = 'Account {account_code} not found. Please create account before retrying.'`
- `attempt_count` incremented
- Event remains immutable
- Retry after account created

**3. Rounding Exceeds Tolerance:**
- `status = 'failed'`
- `last_error_code = 'ROUNDING_EXCEEDS_TOLERANCE'`
- `last_error_message = 'Rounding delta {delta} exceeds tolerance {tolerance}. Requires investigation.'`
- `attempt_count` incremented
- Event remains immutable
- Requires manual investigation

**4. Event Invalid:**
- `status = 'failed'`
- `last_error_code = 'EVENT_INVALID'`
- `last_error_message = 'Event schema validation failed: {details}'`
- `attempt_count` incremented
- Event remains immutable
- Requires event re-emission

**5. Internal Consistency Failed:**
- `status = 'failed'`
- `last_error_code = 'INTERNAL_CONSISTENCY_FAILED'`
- `last_error_message = 'Event totals do not balance: gross_sales ({gross}) != net_revenue ({net}) + total_tax ({tax})'`
- `attempt_count` incremented
- Event remains immutable
- Requires investigation (aggregation bug)

---

## 7. PERIOD LOCK HANDLING

### If Period is Locked

**Accounting Behavior:**
- Accounting MUST:
  - Set `status = 'pending'`
  - Set `last_error_code = 'PERIOD_LOCKED'`
  - Set `last_error_message = 'Period {period_start} is locked. Event will be retried when period unlocks.'`
  - Increment `attempt_count`
  - Set `last_attempt_at = NOW()`

**Event Immutability:**
- Event remains immutable (payload unchanged)
- Retail is unaffected (no rollback)
- Event can be retried when period unlocks

**Retry Rule:**
- When period unlocks:
  - Accounting retries all `pending` events
  - Same idempotency checks apply (Layer 2)
  - No duplication possible (idempotent)

**Retry Process:**
1. Query: `SELECT * FROM retail_store_day_events WHERE status = 'pending'`
2. For each event:
   - Check period status (must be `open` or `soft_closed`)
   - Check idempotency (Layer 2)
   - Attempt posting
   - Update status (`posted` or `failed`)

---

## 8. MULTI-STORE SAFETY GUARANTEES

### Store Isolation

**Independent Events:**
- Each store-day event is **independent**
- No cross-store joins required
- No global aggregation tables
- Parallel posting is safe

**Concurrency Rule:**
- Two stores posting same day must never block each other
- No shared locks or coordination needed
- Each store processes independently

**Isolation Enforcement:**
- `idempotency_key` includes `store_id` (unique per store)
- `reference_id` includes `store_id` (unique per store)
- Journal entries reference store (via description and reference_id)
- No cross-store dependencies

**Example:**
- Store A: `idempotency_key = "business_123_store_A_2025-01-27"`
- Store B: `idempotency_key = "business_123_store_B_2025-01-27"`
- Both can post in parallel (different keys)
- No contention or blocking

---

## 9. AUDIT TRAIL REQUIREMENTS

### Accountant Visibility

**Accountants must be able to:**

1. **List Store-Day Events:**
   - Filter by business (`business_id`)
   - Filter by store (`store_id`)
   - Filter by date range (`calendar_date`)
   - Filter by status (`status`)
   - Sort by date, store, status

2. **See Exact Payload:**
   - View complete `event_payload` JSONB
   - See all totals, tax summary, VAT engine metadata
   - Trace back to source sales (`source_refs.sales_ids`)

3. **See Why Event Failed:**
   - View `last_error_code` and `last_error_message`
   - See `attempt_count` and `last_attempt_at`
   - Understand failure reason

4. **Reconcile Chain:**
   ```
   sales → event → journal_entry
   ```
   - Trace from `sales.id` → `event.source_refs.sales_ids` → `event.journal_entry_id` → `journal_entries.id`
   - Verify all sales are included in event
   - Verify event was posted to ledger

5. **Query Patterns:**
   - Find all events for a store in a date range
   - Find all failed events for a business
   - Find all pending events (waiting for period unlock)
   - Find events that produced specific journal entry

---

## 10. INDEXING REQUIREMENTS (PERFORMANCE)

### Required Indexes

**Primary Lookup:**
- `(business_id, store_id, calendar_date)` - Unique constraint (covers idempotency key)
- `(business_id, calendar_date)` - For business-wide date queries
- `(store_id, calendar_date)` - For store-specific date queries

**Status Queries:**
- `(status)` - For filtering by status
- `(status, business_id)` - For business-specific status queries
- `(status, calendar_date)` - For date-range status queries

**Journal Entry Reconciliation:**
- `(journal_entry_id)` - For reverse lookup (journal_entry → event)
- `(business_id, journal_entry_id)` - For business-scoped reconciliation

**Retry Queries:**
- `(status, last_attempt_at)` - For retry scheduling
- `(status, attempt_count)` - For retry limit monitoring

**Audit Queries:**
- `(emitted_at)` - For chronological queries
- `(posted_at)` - For posting timing analysis
- `(business_id, emitted_at)` - For business-specific timing

---

## 11. NON-GOALS (EXPLICIT)

This step does NOT:

- ❌ Implement event emission logic (Retail side)
- ❌ Implement event consumption logic (Accounting side)
- ❌ Implement queues or cron jobs
- ❌ Define UI for events
- ❌ Modify accounting schema (journal_entries, etc.)
- ❌ Add refund handling (future step)
- ❌ Handle multi-currency (future step)
- ❌ Implement retry scheduling
- ❌ Add monitoring or alerting
- ❌ Define event versioning strategy (future step)

**This is a data model and semantics contract only.**

---

## 12. ACCEPTANCE CRITERIA

Step 3A is complete only if all of the following are true:

### Exactly One Event Per Store Per Day
- ✅ Database constraint enforces uniqueness
- ✅ Retail emission is idempotent (no duplicates)
- ✅ Accounting cannot create duplicate events

### Events Are Immutable After Emission
- ✅ Payload never changes (immutable)
- ✅ Status transitions are controlled (state machine)
- ✅ Posted and failed events are immutable (final states)

### Idempotency Enforced at Multiple Layers
- ✅ Layer 1: Storage-level (unique constraint)
- ✅ Layer 2: Accounting-level (journal entry check)
- ✅ Layer 3: Event-level (deterministic posting)

### Failures Are Observable and Retryable
- ✅ Failure metadata captured (`last_error_code`, `last_error_message`)
- ✅ Attempt tracking (`attempt_count`, `last_attempt_at`)
- ✅ Status reflects failure state (`failed` or `pending`)
- ✅ Retry is safe (idempotent)

### Multi-Store Concurrency Is Safe
- ✅ Store events are independent (no cross-store dependencies)
- ✅ Parallel posting is safe (no contention)
- ✅ Store failures are isolated (no cascading)

### Accounting Can Lag Retail Safely
- ✅ Events remain in `emitted` state until consumed
- ✅ No timeouts or expiration
- ✅ Accounting can process events asynchronously
- ✅ Retail is unaffected by accounting lag

---

## 13. EXAMPLE: EVENT LIFECYCLE

### Emission (Retail Side)

**Initial State:**
```
event_id: "770e8400-e29b-41d4-a716-446655440002"
business_id: "550e8400-e29b-41d4-a716-446655440000"
store_id: "660e8400-e29b-41d4-a716-446655440001"
calendar_date: "2025-01-27"
idempotency_key: "550e8400-e29b-41d4-a716-446655440000_660e8400-e29b-41d4-a716-446655440001_2025-01-27"
status: "emitted"
event_payload: { ... complete event contract ... }
emitted_at: "2025-01-28T01:00:00Z"
posted_at: NULL
journal_entry_id: NULL
last_error_code: NULL
last_error_message: NULL
last_attempt_at: NULL
attempt_count: 0
```

### Posting Attempt (Accounting Side)

**During Posting:**
```
status: "posting"
last_attempt_at: "2025-01-28T02:00:00Z"
attempt_count: 1
```

**If Period Locked:**
```
status: "pending"
last_error_code: "PERIOD_LOCKED"
last_error_message: "Period 2025-01-01 is locked. Event will be retried when period unlocks."
last_attempt_at: "2025-01-28T02:00:00Z"
attempt_count: 1
```

**If Account Missing:**
```
status: "failed"
last_error_code: "ACCOUNT_MISSING"
last_error_message: "Account 3999 (Rounding Adjustments) not found. Please create account before retrying."
last_attempt_at: "2025-01-28T02:00:00Z"
attempt_count: 1
```

### Successful Posting (Accounting Side)

**After Success:**
```
status: "posted"
posted_at: "2025-01-28T02:05:00Z"
journal_entry_id: "880e8400-e29b-41d4-a716-446655440010"
last_error_code: NULL
last_error_message: NULL
last_attempt_at: "2025-01-28T02:05:00Z"
attempt_count: 1
```

### Retry After Period Unlock

**Before Retry:**
```
status: "pending"
last_attempt_at: "2025-01-28T02:00:00Z"
attempt_count: 1
```

**During Retry:**
```
status: "posting"
last_attempt_at: "2025-01-29T10:00:00Z"
attempt_count: 2
```

**After Success:**
```
status: "posted"
posted_at: "2025-01-29T10:05:00Z"
journal_entry_id: "880e8400-e29b-41d4-a716-446655440010"
last_error_code: NULL
last_error_message: NULL
last_attempt_at: "2025-01-29T10:05:00Z"
attempt_count: 2
```

---

## 14. RECONCILIATION QUERIES

### Sales → Event → Journal Entry

**Query Pattern:**
```sql
-- Find event for a specific sale
SELECT e.*
FROM retail_store_day_events e
WHERE e.business_id = {business_id}
  AND {sale_id} = ANY(e.event_payload->'source_refs'->'sales_ids')

-- Find journal entry for an event
SELECT je.*
FROM journal_entries je
WHERE je.id = (
  SELECT journal_entry_id
  FROM retail_store_day_events
  WHERE event_id = {event_id}
)

-- Complete reconciliation chain
SELECT 
  s.id as sale_id,
  s.amount as sale_amount,
  e.event_id,
  e.calendar_date,
  e.status,
  je.id as journal_entry_id,
  je.date as journal_date
FROM sales s
JOIN retail_store_day_events e ON (
  s.id = ANY(e.event_payload->'source_refs'->'sales_ids')
)
LEFT JOIN journal_entries je ON je.id = e.journal_entry_id
WHERE s.business_id = {business_id}
  AND s.store_id = {store_id}
  AND s.created_at::DATE = {date}
```

---

## 15. CONCURRENCY & PARALLEL PROCESSING

### Multi-Store Parallel Posting

**Scenario:**
- Store A and Store B both have events for same calendar date
- Both events are in `emitted` status
- Accounting processes both in parallel

**Safety Guarantees:**
- Different `idempotency_key` (includes `store_id`)
- Different `reference_id` (includes `store_id`)
- No shared locks or coordination needed
- Each store processes independently

**Example:**
```
Store A: idempotency_key = "business_123_store_A_2025-01-27"
Store B: idempotency_key = "business_123_store_B_2025-01-27"

Both can be posted simultaneously:
- No database contention (different keys)
- No shared state
- No blocking
```

### Concurrent Retry Safety

**Scenario:**
- Multiple `pending` events for same business
- Period unlocks
- Multiple retry processes attempt to post

**Safety Guarantees:**
- Layer 2 idempotency check prevents double posting
- First process to post succeeds
- Subsequent processes see existing journal entry (skip)
- No race conditions (database enforces uniqueness)

---

## CONCLUSION

This document defines the **canonical storage model** for Retail → Accounting daily events under **Option 3: Per Store × Per Day** posting granularity.

**Key Principles:**
- ✅ Single source of truth (`retail_store_day_events` table)
- ✅ Multi-layer idempotency (storage, accounting, event)
- ✅ Immutable events (payload never changes)
- ✅ Observable failures (error tracking)
- ✅ Multi-store safe (independent store events)
- ✅ Replay-safe (deterministic posting)

**Next Steps:**
- Create `retail_store_day_events` table (migration)
- Implement event emission logic (Retail side)
- Implement event consumption logic (Accounting side)
- Add retry mechanism for `pending` events
- Add monitoring and alerting

---

**End of Document**
