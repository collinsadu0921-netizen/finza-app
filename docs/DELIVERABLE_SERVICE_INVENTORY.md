# Service Inventory (Model B) — Deliverable

Additive, retail-safe, ledger-integrated implementation under `/service/*`.

---

## 1. Migration SQL

**File:** `supabase/migrations/314_service_inventory.sql`

- **service_catalog** — billable services (no stock): id, business_id, name, description, default_price, tax_code, is_active, created_at, updated_at. Index on business_id. RLS with business_users.
- **service_material_inventory** — materials stock: id, business_id, name, sku, unit, quantity_on_hand, average_cost, reorder_level, is_active, created_at, updated_at. Index on business_id. RLS.
- **service_material_movements** — audit trail: id, business_id, material_id, movement_type (purchase | adjustment | job_usage | return), quantity, unit_cost, reference_id, created_at. Indexes on business_id, material_id. RLS (SELECT, INSERT).
- **service_jobs** — engagements: id, business_id, customer_id, status, start_date, end_date, invoice_id, created_at, updated_at. Indexes on business_id, customer_id. RLS.
- **service_job_material_usage** — usage per job: id, business_id, job_id, material_id, quantity_used, unit_cost, total_cost, created_at. Indexes on business_id, job_id. RLS.
- **Account 1450** — One-time backfill: insert "Service Materials Inventory" (1450, asset) for businesses where industry = 'service' and no existing 1450.

---

## 2. RLS Policies

All five tables use the **business_users** pattern (match existing accounts pattern):

- **SELECT:** `EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = <table>.business_id AND bu.user_id = auth.uid())`
- **INSERT:** same expression in `WITH CHECK`
- **UPDATE:** same in `USING` and `WITH CHECK`
- **DELETE:** same in `USING` (except service_material_movements — insert-only audit, no update/delete policies)

No policies use `businesses.owner_id`; access is via business_users for tenant safety.

---

## 3. New Route File List

| Route | Purpose |
|-------|---------|
| `app/service/services/page.tsx` | List service_catalog (existing) |
| `app/service/services/new/page.tsx` | Create service catalog item |
| `app/service/materials/page.tsx` | List service_material_inventory |
| `app/service/materials/new/page.tsx` | Create material |
| `app/service/jobs/page.tsx` | List service_jobs |
| `app/service/jobs/new/page.tsx` | Create job |
| `app/service/jobs/[id]/page.tsx` | Job detail + material usage form |
| `app/service/inventory/page.tsx` | Materials on hand + recent movements |

**APIs:**

| API | Purpose |
|-----|---------|
| `app/api/service/materials/add-stock/route.ts` | Purchase flow: increase qty, insert movement (purchase). No ledger. |
| `app/api/service/jobs/use-material/route.ts` | Job usage: validate qty → deduct → movement (job_usage) → usage row → ledger Dr 5100 / Cr 1450. |

---

## 4. Example Job Usage Function

Logic used in `POST /api/service/jobs/use-material`:

1. Resolve business from session; validate job_id and material_id belong to that business.
2. Load material; ensure `quantity_on_hand >= quantity_used`.
3. Deduct: `UPDATE service_material_inventory SET quantity_on_hand = quantity_on_hand - quantity_used WHERE id = material_id`.
4. Insert movement: `INSERT INTO service_material_movements (business_id, material_id, movement_type, quantity, unit_cost, reference_id) VALUES (..., 'job_usage', -quantity_used, unit_cost, job_id)`.
5. Insert usage: `INSERT INTO service_job_material_usage (business_id, job_id, material_id, quantity_used, unit_cost, total_cost) VALUES (..., quantity_used, unit_cost, quantity_used * unit_cost)`.
6. If total_cost > 0: resolve accounts 1450 and 5100 via `get_account_by_code`; call `post_journal_entry` with two lines (see below).

---

## 5. Ledger Posting Example

When material is used on a job, the app calls the existing `post_journal_entry` RPC (no changes to the ledger engine):

- **Reference:** `reference_type = 'service_job_usage'`, `reference_id = job_id`.
- **Lines:**  
  - Dr **5100** (Cost of Services) — `debit = total_cost`, `description = "Job material usage: <material name>"`.  
  - Cr **1450** (Service Materials Inventory) — `credit = total_cost`, `description = "Service materials inventory"`.
- **Source:** `p_posting_source = 'system'`.

Example payload:

```ts
await supabase.rpc("post_journal_entry", {
  p_business_id: business.id,
  p_date: postingDate,
  p_description: `Service job material usage – Job ${job_id.slice(0, 8)}`,
  p_reference_type: "service_job_usage",
  p_reference_id: job_id,
  p_lines: [
    { account_id: costAccount5100Id, debit: roundedTotal, credit: 0, description: "Job material usage: Paint" },
    { account_id: invAccount1450Id, debit: 0, credit: roundedTotal, description: "Service materials inventory" },
  ],
  p_is_adjustment: false,
  p_adjustment_reason: null,
  p_adjustment_ref: null,
  p_created_by: user.id,
  p_entry_type: null,
  p_backfill_reason: null,
  p_backfill_actor: null,
  p_posted_by_accountant_id: null,
  p_posting_source: "system",
  p_is_revenue_correction: false,
})
```

Accounts 1450 and 5100 must exist for the business (1450 is backfilled for service businesses in migration 314; 5100 is from system accounts).

---

## 6. Confirmation: Retail Not Modified

- **No edits** to any `/retail/*` routes or pages.
- **No edits** to retail tables (products, products_stock, stock_movements, stores, etc.).
- **No changes** to accessControl or workspace classification logic.
- **No changes** to the ledger core engine or to `create_system_accounts` (only an additive INSERT for 1450 in 314).
- **No changes** to the existing `products` table.
- **No** shared renames or retail-specific utilities touched.
- All new code lives under `/service/*` or `/api/service/*` and uses only the new service_* tables and RPCs (`post_journal_entry`, `get_account_by_code`).

Retail remains 100% untouched.
