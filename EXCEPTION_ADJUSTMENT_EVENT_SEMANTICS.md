# Step 3E — Exception & Adjustment Event Semantics
**Retail → Accounting (Post–Store-Day Exceptions)**

**Version:** 1.0  
**Date:** 2025-01-27  
**Status:** Binding Architecture Specification  
**Mode:** Semantics Only — ❌ NO CODE

---

## RESTRICTIONS (ABSOLUTE)

- ❌ Do NOT write or modify code
- ❌ Do NOT change VAT rates, VAT logic, or tax engines
- ❌ Do NOT mutate or re-emit past store-day events
- ❌ Do NOT reopen closed store-days
- ❌ Do NOT recalculate historical revenue, VAT, or COGS
- ❌ Do NOT read directly from `sales` in Accounting
- ❌ Do NOT weaken double-entry or idempotency rules
- ❌ Do NOT introduce silent corrections

---

## 1. PURPOSE

Define how **post–store-day exceptions** are handled via **additive adjustment events** so that:

- Store-day events (Steps 2B–3D) remain **immutable**
- Cutover model (Step 3C) remains **timestamp-based and append-only**
- Accounting remains a **pure consumer** (events only, never sales)
- Ledger **always balances**
- VAT reports remain sourced from **`sales.tax_lines`**; ledger uses **events only**
- Multi-store isolation is preserved
- All corrections are **explicit, additive, and auditable**

This step answers:

- *Which exception cases require new events?*
- *How are adjustment events identified, scoped, and posted?*
- *How is VAT integrity preserved when correcting or reversing?*
- *How do accountants trace and reconcile adjustments?*

---

## 2. CORE PRINCIPLES (NON-NEGOTIABLE)

### Additive-Only

- Every exception is handled by **emitting a new event**, never by changing a past event.
- Past store-day events are **never** mutated, re-aggregated, or re-emitted.

### Append-Only Ledger

- Adjustments produce **new journal entries**.
- Historical journal entries are **never** modified or deleted.

### No Recalculation

- Adjustment payloads carry **precomputed amounts** (from Retail).
- Accounting **copies** amounts; it does **not** recalculate revenue, VAT, or COGS.

### Immutability

- Adjustment events, once emitted, are **immutable** (same as store-day events).
- Corrections to adjustments require **further** adjustment events, not edits.

---

## 3. ADJUSTMENT EVENT TYPES (CANONICAL LIST)

The following exception cases **MUST** be handled by **new additive events** only. This list is **exhaustive** for Step 3E.

| Event Type | Description | When Emitted | Reference to Original |
|------------|-------------|--------------|------------------------|
| **`RETAIL_LATE_SALE`** | One or more sales eligible for store-day D arrived **after** the store-day event for D was emitted (Step 3B). | When late sale(s) are identified and aggregated for a store-day. | Original store-day `(store_id, calendar_date)`. |
| **`RETAIL_STORE_DAY_REFUNDED`** | Refunds (full or partial) for sales originally posted via store-day or legacy. | Per store per **refund date** (store-local calendar date of refund). | Original store-day(s) or sale(s) as specified in payload. |
| **`RETAIL_STORE_DAY_VOIDED`** | Void(s) of sales **after** they were posted (legacy or event). | Per store per **void date** (store-local calendar date of void). | Original store-day(s) or sale(s) as specified in payload. |
| **`RETAIL_PRICE_CORRECTION`** | Post-sale price change (e.g. manual correction, discount applied late). | When correction is applied. | Original sale and, if applicable, original store-day. |
| **`RETAIL_TAX_CORRECTION`** | Tax correction **without** altering original `sales.tax_lines`. Ledger-only delta. | When correction is approved. | Original sale and, if applicable, original store-day. |

**Rules:**

- Each type is **explicit** and **additive**.
- Each type **never** overwrites history.
- **No** other exception types are defined in this step; future types require a contract extension.

---

## 4. ADJUSTMENT EVENT CONTRACT

### 4.1 Common Identity Fields (All Adjustment Types)

Every adjustment event **MUST** include:

- **`event_type`**: One of `RETAIL_LATE_SALE` | `RETAIL_STORE_DAY_REFUNDED` | `RETAIL_STORE_DAY_VOIDED` | `RETAIL_PRICE_CORRECTION` | `RETAIL_TAX_CORRECTION`.
- **`event_version`**: Contract version (e.g. `"1.0"`).
- **`event_id`**: Unique UUID for this event instance.
- **`emitted_at`**: ISO8601 timestamp when event was created.
- **`business_id`**: UUID of the business.
- **`store_id`**: UUID of the store.
- **`calendar_date`**: **Adjustment date** (store-local YYYY-MM-DD). See Section 7 (Temporal Rules).
- **`store_timezone`**: IANA timezone (e.g. `"Africa/Accra"`).
- **`currency`**: ISO4217 code (e.g. `"GHS"`).

### 4.2 Idempotency Keys (Per Type)

Idempotency keys **MUST** be unique per event and **MUST** be used to prevent duplicate posting.

| Event Type | Idempotency Key | Uniqueness |
|------------|-----------------|------------|
| **`RETAIL_LATE_SALE`** | `{business_id}_{store_id}_{original_calendar_date}_LATE_SALE_{batch_id}` | One event per “batch” of late sales for that store-day. `batch_id` is a **deterministic** identifier (e.g. hash of sorted `sales_ids`) so that replay yields the same key. |
| **`RETAIL_STORE_DAY_REFUNDED`** | `{business_id}_{store_id}_{refund_calendar_date}_REFUNDED` | One event per store per refund-date. |
| **`RETAIL_STORE_DAY_VOIDED`** | `{business_id}_{store_id}_{void_calendar_date}_VOIDED` | One event per store per void-date. |
| **`RETAIL_PRICE_CORRECTION`** | `{business_id}_{store_id}_PRICE_CORRECTION_{correction_id}` | One event per correction. `correction_id` is a unique, immutable identifier. |
| **`RETAIL_TAX_CORRECTION`** | `{business_id}_{store_id}_TAX_CORRECTION_{correction_id}` | One event per correction. `correction_id` is a unique, immutable identifier. |

### 4.3 Reference to Original Store-Day or Sale

Every adjustment **MUST** reference the original context:

- **`original_store_day`**: `{ store_id, calendar_date }` — the store-day (or store-days) to which the adjustment relates.
- **`source_refs`**: At least one of:
  - **`sales_ids`**: UUIDs of affected sales (when applicable).
  - **`refund_ids`** / **`void_ids`** / **`correction_id`**: When the adjustment is keyed by such identifiers.

**Rule:** Accounting uses these only for **audit and traceability**. It does **not** read from `sales` or `sale_items`.

### 4.4 Amount and Sign Conventions

- **Store-day (Step 2B):** Positive = net inflow (sales). Debits: CASH, COGS; Credits: Revenue, Tax, Inventory.
- **Refunds / Voids:** **Negative** amounts = reversals. Same accounts as store-day, signs reversed.
- **Late sale:** **Positive** amounts = additional sales. Same structure as store-day.
- **Price correction:** **Delta** amounts. Positive = additional charge; negative = refund/credit. Same account structure as store-day, applied to deltas.
- **Tax correction:** **Delta** amounts to tax (and any linked revenue/CASH) only. Signs as appropriate for the correction.

**VAT:** All VAT amounts in adjustment payloads are **copied** from Retail (refund calc, correction calc). **Never** recalculated by Accounting.

### 4.5 Payload Snippets (Semantic Only)

**`RETAIL_LATE_SALE`:**

- `totals`: `{ gross_sales, net_revenue, cogs, inventory_delta }` (all ≥ 0).
- `tax_summary`: Same structure as Step 2B (per tax code).
- `vat_engine`: As Step 2B.
- `original_store_day`: `{ store_id, calendar_date }`.
- `source_refs.sales_ids`: Late sale UUIDs.

**`RETAIL_STORE_DAY_REFUNDED`** / **`RETAIL_STORE_DAY_VOIDED`:**

- `totals`: `{ gross_sales, net_revenue, cogs, inventory_delta }` (all ≤ 0, reversals).
- `tax_summary`: Reversal amounts (negative or explicitly signed as reversals), same structure.
- `vat_engine`: As Step 2B.
- `original_store_day` and/or `source_refs` as above.

**`RETAIL_PRICE_CORRECTION`** / **`RETAIL_TAX_CORRECTION`:**

- `totals` and/or `tax_summary`: **Deltas** only (signed).
- `original_store_day`, `source_refs`, `vat_engine` as applicable.

**Rounding:** When aggregation of multiple items (e.g. multiple refunds) introduces rounding, the payload **MAY** include a **`rounding_adjustment`** (amount, account code, side) per Step 2C. Accounting posts it **only** when present; it **MUST NOT** compute rounding.

---

## 5. LEDGER POSTING SEMANTICS

### 5.1 One Journal Entry per Adjustment Event

- Each adjustment event produces **exactly one** journal entry (subject to idempotency).
- **`reference_type`** and **`reference_id`** **MUST** identify the adjustment so that duplicate posting is prevented and audit trail is clear.

**Mapping (event_type → reference_type):**

| Event Type | reference_type | reference_id |
|------------|----------------|--------------|
| `RETAIL_LATE_SALE` | `late_sale` | idempotency_key |
| `RETAIL_STORE_DAY_REFUNDED` | `store_day_refunded` | idempotency_key |
| `RETAIL_STORE_DAY_VOIDED` | `store_day_voided` | idempotency_key |
| `RETAIL_PRICE_CORRECTION` | `price_correction` | idempotency_key |
| `RETAIL_TAX_CORRECTION` | `tax_correction` | idempotency_key |

Accounting **MUST** check for an existing JE with this `(reference_type, reference_id)` before posting (Section 6.2).

### 5.2 Accounts Affected

Same account **types** as store-day (Step 2B, 2C):

- **CASH** (control account)
- **Revenue** (e.g. 4000)
- **Tax payables** (from `tax_summary[].ledger_account_code`)
- **COGS** (e.g. 5000)
- **Inventory** (e.g. 1200)
- **Rounding** (e.g. 3999), only when present in payload

Account resolution is per business COA (and control mapping for CASH), as in Step 3D.

### 5.3 Debit/Credit Direction Rules

| Event Type | CASH | Revenue | Tax | COGS | Inventory |
|------------|------|---------|-----|------|-----------|
| **`RETAIL_LATE_SALE`** | Debit | Credit | Credit | Debit | Credit |
| **`RETAIL_STORE_DAY_REFUNDED`** | Credit | Debit | Debit | Credit | Debit |
| **`RETAIL_STORE_DAY_VOIDED`** | Credit | Debit | Debit | Credit | Debit |
| **`RETAIL_PRICE_CORRECTION`** (positive delta) | Debit | Credit | Credit | Debit | Credit |
| **`RETAIL_PRICE_CORRECTION`** (negative delta) | Credit | Debit | Debit | Credit | Debit |
| **`RETAIL_TAX_CORRECTION`** | As per payload (delta) | As per payload | As per payload | As per payload | As per payload |

Amounts are taken **verbatim** from the event payload. **No** recalculation.

### 5.4 COGS and Inventory Reversals

- For **refunds** and **voids**: COGS and inventory are **reversed** (Credit COGS, Debit Inventory) by the amounts in `totals.cogs` and `totals.inventory_delta` (typically negative or expressed as reversals).
- For **late sales**: COGS and inventory move same direction as store-day (Debit COGS, Credit Inventory).
- For **price** / **tax** corrections: Apply deltas as specified in payload; preserve double-entry.

### 5.5 Rounding

- If **`rounding_adjustment`** is present in the payload: post it as the **last** line, per Step 2C.
- If **not** present: **do not** add a rounding line. Accounting **MUST NOT** compute rounding.

### 5.6 Balance Invariant

For every adjustment journal entry:

```
SUM(debits) = SUM(credits)
```

If **not** satisfied:

- **Do not** create the journal entry.
- Mark event **`failed`**, error code **`UNBALANCED_EVENT`**.
- **STOP**.

---

## 6. IDEMPOTENCY & REPLAY

### 6.1 Idempotency Keys

- Idempotency keys are defined in Section 4.2.
- **Storage-level:** Enforce **UNIQUE** on the natural key (e.g. `idempotency_key` or equivalent). Emitting the same key twice **MUST** yield the same stored event (no duplicate row).

### 6.2 Duplicate Posting Prevention

- **Accounting-level:** Before posting, check for an existing journal entry **within business scope** (`business_id = event.business_id`) with `reference_type` and `reference_id` as in Section 5.1 (mapping from event type).
- If such a JE **exists**: treat as **success**, set event `status → 'posted'`, link `journal_entry_id`, **STOP** (idempotent exit).
- If **not**: proceed to post.

### 6.3 Retries and Replay

- Retry uses the **same** event payload (immutable).
- Replay **MUST** produce the **same** journal entry (deterministic).
- Same idempotency key → at most one JE. Replay is **safe**.

---

## 7. TEMPORAL RULES

### 7.1 Adjustment Calendar Date

- **`RETAIL_LATE_SALE`:** `calendar_date` = **original** store-day date (the day the late sale belongs to).
- **`RETAIL_STORE_DAY_REFUNDED`:** `calendar_date` = **refund date** (store-local).
- **`RETAIL_STORE_DAY_VOIDED`:** `calendar_date` = **void date** (store-local).
- **`RETAIL_PRICE_CORRECTION`** / **`RETAIL_TAX_CORRECTION`:** `calendar_date` = **correction date** (store-local).

### 7.2 Accounting Period

- The journal entry **posting date** = adjustment event **`calendar_date`**.
- The accounting period is resolved by **`calendar_date`** (same as Step 3D).

### 7.3 Period Status Rules

- **`open`** or **`soft_closed`**: Posting **allowed**.
- **`locked`**: Posting **blocked**.
  - Set event **`status → 'pending'`**, error code **`PERIOD_LOCKED`**.
  - **Do not** create a journal entry.
  - Retry when period is unlocked.

### 7.4 Late Adjustments and Closed Periods

- Adjustments that fall in **closed** (locked) periods **MUST** be **blocked** (same as above).
- **No** reopening of periods. **No** posting into locked periods.
- Resolution: Unlock the period (via existing period-management process) **or** assign the adjustment to a later period only if the business explicitly changes **`calendar_date`** (future contract). Step 3E does **not** define period unlock or date changes.

---

## 8. VAT INTEGRITY RULES

### 8.1 Original VAT Records Are Never Mutated

- **`sales.tax_lines`** (and any original store-day event payload) are **never** modified for adjustments.
- VAT **reports** continue to use **`sales.tax_lines`** as source of truth.

### 8.2 Adjustments Do Not Rewrite VAT History

- Adjustments add **new** ledger entries only.
- They **reverse** or **extend** VAT in the ledger via new JEs, not by changing past data.

### 8.3 VAT Impact Is Additive and Traceable

- Every VAT-related adjustment line can be traced to an **adjustment event** (and thus to **`original_store_day`** / **`source_refs`**).
- Net VAT in the ledger = store-day VAT + sum of adjustment VAT deltas.

### 8.4 VAT Reports vs Ledger

- **VAT reports:** Sourced from **`sales.tax_lines`** only. No change.
- **Ledger:** Sourced from **store-day + adjustment events** only.
- **Reconciliation:** Differences (e.g. refunds, voids, corrections) are **explainable** by adjustment events. No silent or implicit corrections.

---

## 9. AUDIT & ACCOUNTANT EXPECTATIONS

### 9.1 Traceability

An accountant **MUST** be able to:

- Trace **original sale → store-day event → adjustment event(s)** via `source_refs` and `original_store_day`.
- See **why** an adjustment exists (event type, reference to refund/void/correction/late sale).

### 9.2 Reconciliation

- Reconcile **revenue**, **VAT**, and **inventory** after adjustments by:
  - Store-day events (base),
  - Adjustment events (additive),
  - Journal entries (reference_type / reference_id).
- Close periods **without** manual intervention **except** where period is locked (adjustment remains **pending** until unlock).

### 9.3 No Silent Corrections

- Every change to the ledger is **explicit** (store-day or adjustment event).
- No implicit overwrites, no undiscoverable fixes.

---

## 10. FAILURE MODES

### 10.1 Retryable vs Terminal

| Scenario | Status | Retry | Error Code |
|----------|--------|-------|------------|
| Period **locked** | `pending` | Automatic when period unlocks | `PERIOD_LOCKED` |
| **Account missing** (e.g. rounding 3999) | `failed` | Manual (create account, then retry) | `ACCOUNT_MISSING` |
| **Event invalid** (structure, required fields) | `failed` | Re-emit after fix | `EVENT_INVALID` |
| **Unbalanced** JE | `failed` | Investigate / re-emit | `UNBALANCED_EVENT` |
| **Rounding** exceeds tolerance (if validated) | `failed` | Investigate / re-emit | `ROUNDING_EXCEEDS_TOLERANCE` |
| **Cutover** violation (e.g. pre-cutover reference) | `failed` | Investigate | `CUTOVER_VIOLATION` |
| **Invalid tax** code (e.g. COVID) | `failed` | Investigate / re-emit | `INVALID_TAX_CODE` |

### 10.2 Status Transitions

- Same as Step 3A: **`emitted` → `posting` → `posted` | `pending` | `failed`**; **`pending` → `posting` → `posted` | `failed`**.
- **`posted`** and **`failed`** are **terminal** (no further transitions for posting).
- **Payload** remains **immutable** in all states.

### 10.3 Immutability Guarantees

- Events are **never** deleted or mutated (payload and identity).
- Only **status** and failure metadata (e.g. `last_error_code`, `last_error_message`, `last_attempt_at`, `attempt_count`) may be updated by Accounting.

---

## 11. INVARIANTS (SUMMARY)

- **Additive-only:** All exceptions handled by new events; no mutation of past events.
- **Append-only ledger:** New JEs only; no rewrites.
- **Balance:** `SUM(debits) = SUM(credits)` for every adjustment JE.
- **VAT:** Original records unchanged; adjustment VAT additive and traceable.
- **Idempotency:** One event per idempotency key; at most one JE per adjustment.
- **Multi-store:** Adjustments are per-store; no cross-store coupling.

---

## 12. SUCCESS CRITERIA — STEP 3E

Step 3E is complete only if:

- ✅ All late data (late sales, refunds, voids, corrections) is handled **without** history mutation.
- ✅ Ledger **always** balances.
- ✅ VAT integrity is preserved (original records untouched; adjustments additive).
- ✅ Replay is **safe** (deterministic, idempotent).
- ✅ Accountants can **audit** and reconcile without confusion.
- ✅ **No** silent or implicit corrections exist.

---

## 13. NON-GOALS (EXPLICIT)

Step 3E does **not**:

- ❌ Define UI, migrations, or background jobs.
- ❌ Specify implementation details.
- ❌ Introduce speculative features.
- ❌ Modify Steps 2B–3D.

---

**End of Step 3E**
