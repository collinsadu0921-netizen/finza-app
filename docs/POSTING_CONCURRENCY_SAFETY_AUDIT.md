# Posting Concurrency Safety Audit

**Scope:** Invoice payment posting, refund posting, POS (sale) posting, expense posting.  
**Goal:** Identify race conditions and recommend locking or sequencing.

---

## 1. Current State by Flow

### 1.1 Invoice (AR) posting

| Aspect | Implementation |
|--------|----------------|
| **Entry point** | Trigger `trigger_auto_post_invoice` on `invoices` (AFTER INSERT OR UPDATE OF status). When status → sent/paid/partially_paid from draft, calls `post_invoice_to_ledger(NEW.id)`. Also callable via RPC (e.g. send flow, tests, backfill). |
| **Idempotency** | **Yes.** In `post_invoice_to_ledger` (226): after resolving AR account, checks for existing issuance JE (journal_entries with reference_type='invoice', reference_id=invoice_id, and a line on AR account). Returns existing JE id if found. |
| **Locking** | **Yes.** `pg_advisory_xact_lock(hashtext(business_id::text), hashtext(p_invoice_id::text))` taken **before** idempotency re-check in 226. Serializes concurrent posting for the same invoice. |
| **Trigger guard** | Trigger (043) does `IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference_type='invoice' AND reference_id=NEW.id) THEN PERFORM post_invoice_to_ledger`. Check-then-act only; real serialization is inside the function via advisory lock. |

**Race scenario:** Two concurrent UPDATEs of same invoice to status=sent. Both trigger runs call `post_invoice_to_ledger`. One acquires lock, posts, commits. Other waits on lock, then re-checks idempotency and returns existing JE. **Safe.**

---

### 1.2 Invoice payment posting

| Aspect | Implementation |
|--------|----------------|
| **Entry point** | Trigger `trigger_post_payment` on `payments` (AFTER INSERT). 218: `IF NOT EXISTS (journal_entries WHERE reference_type='payment' AND reference_id=NEW.id) THEN PERFORM post_payment_to_ledger(NEW.id)`. Also callable via RPC as `post_invoice_payment_to_ledger(p_payment_id)` (e.g. backfill, retries). |
| **Idempotency** | **Only in trigger.** The **function** `post_invoice_payment_to_ledger` (227) has **no** idempotency check and **no** advisory lock. It reads payment + invoice, asserts, and calls `post_journal_entry`. |
| **Locking** | **None** inside posting function. |

**Race scenarios:**

1. **Double RPC for same payment:** Client retries or two callers invoke `post_invoice_payment_to_ledger(payment_id)`. Both pass (no guard in function); both call `post_journal_entry` → **two JEs for one payment** (double cash/AR movement).
2. **Trigger + RPC:** Trigger runs on INSERT, checks EXISTS (false), calls `post_payment_to_ledger`. Before trigger txn commits, another session calls `post_invoice_payment_to_ledger(payment_id)` (e.g. retry). RPC has no guard → both can post → **two JEs**.

**Verdict:** **Not concurrency-safe** for same payment_id when posting is invoked more than once (retries or direct RPC).

---

### 1.3 Refund posting

| Aspect | Implementation |
|--------|----------------|
| **Entry point** | `post_sale_refund_to_ledger(p_sale_id)` — called from API (e.g. POST /api/override/refund-sale). No DB trigger. |
| **Idempotency** | **Yes, but check-then-act.** 192: at start, `SELECT id FROM journal_entries WHERE reference_type='refund' AND reference_id=p_sale_id LIMIT 1`; if found, return. Otherwise continue and call `post_journal_entry(..., 'refund', p_sale_id, ...)`. |
| **Locking** | **None.** No advisory lock. |

**Race scenario:** Two concurrent refund requests for same sale (e.g. double-click, retry, or two clients). Both run the idempotency SELECT; both see no row; both build lines and call `post_journal_entry` → **two refund JEs for one sale** (double reversal).

**Verdict:** **Not concurrency-safe** under concurrent calls for the same sale_id.

---

### 1.4 Void posting

| Aspect | Implementation |
|--------|----------------|
| **Entry point** | `post_sale_void_to_ledger(p_sale_id)` — called from API (e.g. POST /api/override/void-sale). No DB trigger. |
| **Idempotency** | **Yes, but check-then-act.** 192: `SELECT id FROM journal_entries WHERE reference_type='void' AND reference_id=p_sale_id`; if found, return. |
| **Locking** | **None.** |

**Race scenario:** Same as refund — two concurrent calls for same sale_id can both pass the guard and post → **two void JEs**.

**Verdict:** **Not concurrency-safe** under concurrent calls for the same sale_id.

---

### 1.5 POS (sale) posting

| Aspect | Implementation |
|--------|----------------|
| **Entry point** | `post_sale_to_ledger(p_sale_id, ...)` — called from **app** after sale (and sale_items) are inserted (app/api/sales/create/route.ts). No DB trigger. One sale = one RPC call in normal flow. |
| **Idempotency** | **Yes, but check-then-act.** 174: `SELECT id FROM journal_entries WHERE reference_type='sale' AND reference_id=p_sale_id`; if found, return. Otherwise build lines and call `post_journal_entry`. |
| **Locking** | **None.** No advisory lock. |

**Race scenarios:**

1. **Concurrent create for same sale:** Unlikely (sale id is PK, one INSERT). But if app logic ever called `post_sale_to_ledger(sale_id)` twice (e.g. retry after timeout while first succeeded), both could see no JE and double-post.
2. **Two requests posting same sale_id:** E.g. bug or duplicate request; both pass idempotency check → **two sale JEs** (double revenue/cash/COGS).

**Verdict:** **Not concurrency-safe** under duplicate or concurrent calls for the same sale_id.

---

### 1.6 Expense posting

| Aspect | Implementation |
|--------|----------------|
| **Entry point** | Trigger `trigger_post_expense` on `expenses` (AFTER INSERT). 043: `IF NOT EXISTS (journal_entries WHERE reference_type='expense' AND reference_id=NEW.id) THEN PERFORM post_expense_to_ledger(NEW.id)`. Also callable via RPC (e.g. backfill). |
| **Idempotency** | **Yes.** 229: first checks for existing JE (reference_type='expense', reference_id=p_expense_id). If found, return. |
| **Locking** | **Yes.** 229: `PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_expense_id::text));` then **re-check** idempotency. So: lock → re-check → post. |

**Race scenario:** Two concurrent calls to `post_expense_to_ledger(expense_id)` (e.g. trigger once + RPC retry). First takes lock, posts, commits. Second waits on lock, then re-checks and sees existing JE, returns. **Safe.**

**Verdict:** **Concurrency-safe** (advisory lock + re-check).

---

## 2. Race Condition Summary

| Flow | Idempotency | Lock | Race when … | Double JE possible? |
|------|-------------|------|-------------|---------------------|
| **Invoice (AR)** | Yes + re-check after lock | Yes (advisory) | — | No |
| **Invoice payment** | Trigger only (not in function) | No | Same payment_id posted twice (retry or RPC) | **Yes** |
| **Refund** | Check-then-act | No | Same sale_id refund posted concurrently | **Yes** |
| **Void** | Check-then-act | No | Same sale_id void posted concurrently | **Yes** |
| **POS (sale)** | Check-then-act | No | Same sale_id posted twice (retry/concurrent) | **Yes** |
| **Expense** | Yes + re-check after lock | Yes (advisory) | — | No |

---

## 3. Locking / Sequencing Recommendations

### 3.1 Invoice payment posting

- **Add idempotency inside the function:** At the start of `post_invoice_payment_to_ledger`, after loading the payment row, check for an existing JE: `SELECT id FROM journal_entries WHERE reference_type = 'payment' AND reference_id = p_payment_id LIMIT 1`. If found, return that id (and do not call `post_journal_entry`).
- **Add advisory lock and re-check:** After the idempotency check (and after resolving business_id), take `pg_advisory_xact_lock(hashtext(business_id::text), hashtext(p_payment_id::text))`, then **re-check** for existing JE. If now found, return. Otherwise proceed to build lines and call `post_journal_entry`.  
  This matches the pattern used in invoice and expense posting: lock by (business_id, entity_id), then re-check so that only one transaction posts for that payment.

**Result:** Exactly-once posting per payment_id under concurrent trigger and/or RPC calls.

---

### 3.2 Refund posting

- **Add advisory lock before idempotency:** At the start of `post_sale_refund_to_ledger`, take a lock so that all refund posting for the same sale is serialized. For example:  
  - Resolve `business_id` from the sale (or from existing sale JE if sale row is missing).  
  - `PERFORM pg_advisory_xact_lock(hashtext(business_id::text), hashtext(p_sale_id::text));`  
  - Then run the existing idempotency SELECT (refund JE for this sale_id). If found, return.  
  - Otherwise continue (build lines, post).  
- **Optional:** Use a composite lock key that includes a “refund” namespace (e.g. different second key) if you want to allow sale post and refund post to run in parallel for the same sale (currently sale is posted before refund, so same key is acceptable).

**Result:** Only one refund JE per sale_id under concurrent calls.

---

### 3.3 Void posting

- **Same pattern as refund:** In `post_sale_void_to_ledger`, take `pg_advisory_xact_lock(hashtext(business_id::text), hashtext(p_sale_id::text))` (or a void-specific key) **before** the idempotency check, then re-check for existing void JE. If found, return; else post.

**Result:** Only one void JE per sale_id under concurrent calls.

---

### 3.4 POS (sale) posting

- **Add advisory lock and re-check:** In `post_sale_to_ledger`, after resolving `business_id_val` from the sale row:  
  - `PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_sale_id::text));`  
  - Re-check idempotency: `SELECT id FROM journal_entries WHERE reference_type='sale' AND reference_id=p_sale_id`. If found, return.  
  - Otherwise continue (build lines, post).  
  Place the lock as early as possible after you have business_id and before any heavy work, so concurrent callers for the same sale block once and only one posts.

**Result:** Exactly-once posting per sale_id under retries or concurrent API calls.

---

### 3.5 Optional: DB-level uniqueness

- **journal_entries:** There is no UNIQUE constraint on `(reference_type, reference_id)` today. Manual draft and opening-balance imports use unique indexes on `source_draft_id` and `source_import_id`; operational posting does not.  
- **Recommendation (optional):** Add a **partial** unique index per reference type where “at most one JE per reference” is required, e.g.  
  - `CREATE UNIQUE INDEX ... ON journal_entries (reference_id) WHERE reference_type = 'payment';`  
  - and similarly for `reference_type = 'sale'`, `'refund'`, `'void'`, `'expense'`, `'invoice'` if the business rule is exactly one JE per entity.  
  This would make double-post attempts fail at INSERT with a constraint violation, as a backstop to application-level locking. It requires that all posting paths use the same (reference_type, reference_id) for a given entity (already the case in the codebase).  
- **Note:** If you ever need multiple JEs per reference (e.g. multiple adjustments per invoice), a single global unique (reference_type, reference_id) would be wrong; then rely on locking + idempotency only, or use type-specific partial indexes only where “one JE per reference” is the rule.

---

## 4. Sequencing (order of operations)

- **Sale then refund/void:** Refund and void both require the original sale JE to exist (they read from it or assert it). App flow already creates the sale (and posts) before calling refund/void. No change needed.  
- **Invoice then payment:** Payment posting reads the invoice (for description, draft guard). Trigger runs after payment INSERT; invoice is already sent. No change needed.  
- **Lock ordering (deadlock avoidance):** All recommended locks are “(business_id, entity_id)” with the same pattern. If you ever introduce locks on multiple entities in one transaction (e.g. lock invoice then lock payment), use a consistent global order (e.g. always lock by (business_id, entity_type, entity_id) in a fixed type order) to avoid deadlocks. Current flows lock a single entity per transaction.

---

## 5. Summary Table (Recommendations)

| Flow | Current | Recommendation |
|------|--------|-----------------|
| **Invoice** | Lock + re-check | Keep as is. |
| **Invoice payment** | No lock, no idempotency in function | Add idempotency in function; add advisory lock by (business_id, payment_id) and re-check before post. |
| **Refund** | Idempotency only | Add advisory lock by (business_id, sale_id) before idempotency check. |
| **Void** | Idempotency only | Add advisory lock by (business_id, sale_id) before idempotency check. |
| **POS (sale)** | Idempotency only | Add advisory lock by (business_id, sale_id) and re-check after lock. |
| **Expense** | Lock + re-check | Keep as is. |
| **DB backstop** | None | Optional: partial unique indexes on journal_entries (reference_type, reference_id) where one JE per reference is required. |
