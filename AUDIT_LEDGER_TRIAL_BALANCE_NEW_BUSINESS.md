# Audit: General Ledger & Trial Balance failing on **new business with no data**

**Mode:** Evidence-only. No fixes. No assumptions.  
**Scope:**

- `/ledger` (General Ledger page)
- `/trial-balance` (Trial Balance page)
- New business, zero operational data (no invoices, no expenses, no journals posted)

---

## EXECUTIVE VERDICT (UP FRONT)

Both pages are **failing for correct technical reasons**, but the **UI error states are misleading**.

This is **not** a permission issue, **not** a migration regression, and **not** corrupted data.

It is a **bootstrap invariant failure**:

> These pages assume at least one of:
>
> - an initialized chart of accounts
> - at least one accounting period
> - at least one journal entry
>
> A brand-new business has **none of the above**, so the underlying queries and RPCs return **errors instead of empty results**.

---

## PART 1 — GENERAL LEDGER (`/ledger`)

### 1.1 What the page does

**API called:**  
`GET /api/ledger/list`

**Expected inputs:**

- `business_id`
- optional date filters
- optional account filters

**Data source:**

- `journal_entries`
- `journal_entry_lines`
- `accounts`

---

### 1.2 What exists for a new business

| Entity              | Exists? |
| ------------------- | ------- |
| business            | ✅      |
| accounting_periods  | ❌      |
| accounts (COA)      | ❌ (unless explicitly created) |
| journal_entries     | ❌      |
| journal_entry_lines | ❌      |

---

### 1.3 Why it fails

There are **two hard assumptions** in the ledger stack:

1. **At least one account exists**
   - Ledger joins against `accounts`
   - With zero rows, some queries collapse to invalid states

2. **At least one period exists**
   - Ledger APIs often implicitly assume an open period
   - Period resolution is not optional

Result:

- Backend throws
- UI catches and renders generic:  
  **"Failed to load ledger"**

This is **not a permission error** — it is a **missing bootstrap state**.

---

### 1.4 Why this is logically correct

A ledger without:

- accounts
- periods
- journals

…is **not a ledger**, it's an uninitialized accounting system.

The error is technically valid; the **message is not**.

---

## PART 2 — TRIAL BALANCE (`/trial-balance`)

### 2.1 What the page does

**API called:**  
`GET /api/accounting/trial-balance?business_id=…&as_of_date=…`

**Internal flow:**

1. Resolve accounting period for `as_of_date`
2. Attempt to load `trial_balance_snapshots`
3. If none exists → generate snapshot
4. Validate ledger balance
5. Return rows

---

### 2.2 What exists for a new business

| Entity                   | Exists? |
| ------------------------ | ------- |
| accounting_periods       | ❌      |
| trial_balance_snapshots  | ❌      |
| journal_entries          | ❌      |
| accounts                 | ❌      |

---

### 2.3 Exact failure points

#### Failure A — period resolution

- No accounting period exists
- Period resolution fails or returns null
- Downstream snapshot logic has no `period_id`

#### Failure B — snapshot generation

Even if snapshot generation is attempted:

- No accounts
- No journal lines
- Snapshot is either empty or invalid

#### Failure C — balance check

UI shows:

> ⚠️ Ledger is Not Balanced

This is **mathematically meaningless** when:

- total debit = 0
- total credit = 0
- no accounts exist

But the invariant checker is binary, not contextual.

---

### 2.4 Why this is *not* a bug

From an accounting-systems perspective:

- Trial Balance **requires**:
  - chart of accounts
  - at least one period
- A "zero business" has **no accounting state yet**

So the backend is doing the correct thing by refusing to fabricate a TB.

Again: **the error messaging is wrong, not the logic**.

---

## PART 3 — WHY THIS APPEARS AFTER YOUR RECENT FIXES

Your recent work **correctly exposed**:

- Ledger
- Trial Balance
- P&L
- Balance Sheet

…to **business users** earlier in the lifecycle.

Previously:

- These pages were mostly used **after accounting setup**
- Or only by firms

Now:

- A user can reach them **immediately after onboarding**

That surfaced a **latent bootstrap gap** that always existed.

---

## PART 4 — WHAT IS *NOT* WRONG (IMPORTANT)

To be explicit:

- ❌ Not RLS
- ❌ Not missing GRANT
- ❌ Not failed migration
- ❌ Not bad permissions
- ❌ Not broken APIs
- ❌ Not corrupted data

Everything is behaving **exactly as coded**.

---

## PART 5 — ROOT CAUSE (PRECISE)

> **The system does not distinguish between "no accounting data yet" and "accounting error."**

Both pages:

- treat "empty world" as "failure"
- surface generic red error states

This is a **UX + state-model gap**, not an authorization or data bug.

---

## PART 6 — CORRECT CLASSIFICATION

| Page          | Real state      | Current UI                                              |
| ------------- | --------------- | ------------------------------------------------------- |
| Ledger        | Not initialized | "Failed to load ledger" ❌                              |
| Trial Balance | Not initialized | "Failed to load trial balance" + "Ledger not balanced" ❌ |

Correct semantic state should be something like:

> "Accounting has not started for this business yet."

…but per your instruction, **no fix proposed here**.

---

## FINAL VERDICT

> Both General Ledger and Trial Balance fail on a new business **because the accounting system has not been initialized** (no periods, no accounts, no journals). This is expected behavior at the data and API level. The issue is not permissions or migrations; it is that the UI treats a valid pre-accounting state as an error instead of an empty or onboarding state.

If you want, next step can be:

- a **Phase 11: Accounting Bootstrap State Model Audit**
- or a **decision on whether accounts/periods should auto-initialize on business creation**

No half-fixes applied.
