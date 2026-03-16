# Step 3D — Accounting Consumption Semantics
**Retail → Accounting (Store × Day Events)**

**Version:** 1.0  
**Date:** 2025-01-27  
**Status:** Binding Architecture Specification  
**Mode:** Semantics Only — ❌ NO CODE

---

## RESTRICTIONS (ABSOLUTE)

- ❌ Do NOT write or modify code
- ❌ Do NOT touch Retail, POS, cashier sessions, or UI
- ❌ Do NOT change VAT logic or tax math
- ❌ Do NOT assume single-store
- ❌ Do NOT re-aggregate sales
- ❌ Do NOT backfill legacy periods
- ❌ Do NOT mutate events
- ✅ Define **HOW Accounting consumes events safely and deterministically**

---

## 1. PURPOSE

Define the **exact rules** by which Accounting:

- Discovers Retail events
- Validates them
- Posts them to the ledger
- Enforces idempotency
- Handles failures and retries
- Guarantees ledger correctness

This step answers:

- *What does Accounting trust?*
- *What does Accounting validate?*
- *What does Accounting absolutely NOT do?*

---

## 2. ACCOUNTING ROLE (NON-NEGOTIABLE)

**Accounting is a CONSUMER, not a calculator.**

Accounting **MUST**:

- Trust event payloads as authoritative
- Copy amounts exactly as provided
- Enforce structural correctness only

Accounting **MUST NOT**:

- Recalculate VAT
- Recalculate revenue
- Recalculate COGS
- Inspect individual sales
- Query `sales` or `sale_items`
- Apply business logic beyond validation

**Single Source of Truth (Post-Cutover):**

```
retail_store_day_events
```

Accounting reads **only** from this table (and supporting reference data such as `chart_of_accounts`, `accounting_periods`) for retail posting. Sales are **never** used for posting.

---

## 3. EVENT DISCOVERY RULES

Accounting **MAY** consume events when:

- `status IN ('emitted', 'pending')`
- `business_id` matches current accounting scope
- Event `calendar_date` ≥ `first_event_date` (from Step 3C cutover + store timezone)
- Event is **NOT** already posted (idempotency check — see Section 5.4)

Accounting **MUST** ignore:

- Events with `status = 'posted'`
- Events with `status = 'failed'`
- Events with `status = 'posting'` (another process is actively posting)
- Events before the cutover eligibility window

**Status Transition (Step 3A):**

- When Accounting **begins** processing an event, it sets `status → 'posting'`
- This marks the event as in-flight and avoids duplicate processing
- On success: `status → 'posted'`; on failure: `status → 'failed'` or `'pending'`

---

## 4. CONSUMPTION ORDER (DETERMINISTIC)

Accounting **SHOULD** process events in this order:

1. `calendar_date` ASC
2. `store_id` ASC
3. `emitted_at` ASC

**Rationale:**

- Chronological ledger readability
- Deterministic replay
- No cross-store dependency

**Important:**

Ordering is for **readability only** — correctness does **NOT** depend on order. Multi-store parallelism is safe; ordering is a processing preference.

---

## 5. PRE-POSTING VALIDATION (MANDATORY)

Accounting **MUST** validate **ALL** of the following before posting. If any check fails, Accounting **MUST** set `status → 'failed'` (or `'pending'` for period lock only), record the error, and **STOP** processing that event.

### 5.1 Structural Validation

- Event `event_payload` exists and is valid JSON
- `event_type = 'RETAIL_STORE_DAY_CLOSED'`
- `event_version` is supported (e.g. `"1.0"`)
- Required fields present:
  - `business_id`
  - `store_id`
  - `calendar_date`
  - `totals` (with `gross_sales`, `net_revenue`, `cogs`, `inventory_delta`)
  - `tax_summary`
  - `vat_engine`

If validation fails:

- `status → 'failed'`
- Error code: `EVENT_INVALID`
- **STOP** processing

---

### 5.2 Cutover Validation

- Event `calendar_date` **MUST** be ≥ `first_event_date` for that store (Step 3C).
- Accounting **MUST** assume Retail already filtered pre-cutover sales (event eligibility filter).
- Accounting **MUST NOT** re-check individual sale timestamps or query `sales`.

If violated:

- `status → 'failed'`
- Error code: `CUTOVER_VIOLATION`
- **STOP** processing

---

### 5.3 Period Resolution

Accounting **MUST** resolve the accounting period using:

```
event.calendar_date
```

**Allowed period statuses:**

- `open`
- `soft_closed`

**Blocked:**

- `locked`

If period is **locked**:

- `status → 'pending'`
- Error code: `PERIOD_LOCKED`
- **STOP** (retry later when period is unlocked)

---

### 5.4 Idempotency Check (HARD GATE)

Accounting **MUST** check:

```
journal_entries
WHERE business_id = event.business_id
  AND reference_type = 'store_day'
  AND reference_id = '{store_id}_{calendar_date}'
```

If a matching journal entry **exists**:

- Treat as **SUCCESS** (already posted)
- Set event `status → 'posted'` (if not already)
- Set `journal_entry_id` to existing entry
- **STOP** (idempotent exit — do not create a new journal entry)

If **not** exists:

- Proceed to ledger posting (Section 6).

---

## 6. LEDGER POSTING SEMANTICS (STRICT)

Accounting **MUST** create **exactly ONE** journal entry per event (subject to idempotency).

### 6.1 Header Rules

- `date` = `event.calendar_date`
- `reference_type` = `'store_day'`
- `reference_id` = `'{store_id}_{calendar_date}'`
- `description` includes store name and date (e.g. from `source_refs.store_name`)

---

### 6.2 Line Construction (ORDERED)

Lines **MUST** be created in this order. Amounts and accounts are taken **verbatim** from the event payload; **no** recalculation.

1. **Cash / Bank (Debit)**  
   - Amount: `totals.gross_sales`  
   - Account: CASH control account (or equivalent per business COA)

2. **Revenue (Credit)**  
   - Amount: `totals.net_revenue`  
   - Account: Revenue account per business COA (e.g. `4000`)

3. **Tax Lines (Credit, one per `tax_summary` item)**  
   - Amount: `tax_summary[].tax_amount`  
   - Account: `tax_summary[].ledger_account_code` from event  
   - ❌ No recalculation  
   - ❌ No rate validation

4. **COGS (Debit)**  
   - Amount: `totals.cogs`  
   - Account: COGS account per business COA (e.g. `5000`)

5. **Inventory (Credit)**  
   - Amount: `totals.inventory_delta`  
   - Account: Inventory account per business COA (e.g. `1200`)

6. **Rounding Adjustment (when present in payload, per Step 2C)**  
   - If the event payload includes a rounding adjustment (e.g. `rounding_adjustment.amount`, `rounding_adjustment.ledger_account_code`, `rounding_adjustment.side`):  
     - Post **exactly** as specified; **last** line in the journal entry.  
   - If no rounding adjustment in payload:  
     - Do **not** add a rounding line.  
   - ❌ Accounting **MUST NOT** compute rounding; it **MUST** use only what the event provides.

---

### 6.3 Balance Invariant (MUST HOLD)

```
SUM(debits) = SUM(credits)
```

If **not** satisfied after constructing all lines:

- **Do not** create the journal entry
- `status → 'failed'`
- Error code: `UNBALANCED_EVENT`
- **STOP**

**Note:** Per Step 2C, Retail produces balanced events (including explicit rounding when needed). If the invariant fails, the event is invalid or corrupted; Accounting must not post.

---

## 7. VAT HANDLING (CRITICAL)

Accounting **MUST**:

- Copy VAT amounts **verbatim** from `tax_summary`
- Use tax accounts **provided by the event** (`ledger_account_code`)
- Preserve tax version metadata (`vat_engine`, `ghana_tax_version`)
- **Never** recompute `base × rate`

Accounting **MUST NOT**:

- Recalculate VAT
- Apply current tax config
- Merge or split tax lines
- Apply COVID levy (must not exist in payload)

If **COVID** (or other invalid) tax code is detected in `tax_summary`:

- `status → 'failed'`
- Error code: `INVALID_TAX_CODE`
- **STOP**

---

## 8. POST-SUCCESS COMMIT RULES

On **successful** posting:

1. Create journal entry (atomic with line inserts).
2. Update event row:
   - `status → 'posted'`
   - `posted_at` = `NOW()`
   - `journal_entry_id` = created journal entry id
   - Clear `last_error_code`, `last_error_message` (if any)
3. Event becomes **immutable** for posting purposes (no further updates to payload or status except audit metadata).

---

## 9. FAILURE HANDLING (NO ROLLBACK)

Failures **NEVER** affect:

- Sales
- Event payload (immutable)
- Other stores
- Other dates

**Failure outcomes:**

| Error Type | Status | Retry |
|------------|--------|-------|
| `PERIOD_LOCKED` | `pending` | Automatic (when period unlocks) |
| `ACCOUNT_MISSING` | `failed` | Manual (create account, then retry) |
| `ROUNDING_EXCEEDS_TOLERANCE` | `failed` | Investigate / re-emit |
| `EVENT_INVALID` | `failed` | Re-emit (fix payload) |
| `UNBALANCED_EVENT` | `failed` | Investigate |
| `CUTOVER_VIOLATION` | `failed` | Investigate |
| `INVALID_TAX_CODE` | `failed` | Investigate / re-emit |

Events are **NEVER** deleted or mutated (payload and identity unchanged). Only status and failure metadata may be updated by Accounting.

---

## 10. RETRY SEMANTICS

Retry is allowed **ONLY** when:

- `status = 'pending'` (e.g. `PERIOD_LOCKED`), **or**
- `status = 'failed'` and root cause is fixed (e.g. account created)

Retry **MUST**:

- Re-use the **same** event payload (no modification)
- Produce the **same** journal entry (deterministic)
- Re-run idempotency check (Section 5.4) before posting
- Be safe to run concurrently (e.g. multiple workers; uniqueness enforced by `reference_type` + `reference_id`)

---

## 11. MULTI-STORE GUARANTEES

- Each **store × day** is **isolated** (independent event, independent journal entry).
- **No** shared state across stores.
- **Parallel** posting is allowed (Store A and Store B can be processed concurrently).
- Store A failure **NEVER** blocks Store B.

---

## 12. NON-GOALS (EXPLICIT)

Accounting does **NOT**:

- Query `sales` or `sale_items`
- Rebuild or re-aggregate events from sales
- Backfill history or legacy periods
- Adjust past days
- Auto-correct or infer missing events
- Recalculate any amounts from source data

---

## 13. ACCEPTANCE CRITERIA — STEP 3D

Step 3D is complete only if:

- ✅ Accounting posts **ONLY** from events (`retail_store_day_events`).
- ✅ Ledger entries are **1-to-1** with events (one journal entry per store-day event).
- ✅ Idempotency is enforced (no double posting).
- ✅ VAT is **copied**, never recalculated.
- ✅ Period locks do **not** block Retail (event marked `pending`, retry later).
- ✅ Multi-store posting is **safe** (isolated, parallel-friendly).
- ✅ Failures are **isolated** and **observable** (status, error codes, no cascading).

---

**End of Step 3D**
