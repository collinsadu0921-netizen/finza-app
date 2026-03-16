# Unified Item Model (Option B) — Architectural Foundation

**Status:** Design only. No code, migrations, or UI.  
**Context:** Finza multi-tenant SME ERP; ~1,000 businesses; low concurrency per tenant.  
**Decision:** Option B — Unified Item Model; B1 default — Invoices MAY trigger stock moves; accounting is event-linked.

---

## 1. Unified Item Model (Schema + Domain)

### 1.1 Canonical `items` Table

A single `items` table replaces `products` and `products_services`. One item identity per business.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Stable item identity. |
| `business_id` | UUID FK, NOT NULL | Tenant scope. |
| `name` | TEXT NOT NULL | Display name. |
| `item_kind` | TEXT NOT NULL, CHECK IN ('service', 'product') | **Label only.** Distinguishes service vs product for UI/reporting. Does **not** drive inventory behaviour. |
| `track_stock` | BOOLEAN NOT NULL DEFAULT false | **Behavioral truth.** When true, stock, cost, and location logic apply. When false, inventory codepaths must not run. |
| `cost_policy` | TEXT NOT NULL DEFAULT 'average', CHECK IN ('average', 'fixed') | v1: use `average`. Ignored when `track_stock = false`. |
| `unit_price` | NUMERIC NOT NULL DEFAULT 0 | Sell price. Used for all document types. |
| `default_revenue_account` | TEXT | Ledger account code (e.g. 4000) for revenue posting. Optional; fallback to business default. |
| `default_tax_profile` | TEXT | Tax applicability / profile reference. Optional; fallback to business default. |
| `description` | TEXT | Optional. |
| `deleted_at` | TIMESTAMPTZ | Soft delete. |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

**Constraints:**
- `UNIQUE(business_id, name)` where `deleted_at IS NULL` (or equivalent uniqueness rule).
- No dual catalogs. No `product_id` / `product_service_id` split. Document line items reference `item_id` → `items.id` only.

### 1.2 Fields Ignored When `track_stock = false`

| Field | Ignored? | Reason |
|-------|----------|--------|
| `cost_policy` | Yes | No cost tracking. |
| `default_revenue_account` | No | Still used for revenue posting. |
| `default_tax_profile` | No | Still used for tax. |
| `unit_price` | No | Still used for pricing. |
| `item_kind` | No | Label only; always used. |

**Cost / stock fields:** There are no `cost_price`, `stock_quantity`, or `stock` columns on `items`. Cost lives in **stock move / inventory** domain (e.g. `stock_moves.cost_snapshot`, per-store inventory); quantity lives in per-store inventory tables. When `track_stock = false`, those tables are never read or written for this item.

### 1.3 Codepaths That Must NEVER Execute for Non–Tracked Items

- **Stock validation** (e.g. “sufficient stock”) — must not run.
- **Stock decrement / increment** — must not run.
- **Creation or update of stock moves** — must not run.
- **COGS calculation or posting** — must not run.
- **Inventory asset posting** — must not run.
- **Store scoping** for inventory (e.g. “require store”) — must not run for **inventory** reasons. (Store may still be used for operational reasons if/when defined; that is out of scope for “inventory logic”.)
- **Average-cost updates** — must not run.
- **Any read from** per-store inventory or stock-move tables **for this item** — must not run.

**Positive rule:** For a given document line, if `item.track_stock = false`, the line is treated as **service-only**: no store requirement for stock, no stock checks, no stock moves, no COGS, no inventory posting.

---

## 2. Document Validation Rules

**Scope:** Invoice, Order, Estimate.

### 2.1 Preliminaries

- Every line item references `item_id` → `items`.
- For each line, `track_stock` is known from `items.track_stock` at validation time.

### 2.2 When ANY Line Has `track_stock = true`

**2.2.1 Store**

- **Rule:** The document **must** have a valid `store_id` (or default store for the business).
- **Rejection condition:** Document has at least one tracked line and `store_id` is missing or invalid.
- **Error (domain-level):** `"DOCUMENT_REQUIRES_STORE: Document contains stock-tracked items. Store is required."`

**2.2.2 Sufficient stock**

- **Rule:** For each tracked line, available quantity at the document’s `store_id` must be ≥ line quantity at validation time.
- **Rejection condition:** For some tracked line, available stock < line quantity.
- **Error (domain-level):** `"INSUFFICIENT_STOCK: Item {item_id} (store {store_id}): available {available}, required {required}."`

**2.2.3 Accounting period**

- **Rule:** The business’s accounting period covering the document date (e.g. issue_date / order date) must be **open**.
- **Rejection condition:** Period is closed or不存在.
- **Error (domain-level):** `"ACCOUNTING_PERIOD_CLOSED: Document date {date} falls in closed period. No stock-affecting documents allowed."`

**2.2.4 Tracked lines only**

- Stock checks and store requirement apply **only** to lines with `track_stock = true`. Lines with `track_stock = false` do not affect these rules.

### 2.3 When NO Line Has `track_stock = true`

- **Store:** Not required for inventory. (Operational use of store, if any, is separate.)
- **Stock checks:** Must be **completely bypassed**. No reads from inventory tables, no “sufficient stock” validation.
- **Stock moves:** None created.
- **Accounting period:** May still be enforced for **invoice posting** (AR, Revenue, Tax) if that is policy; it is **not** required for “stock-affecting” reasons because there are no stock-affecting lines.

### 2.4 Shared Rules (Regardless of Tracked Lines)

- **Line shape:** `item_id`, `quantity` > 0, `unit_price` ≥ 0. Reject otherwise with domain-level messages (e.g. `"INVALID_LINE: ..."`).
- **Business scope:** All `item_id`s must belong to the document’s `business_id`.
- **Duplicates:** Define whether duplicate `item_id` per document is allowed; if not, reject with explicit error.

### 2.5 Summary Table

| Scenario | Store required? | Stock check? | Period open (stock)? | Inventory logic |
|----------|-----------------|--------------|----------------------|------------------|
| ≥1 tracked line | Yes | Yes, for tracked lines only | Yes | Applied |
| 0 tracked lines | No (for inventory) | No | No (for stock) | **Completely bypassed** |

---

## 3. StockMove Domain Event

### 3.1 Schema (Logical)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | `movement_id`. |
| `business_id` | UUID FK NOT NULL | Tenant. |
| `item_id` | UUID FK NOT NULL → items | Item. |
| `store_id` | UUID FK NOT NULL | Store. |
| `quantity` | NUMERIC NOT NULL | Signed; negative = out (e.g. sale), positive = in (e.g. receive). |
| `cost_snapshot` | NUMERIC NOT NULL | Unit cost at movement time. Used for COGS and inventory valuation. |
| `source_document_type` | TEXT NOT NULL, CHECK IN ('invoice', 'order', 'sale') | Document type that caused the move. |
| `source_document_id` | UUID NOT NULL | Document ID. |
| `posting_status` | TEXT NOT NULL, CHECK IN ('pending', 'posted', 'failed') | Whether inventory/COGS posting has been applied. |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `updated_at` | TIMESTAMPTZ NOT NULL | |
| `posted_at` | TIMESTAMPTZ | Set when `posting_status = 'posted'`. |

**Immutability:** Once `posting_status = 'posted'`, the row is immutable. No updates to `quantity`, `cost_snapshot`, `source_*`, or `posting_status` except from a dedicated, audited correction flow (e.g. reversal). Normal application code must not modify posted rows.

### 3.2 Lifecycle Rules

1. **Creation:** StockMoves are created in the **same DB transaction** as the document commit (invoice / order / sale). If the transaction rolls back, no StockMoves exist.
2. **Initial state:** `posting_status = 'pending'`.
3. **Posting:** A separate posting process (or inline in same transaction, depending on implementation choice) posts to ledger (Inventory, COGS). On success: `posting_status = 'posted'`, `posted_at` set. On failure: `posting_status = 'failed'`, with failure reason stored (separate table or column as defined).
4. **Idempotency:** Posting is idempotent. Idempotency key: `(business_id, source_document_type, source_document_id, item_id, store_id, movement_id)` or equivalent such that each movement is posted at most once. Retries must not double-post.

### 3.3 Link to Source Document

- `source_document_type` + `source_document_id` uniquely identify the document.
- Ledger posting (Inventory, COGS) can reference both the StockMove and the source document for auditability.

---

## 4. Accounting Posting Contract

### 4.1 Invoice Posting

**Responsibilities:**
- **AR** (Debit) — receivable.
- **Revenue** (Credit) — from line subtotals.
- **Tax** (Credit/Debit per control account) — from `tax_lines`.

**Does NOT do:**
- Inventory asset moves.
- COGS.
- Any stock-move-related posting.

**Trigger:** On invoice commit (e.g. status → sent) or as defined by existing trigger. Same as today’s `post_invoice_to_ledger` scope, minus any inventory.

**Event linking:** Invoice posting is one accounting event. StockMove posting is another. They are **linked by reference** (`source_document_type = 'invoice'`, `source_document_id`). Both must be durably committed together (or both fail) when the invoice has tracked lines — see below.

### 4.2 StockMove Posting

**Responsibilities:**
- **Inventory asset** (e.g. 1200): Debit when quantity in, Credit when quantity out.
- **COGS** (e.g. 5000): Debit when quantity out; use `cost_snapshot * |quantity|`.

**Uses:** `cost_snapshot` only. No recomputation from current cost.

**Link:** `source_document_type`, `source_document_id` stored on StockMove and on journal lines (or journal metadata) for audit.

### 4.3 Failure and Retries

**If invoice posting fails:**
- Document must not be considered “committed” in the sense that triggers StockMoves. Typically: invoice + StockMoves created in one transaction; then invoice posting runs. If invoice posting fails, the whole transaction is rolled back, so no StockMoves exist. No orphan StockMoves.

**If StockMove posting fails (after document + StockMoves committed):**
- StockMoves remain `pending` or `failed`.
- Retry mechanism: Post only movements with `posting_status = 'pending'` (or `failed` and retriable). Use idempotency key so each movement is posted at most once.
- **Partial failure:** One movement posted, another fails. Prevention:
  - **Option A (preferred):** Document + all its StockMoves are created in one transaction. **Posting of all movements for that document** happens in a single logical unit (e.g. single DB transaction or carefully defined procedural boundary). Either all movements for the document get `posted`, or all remain `pending`/`failed` and we retry the whole set. No “half-posted” document.
  - **Option B:** Per-movement posting with compensations. More complex; not recommended for v1.

**Idempotency keys:**  
- Invoice: existing idempotency (e.g. ledger reference to `invoice_id`).  
- StockMove: `(business_id, source_document_type, source_document_id, item_id, store_id, movement_id)` or equivalent. Posting checks “already posted for this key” and skips if so.

### 4.4 Commitment Model (Event-Linked)

- **Invariant 3:** Invoice posting (AR + Revenue + Tax) and StockMove posting (Inventory + COGS) are separate events, linked by `source_document_*`.
- **Durability:** When a document has tracked lines:
  - Document + StockMoves created in one transaction.
  - Invoice posting and StockMove posting either both succeed or the overall operation fails (transaction rollback or equivalent). No “invoice posted but movements never posted” in steady state.
- **No queues in this spec:** Contract and idempotency keys are defined; actual transport (sync in-process, async job, etc.) is implementation detail.

---

## 5. Scalability & Safety Notes (1,000+ Tenants)

### 5.1 DB Locking

- **Per-tenant isolation:** Work is scoped by `business_id`. No cross-tenant locks.
- **Document-level locking:** Use row-level locks on the document (invoice/order/sale) during create/update and StockMove creation. Avoid long-held locks across many tables.
- **Inventory:** Use `SELECT ... FOR UPDATE` (or equivalent) on relevant inventory rows for the **store + item** when validating stock and creating StockMoves, within the same transaction. Lock order (e.g. document → store → item) must be consistent to avoid deadlocks.
- **Scale:** With low concurrency per tenant, lock contention is modest. Lock granularity is per (business, store, item), not global.

### 5.2 Average-Cost Calculation

- **When:** On **receipt** (e.g. PO receive, stock transfer in). Not on sale.
- **Scope:** Per (business, item, store) or per (business, item) if single-store. No cross-tenant aggregation.
- **Mechanism:** Update running average in a small, dedicated structure (e.g. `item_store_cost` or equivalent). Use a short-lived lock on that row during update. Cost is then snapshotted into StockMove at movement time.
- **Scale:** Work is per movement, per item-store. No global hotspot.

### 5.3 Multi-Store Optionality

- **Service-only businesses:** No stores, no `track_stock = true`. No inventory codepaths. No store_id requirement. Zero store-related load.
- **Single-store:** One default store; store logic is minimal.
- **Multi-store:** Store required only when there is a tracked line. Inventory and StockMoves are store-scoped. Queries filter by `store_id`; indexes on `(business_id, store_id, item_id)` keep them efficient.

### 5.4 Service-Only Business Performance

- **No inventory reads/writes:** Validation skips stock, store, and period-open-for-stock checks. No StockMoves. No COGS/inventory posting.
- **No average-cost, no stock updates:** All cost/stock logic is gated by `track_stock`. Service-only tenants never touch those codepaths.
- **Same document APIs:** Invoices/orders/estimates still validated and posted; only the “tracked” branches are skipped. No extra cost for service-only.

### 5.5 Failure Recovery

- **Transactional creation:** Document + StockMoves in one transaction. Rollback leaves no partial state.
- **Idempotent posting:** Retries safe for both invoice and StockMove posting. No double-posting if keys are respected.
- **Explicit `posting_status`:** `pending` / `posted` / `failed` allows reconciliation and targeted retries. Failed movements can be inspected and retried or escalated without touching posted ones.

---

## 6. Illegal States Made Impossible

The following illegal states are **made impossible** by the model and rules above:

1. **Dual catalog as source of truth** — Single `items` table; no `products` / `products_services` split. No “proxy” catalog.

2. **Semantic rewriting (retail → service)** — No sync that rewrites a product as a service. `item_kind` is a label; behaviour is `track_stock` only.

3. **Inventory logic for non–tracked items** — Stock checks, StockMoves, COGS, inventory posting never run when `track_stock = false`. Bypass is explicit and complete.

4. **Stock-affecting document without store** — Validation rejects when any line is tracked and `store_id` is missing or invalid.

5. **Stock-affecting document with insufficient stock** — Validation rejects before commit. No “sell then fail” for stock.

6. **Stock-affecting document in closed period** — Validation rejects; no stock moves or COGS in closed periods.

7. **Edits to documents that caused stock moves** — Invariant 4: such documents are immutable. Corrections via reversals/credit notes only. Enforced at domain boundary.

8. **Orphan StockMoves** — StockMoves created only in same transaction as document. Rollback ensures no movements without document.

9. **Double-posting of same movement** — Idempotency keys prevent duplicate posting of invoice or StockMove.

10. **Invoice posting doing COGS/Inventory** — Contract: invoice posting = AR + Revenue + Tax only. StockMove posting = Inventory + COGS. Clear separation.

11. **Cost changed after movement** — `cost_snapshot` at movement time; posting uses it. No “current cost” used for past movements.

12. **Retail mutations without industry guard** — Invariant 5: retail mutation endpoints (e.g. stock-affecting writes) must reject when business is not retail (or when store/tracked-item rules are not satisfied). Domain-level rejection, not UI-only.

13. **Service business touching inventory** — Service-only businesses have no tracked items. Validation bypasses inventory; no StockMoves. No inventory codepaths executed.

14. **Partial posting of a document’s movements** — Posting contract requires “all or nothing” for a document’s StockMoves (Option A). Prevents half-posted documents.

---

*End of architectural foundation. No code, migrations, or UI.*
