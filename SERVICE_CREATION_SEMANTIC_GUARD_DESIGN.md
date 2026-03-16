# Service Creation Semantic Guard — Pre-Migration Design

**Purpose:** Prevent further semantic corruption before Option B migration.  
**Scope:** Temporary semantic firewall. No schema migration, no model unification, no inventory fixes.  
**Constraints:** No new tables, no table renames, no UI-only checks.

---

## 1. Definition of "Service Item" (Behavioral)

### 1.1 Behavioral Definition

A **Service Item** is any row in `products_services` with `type = 'service'`.

- **Permanent:** Once `type = 'service'`, it must remain `'service'` for the lifetime of the row.
- **Non-inventory:** Service items must never participate in stock, cost, or store logic.
- **Not inventory-bearing:** They must never be treated as inventory-bearing, including after updates.

### 1.2 Scope of Definition

- **In scope:** `products_services` only. Service items are defined only in this table.
- **Out of scope:** Rows in `products`. The guard does not define "service" in `products`. Current "Create Service" flow that writes to `products` (e.g. via shared `/products/new`) is semantic corruption; the guard does not fix that flow. It ensures that **where** service items exist—`products_services` with `type = 'service'`—they cannot be corrupted further.

### 1.3 Fields Forced at Creation

When creating a **Service Item** (i.e. a row that must be permanently non-inventory):

| Field | Constraint |
|-------|------------|
| `type` | MUST be `'service'`. |
| `business_id` | Required by schema. |
| `name` | Required by schema. |
| `unit_price` | Required by schema. |
| All other columns | Per existing schema; no stock, cost, or store columns exist on `products_services`. |

### 1.4 Fields Forbidden

| Context | Forbidden |
|---------|-----------|
| **Update** | Setting `type = 'product'` when the row currently has `type = 'service'`. |
| **Any write** | Adding or populating columns that imply inventory (none exist on `products_services`; guard applies to future schema only if such columns are added without a migration). |

### 1.5 Invariants Enforced at Write-Time

1. **I1 — Immutable type:** For any row with `type = 'service'`, no update may set `type = 'product'`.
2. **I2 — No type flip:** Any attempt to change `type` from `'service'` to `'product'` must be rejected at the persistence layer (database or backend API), regardless of caller.

---

## 2. Write-Time Guards

### 2.1 Where the Guard Must Live

| Layer | Location | Mandatory? |
|-------|----------|------------|
| **Database** | Trigger(s) on `products_services` | **Yes.** All writes (client Supabase, API, sync, fallback, future code) hit the table. Triggers cannot be bypassed by callers. |
| **API** | Any route that updates `products_services` | **Optional defense-in-depth.** If an API explicitly updates `products_services`, it should reject `type` 'service' → 'product' before calling the DB. The DB trigger remains the authority. |

**Why backend only:** The guard must hold "even if UI changes" and "even if developers reuse code." UI-only checks do not satisfy that. Database triggers apply to every write regardless of source.

### 2.2 Database Trigger (Conceptual)

- **Table:** `products_services`
- **Event:** `BEFORE UPDATE FOR EACH ROW`
- **Condition:** `OLD.type = 'service' AND NEW.type <> 'service'`  
  i.e. reject any update where the row was `'service'` and the new type is not `'service'` (including `'product'`).
- **Action:** `RAISE EXCEPTION` with a fixed, domain-level error code and message (e.g. `SERVICE_ITEM_IMMUTABLE_TYPE`).

**No INSERT trigger required** for this invariant: the invariant governs updates only. Creation already uses `type = 'service'` in sync, fallback, and any correct "Create Service" path. The guard does not enforce *who* may create; it prevents *corruption* of existing service items.

### 2.3 Illegal States Rejected

| Illegal State | Rejection |
|---------------|-----------|
| Update `type` from `'service'` to `'product'` | Trigger raises; update aborted. |
| Update `type` from `'service'` to `NULL` or any value other than `'service'` | Trigger raises if `NEW.type <> 'service'` when `OLD.type = 'service'`. (Exact condition may be generalized to "`NEW.type` must equal `'service'` whenever `OLD.type = 'service'`.") |

### 2.4 API-Level Checks (If Present)

For any API route that performs `UPDATE` on `products_services`:

- Before executing the update, if the target row has `type = 'service'` and the payload sets `type = 'product'`, return **400** (or **422**) with a domain-level error (e.g. `SERVICE_ITEM_IMMUTABLE_TYPE`).
- Same rule if the API performs a PATCH and the effective result would change `type` from `'service'` to `'product'`.

**Note:** Writes today also occur from the client (e.g. products page, invoice fallback). Those go directly to Supabase and therefore **must** be guarded by the DB trigger. API checks alone are insufficient.

---

## 3. Read-Time Guards

### 3.1 How Inventory Codepaths Must Treat Service Items

**Rule:** Inventory logic must **never** use `products_services` rows with `type = 'service'` for stock, cost, or store.

- **Current state:** Inventory uses `products`, `products_variants`, and `products_stock` only. It does not read `products_services`. Thus, service items are already excluded **by table**.
- **Requirement:** This must remain true. No inventory codepath may be added that:
  - Reads `products_services` for stock, cost, or store, or
  - Uses `products_services` to drive stock validation, decrement, COGS, or store scoping,

  without **first** excluding rows with `type = 'service'` (or otherwise ensuring they are never used for inventory).

### 3.2 Mandatory Checks

1. **Table boundary:** Inventory logic must not use `products_services` for stock, cost, or store. If it does (e.g. future refactor), it **must** filter out `type = 'service'` or equivalent.
2. **Mixed or unified queries:** Any query or join that combines items from `products` and `products_services` for inventory-like purposes must exclude `products_services.type = 'service'`.
3. **Documentation:** Code that performs inventory operations must state explicitly that `products_services` is out of scope for inventory, or that `type = 'service'` rows are skipped.

### 3.3 Where This Applies

- Sales create, void, refund.
- Stock transfers, purchase-order receive.
- Dashboard low-stock, analytics, or any report that computes stock or COGS.
- Bulk import, stock adjustment, or similar flows.

Today, none of these use `products_services`. The read-time guard is a **contract** for future work: adding `products_services` into any such flow without excluding `type = 'service'` violates the guard.

---

## 4. Failure Modes Prevented

The following bugs or data-corruption cases are **eliminated** by the guard:

| # | Failure Mode | How the Guard Prevents It |
|---|--------------|----------------------------|
| 1 | **Service item flipped to product** | Update `type` 'service' → 'product' rejected by trigger. |
| 2 | **Service items used in inventory** | Read-time rule: inventory must not use `products_services.type = 'service'`. Today by table; tomorrow by explicit filter if `products_services` is ever used. |
| 3 | **Sync/fallback-created service items "fixed" to product** | Same as (1). No update may set `type = 'product'` for those rows. |
| 4 | **Accidental type change via generic update API** | Trigger applies to all updates. API-level check adds defense-in-depth where applicable. |
| 5 | **New code reusing update logic and flipping type** | Trigger is on the table; bypass requires direct DB access or trigger disable. |
| 6 | **Service items driving stock checks or COGS** | Read-time contract: inventory must not use service items; violating it is a guard breach. |

---

## 5. What the Guard Does *Not* Do

- **Does not** introduce new tables or rename existing ones.
- **Does not** migrate or unify models.
- **Does not** fix inventory logic.
- **Does not** ensure "Create Service" writes to `products_services` instead of `products`. That is a separate design/implementation choice. The guard only protects **existing** service items (in `products_services`, `type = 'service'`) from being turned into product-shaped, inventory-capable records.
- **Does not** add UI-only checks. All enforcement is backend (DB trigger, optional API checks).

---

## 6. Summary

| Aspect | Design |
|--------|--------|
| **Service item** | Row in `products_services` with `type = 'service'`. |
| **Forced** | `type = 'service'` at creation. |
| **Forbidden** | `type = 'product'` ever for that row. |
| **Write-time** | DB trigger on `products_services` UPDATE rejects 'service' → 'product'. Optional API checks. |
| **Read-time** | Inventory must not use `products_services.type = 'service'` for stock, cost, or store. |
| **Failure modes** | Type flip, use in inventory, "fix" after sync/fallback, generic or reused update logic. |

This design provides a **temporary but strict semantic firewall** until Option B is implemented.
