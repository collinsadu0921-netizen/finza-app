# Migration & Cutover Strategy
**Retail → Accounting (Per Store × Per Day)**

**Version:** 1.0  
**Date:** 2025-01-27  
**Status:** Binding Architecture Specification  
**Mode:** Semantics & Sequencing Only (No Code)

---

## RESTRICTIONS (MANDATORY)

- ❌ Do NOT write or modify code
- ❌ Do NOT alter VAT logic or tax math
- ❌ Do NOT rewrite historical journal entries
- ❌ Do NOT assume single-store
- ❌ Do NOT pause POS or sales intake
- ❌ Do NOT allow double-posting (ever)
- ✅ Define **how we transition safely** from legacy posting to event-based posting

---

## 1. PURPOSE

Define a **safe, auditable cutover** from:

- **Legacy model:** Per-sale / runtime posting  
  *(Current: `post_sale_to_ledger()` called from `app/api/sales/create/route.ts` immediately after each sale)*

to

- **Target model:** Per Store × Per Day event posting  
  *(Events in `retail_store_day_events`, aggregated by store-day, consumed by Accounting)*

…without:

- Breaking the ledger
- Duplicating revenue
- Losing VAT integrity
- Blocking live retail operations

This step answers:

- *How do we switch without re-posting history?*
- *How do we prevent double posting during transition?*
- *What is the precise “line in the sand”?*

---

## 2. CORE MIGRATION PRINCIPLE (NON-NEGOTIABLE)

### Accounting Is Append-Only

- Past journal entries are **never rewritten**
- Past sales are **never re-posted**
- Migration affects **only future posting behavior**

> **Migration is a change in posting mechanism, not a re-accounting of history.**

**Implications:**

- No backfill of pre-cutover sales into events
- No migration of legacy journal entries
- No retroactive VAT correction
- Legacy ledger remains as-is; event-based ledger appends from cutover onward

---

## 3. THE CUTOFF LINE (AUTHORITATIVE)

### Cutover Timestamp (Business-Scoped)

Define a single, immutable timestamp:

```
retail_event_cutover_at
```

**Semantics:**

- A **UTC** timestamp stored at **business level** (e.g. `businesses.retail_event_cutover_at` or dedicated config)
- Represents the moment when:
  - **Legacy posting STOPS**
  - **Event-based posting STARTS**

**Rule:**

```
sales.created_at < retail_event_cutover_at  → legacy accounting path
sales.created_at ≥ retail_event_cutover_at  → event-based accounting path
```

**Properties:**

- Set **once** per business
- **Never modified** after cutover
- Same value for **all stores** under the business
- Auditable (who set it, when, and where it is stored)

**Rationale:**

- One clean boundary per business
- No overlap between legacy and event posting
- No ambiguity about which model applies
- No per-store drift (single cutover for entire business)

---

## 4. DUAL-WORLD MODEL (TRANSITION PHASE)

After cutover, the system operates in **two worlds**:

### World A — Legacy World (Frozen)

- Applies to all sales **before** `retail_event_cutover_at`
- Characteristics:
  - Already posted (or will be posted) via legacy logic
  - Journal entries exist with `reference_type = 'sale'`, `reference_id = sale.id`
  - No **new** legacy postings allowed after cutover

**Strict Rule:**

- ❌ Legacy posting logic **must refuse** any sale with `created_at ≥ retail_event_cutover_at`
- If invoked for such a sale → **hard-fail** with `LEGACY_POSTING_DISABLED_AFTER_CUTOVER`

---

### World B — Event World (Active)

- Applies to all sales **on or after** `retail_event_cutover_at`
- Characteristics:
  - No per-sale posting
  - Sales are aggregated into Store × Day events
  - Posted **only** via `retail_store_day_events` consumption

**Strict Rule:**

- ❌ Event aggregation **must refuse** any sale with `created_at < retail_event_cutover_at`
- Eligibility filter (Section 5) enforces this

---

## 5. EVENT ELIGIBILITY FILTER (CRITICAL)

When emitting an event for `{store_id, calendar_date = D}`:

Aggregation **MUST include only sales** that satisfy **all** of:

```
sales.store_id = {store_id}
AND sales.payment_status = 'paid'
AND (sales.is_voided = false OR sales.is_voided IS NULL)
AND (sales.is_refund = false OR sales.is_refund IS NULL)
AND sales.created_at ≥ retail_event_cutover_at
AND DATE(sales.created_at AT TIME ZONE store_timezone) = D
```

**Guarantees:**

- No pre-cutover sales leak into events
- No double posting (legacy already posted those sales)
- Clean historical separation between legacy and event worlds

**Cutover Filter Is Mandatory:**

- Even if other criteria match, **exclude** any sale with `created_at < retail_event_cutover_at`
- This is **non-negotiable**

---

## 6. FIRST EVENT DAY (PER STORE)

For each store:

- Let `retail_event_cutover_at = T` (UTC)
- Resolve store-local date:

```
first_event_date = DATE(T AT TIME ZONE store_timezone)
```

**Rules:**

- Events are emitted **starting from** `first_event_date`
- Calendar dates **before** `first_event_date` are legacy-only (no events)
- Calendar dates **on or after** `first_event_date` are event-based

**Example:**

- `retail_event_cutover_at = 2025-02-01 15:30:00 UTC`
- Store timezone: `Africa/Accra` (UTC+0)
- Store-local time at cutover: `2025-02-01 15:30:00`
- `first_event_date = 2025-02-01`

→ First event emitted for **2025-02-01**, and only after the store-day closes (i.e. after `2025-02-02 00:00:00` local, per Step 3B).

**Example (Different Timezone):**

- `retail_event_cutover_at = 2025-02-01 15:30:00 UTC`
- Store timezone: `America/New_York` (UTC-5)
- Store-local time at cutover: `2025-02-01 10:30:00`
- `first_event_date = 2025-02-01`

→ First event for **2025-02-01**; sales from 10:30 onward that day are event-eligible.

---

## 7. LEGACY POSTING SHUTDOWN (HARD REQUIREMENT)

After cutover:

Any attempt to:

- Call legacy posting functions (e.g. `post_sale_to_ledger`) for a sale with `created_at ≥ retail_event_cutover_at`
- Auto-post per sale from POS/sales-create path for such sales
- Insert journal entries from legacy retail paths for post-cutover sales

**MUST:**

- **Hard-fail** with explicit error:

```
LEGACY_POSTING_DISABLED_AFTER_CUTOVER
```

**Rationale:**

- Silent success = risk of silent double posting
- Hard failure exposes bugs early
- Forces all new accounting through the event model

**Implementation Note (Semantics Only):**

- Call sites (e.g. sales create API) must **check** `retail_event_cutover_at` before invoking legacy posting
- If `sale.created_at ≥ retail_event_cutover_at` → do **not** call `post_sale_to_ledger`; raise `LEGACY_POSTING_DISABLED_AFTER_CUTOVER` instead
- Alternatively, `post_sale_to_ledger` (or a guard layer) may enforce this and raise the same error

---

## 8. ACCOUNTING CONSUMER BEHAVIOR POST-CUTOVER

Accounting subsystem **MUST**:

1. **Ignore sales for posting**
   - No direct reads from `sales` for **posting** purposes
   - Sales are informational / operational only for Accounting

2. **Consume only events**
   - Source of truth for retail ledger = `retail_store_day_events`
   - One event → one journal entry (Step 2B, 2C)
   - Posting logic reads **only** from events

3. **Enforce idempotency**
   - As defined in Step 3A
   - Journal entry reference:
     - `reference_type = 'store_day'`
     - `reference_id = '{store_id}_{calendar_date}'`
   - Re-posting same event must be a no-op (idempotent)

---

## 9. INVARIANTS DURING & AFTER MIGRATION

The following must **always** be true:

### Ledger Invariants

- Every retail-origin journal entry is traceable to:
  - **Either** a legacy sale (`reference_type = 'sale'`, `reference_id = sale.id`),
  - **Or** exactly **one** store-day event (`reference_type = 'store_day'`, `reference_id = '{store_id}_{calendar_date}'`).
- **Never both** for the same economic event.

### Revenue Invariants

- Gross revenue in the ledger =
  - Sum(legacy posted sales **before** cutover)
  - **+** Sum(event totals **on or after** cutover, from `retail_store_day_events`).
- No gap, no double-count.

### VAT Invariants

- VAT logic **unchanged** (no new formulas, no recalculation).
- VAT source:
  - **Legacy:** per-sale `tax_lines` (already posted).
  - **Event:** aggregated `tax_summary` from events (Step 2B, 2C).
- No recomputation of historical VAT.

---

## 10. FAILURE SCENARIOS & SAFETY

### Scenario 1: Event Emission Lags Cutover

- Cutover happens.
- Event emission is delayed (hours or days).

**Result:**

- Post-cutover sales accumulate (unposted to ledger).
- No ledger impact until events are emitted and consumed.
- POS and sales intake **unaffected**.

**Resolution:**

- Emit events later (per Step 3B).
- Posting catches up when events are processed.
- No data loss; no double posting.

---

### Scenario 2: Partial Day at Cutover

- Cutover occurs mid-day (e.g. `2025-02-01 15:30 UTC`).
- Store has sales both before and after cutover on the same calendar date.

**Result:**

- Sales **before** cutover → legacy path (already or to be posted per-sale).
- Sales **on or after** cutover → **included in event** for that calendar date.
- Same calendar date may have:
  - Legacy journal entries (pre-cutover sales),
  - One store-day event (post-cutover sales for that day).

**This is ACCEPTABLE and CORRECT.**

**Why safe:**

- Cutover is **timestamp-based**, not date-based.
- No overlap at **transaction** level: each sale is either legacy or event, never both.
- Event eligibility explicitly excludes pre-cutover sales.

---

### Scenario 3: Accidental Double Attempt

- Bug attempts to:
  - Legacy-post a **post-cutover** sale, or
  - Include **pre-cutover** sales in an event.

**Defense layers:**

- **Eligibility filters:** events only include `created_at ≥ retail_event_cutover_at`.
- **Hard failures:** legacy posting rejects post-cutover sales with `LEGACY_POSTING_DISABLED_AFTER_CUTOVER`.
- **Idempotency checks:** duplicate event/journal posting prevented (Step 3A).
- **Unique constraints:** e.g. `(business_id, store_id, calendar_date)` for events; `reference_type` + `reference_id` for journal entries.

**Outcome:**

- **Failure**, not silent corruption.
- Errors are observable and fixable.

---

### Scenario 4: Cutover Not Yet Set

- Business has no `retail_event_cutover_at` (e.g. not yet migrated).

**Result:**

- Legacy posting remains in effect for **all** sales.
- No events emitted; no event-based posting.
- Migration is opt-in per business via setting cutover.

---

## 11. AUDITABILITY GUARANTEES

An auditor can **always** determine:

- **Which model** applied to which sale:
  - `created_at < retail_event_cutover_at` → legacy.
  - `created_at ≥ retail_event_cutover_at` → event-based.
- **Exact cutover moment** (from `retail_event_cutover_at`).
- **Why** a journal entry exists:
  - Legacy: `reference_type = 'sale'`, `reference_id = sale.id`.
  - Event: `reference_type = 'store_day'`, `reference_id = '{store_id}_{calendar_date}'`.
- **Whether** a sale was:
  - Legacy-posted,
  - Event-posted (via store-day event),
  - Or not yet posted (e.g. event emission lag).

No ambiguity, no inference.

---

## 12. CUTOVER SETTING (SEQUENCING)

### When Is Cutover Set?

- Cutover is set **once** per business, during migration execution.
- It is a **one-way switch**: after it is set, it is **not** changed.

### Pre-Conditions (Semantics)

Before setting `retail_event_cutover_at`:

- Event storage exists (`retail_store_day_events`).
- Emission and consumption logic exists and is deployable.
- Legacy posting can be guarded (check cutover before calling `post_sale_to_ledger` or equivalent).

### Post-Conditions

- All sales with `created_at ≥ retail_event_cutover_at` use **only** the event path.
- All such sales are **excluded** from legacy posting.

---

## 13. ACCEPTANCE CRITERIA — STEP 3C

Step 3C is complete only if:

- ✅ Single immutable cutover timestamp (`retail_event_cutover_at`) exists per business.
- ✅ Legacy posting is **hard-disabled** for sales with `created_at ≥ retail_event_cutover_at`.
- ✅ Events include **only** sales with `created_at ≥ retail_event_cutover_at` (and other eligibility rules).
- ✅ **No** historical rewriting: no backfill, no re-posting of past sales.
- ✅ Partial-day cutover is handled correctly (pre-cutover → legacy, post-cutover → event for same day).
- ✅ Multi-store behavior remains independent (each store’s `first_event_date` from same cutover + store timezone).
- ✅ Ledger remains **append-only** and **auditable**.

---

## 14. WHAT THIS STEP DOES **NOT** DO

- ❌ No data backfill.
- ❌ No migration of old sales into events.
- ❌ No retroactive VAT correction.
- ❌ No UI changes.
- ❌ No retry logic design.
- ❌ No adjustment/refund handling (future step).
- ❌ No changes to VAT logic or tax math.
- ❌ No pausing of POS or sales intake.

---

## 15. SUMMARY

| Aspect | Legacy (World A) | Event (World B) |
|--------|------------------|------------------|
| **Sales** | `created_at < retail_event_cutover_at` | `created_at ≥ retail_event_cutover_at` |
| **Posting** | Per sale, at sale creation | Per store-day, from events |
| **Source** | `sales` → `post_sale_to_ledger` | `retail_store_day_events` → Accounting |
| **Journal ref** | `reference_type = 'sale'` | `reference_type = 'store_day'` |
| **After cutover** | Frozen (no new legacy posts) | Active |

**Cutover rule:**

```
sales.created_at < retail_event_cutover_at  → legacy path
sales.created_at ≥ retail_event_cutover_at  → event path
```

**Eligibility filter (events):**

```
... AND sales.created_at ≥ retail_event_cutover_at
AND DATE(sales.created_at AT TIME ZONE store_timezone) = D
```

---

**End of Document**
