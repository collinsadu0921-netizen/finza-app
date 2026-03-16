# ARCHITECTURE AUDIT — WORKSPACES & INVENTORY COUPLING (READ-ONLY)

**Audit date:** 2026-01-26  
**Scope:** Workspaces (Retail, Service, Accounting), item catalog, inventory, invoice/order/sale flows, ledger posting, tax.

---

## 1. EXECUTIVE SUMMARY (FACTUAL ONLY)

1. **Item model split:** Two catalog systems exist. `products` (retail) has `track_stock`, `cost_price`, `stock_quantity`/`stock`; `products_services` (service/invoice) has `type` ('service'|'product'), `unit_price`, `tax_applicable`. No `tracks_inventory` or `track_stock` on `products_services`.
2. **Invoice/Order/Estimate** use only `invoice_items` / `order_items` / `estimate_items` with `product_service_id` → `products_services`. No `products`, `products_stock`, or `products_variants`. No inventory logic.
3. **Sales (POS)** use `sale_items` with `product_id`/`variant_id` → `products`/`products_variants`. Stock decrement and COGS live in `app/api/sales/create/route.ts`; logic branches on `track_stock` (products) and variant vs simple product. No workspace check in the API.
4. **Ledger posting:** `post_invoice_to_ledger` reads only `invoices` (including `tax_lines`). No `invoice_items`, no COGS, no inventory. `post_sale_to_ledger` reads `sales` and `sale_items`, posts COGS (5000) and Inventory (1200). Invoice posting is document-level; sale posting is sale-specific.
5. **Dashboard:** `loadLowStockCount` runs when staying on `/dashboard` (service mode). It reads `products` and `products_stock` (`app/dashboard/page.tsx` 228–305, 202). No `businessIndustry` guard. Service dashboard UI does not display low-stock; the low-stock UI lives in the retail fallback block (1289–1310) which is unreachable when `businessIndustry === "service"`.
6. **Invoice new fallback:** On `products_services` load failure, `app/invoices/new/page.tsx` (128–184) falls back to `products`, maps to line items, and syncs into `products_services` with `type: "service"`. Service workspace can thus use retail `products` as selectable items for invoices.
7. **Workspace enforcement:** `lib/accessControl.ts` derives workspace from path; retail vs service access is enforced by industry (232–252). `/api/sales/create` has no industry check; isolation is by route usage (POS, offline sync) and access control to POS, not by API guard.
8. **Tax engine:** `getCanonicalTaxResultFromLineItems` (`lib/taxEngine/helpers.ts` 120–155) branches on `config.jurisdiction` (e.g. 'GH') only. No workspace or item_type branching.
9. **Professional workspace:** No distinct "Professional" workspace. Only UI strings ("Modern Professional Design", "professional invoice"). Workspace types are `retail` | `service` | `accounting`.
10. **Mixed lines on documents:** Invoices/orders use `product_service_id` only. No `product_id`. No document-level logic distinguishes `products_services.type` 'service' vs 'product' for validation or posting. Both are non–inventory from the document system’s perspective.

---

## 2. CONFIRMED VIOLATIONS

| # | Location | Fact |
|---|----------|------|
| 1 | `app/dashboard/page.tsx` 196–202, 228–305 | `loadLowStockCount` is invoked for **service** dashboard load. It queries `products` and `products_stock`. No `businessIndustry` guard. Retail tables are read in service context. |
| 2 | `app/invoices/new/page.tsx` 128–184 | Fallback to `products` when `products_services` fails. Products are used as invoice line item source and synced to `products_services` with `type: "service"`. Retail catalog used in invoice creation path. |
| 3 | `app/api/sales/create/route.ts` | No `industry` or workspace check. Processes `sale_items` with `product_id`/`variant_id`, updates `products_stock`, computes COGS from `products`/`products_variants`. Retail-only by **usage** (POS, offline sync), not by **API guard**. |

---

## 3. AMBIGUITIES / DESIGN RISKS

| # | Item | Detail |
|---|------|--------|
| 1 | `products_services.type` 'product' | Schema allows `type IN ('service','product')` (`supabase/migrations/051_fix_all_table_structures.sql` 281, `036_complete_invoice_system_setup.sql` 58). Sync-to-services and invoice fallback always use `type: "service"`. No code observed that creates or filters by `type: "product"` in `products_services`. Role of 'product' type is **UNKNOWN**. |
| 2 | "Product" implies inventory | `products` table has `track_stock` (migration `020_stock_tracking.sql`). `products_services` has no `track_stock` or `tracks_inventory`. "Product" in `products_services` is **not** tied to any inventory behaviour in invoice/order flows. |
| 3 | Service vs product in same invoice | Schema permits mixed `product_service_id` (service and product). No validation or posting logic differentiates by `products_services.type`. Impact of mixing is **UNKNOWN** (no explicit handling found). |
| 4 | Sales create and service | `/api/sales/create` is not guarded by industry. If a service business could reach it (e.g. direct API call), it would process `sale_items` and inventory. Reliance on route-level access (POS, sync) only. |

---

## 4. SAFE ZONES (CLEAN SEPARATION)

| Area | Evidence |
|------|----------|
| **Invoice create API** | `app/api/invoices/create/route.ts`: uses `invoice_items` and `product_service_id` only. No `products`, `products_stock`, or `products_variants`. No inventory. |
| **Order create API** | `app/api/orders/create/route.ts`: `order_items` with `product_service_id` only. No inventory. |
| **Order → Invoice** | `app/api/orders/[id]/convert-to-invoice/route.ts`: maps `order_items` → `invoice_items`, `product_service_id` preserved. No inventory. |
| **Estimate create** | `app/api/estimates/create/route.ts`: uses `estimate_items` and `product_service_id`. No inventory. |
| **Ledger: invoices** | `post_invoice_to_ledger` (e.g. `supabase/migrations/130_refactor_ledger_posting_to_use_tax_lines_canonical.sql` 37–143): reads `invoices` only. No `invoice_items`, `products_services`, or inventory. Posts AR, Revenue (4000), tax control accounts. |
| **Tax engine** | `lib/taxEngine/helpers.ts` `getCanonicalTaxResultFromLineItems`: branches on `config.jurisdiction` only. No workspace or item type. |
| **Access control** | `lib/accessControl.ts` 232–252: workspace–industry match. Retail routes blocked for non-retail; service routes blocked for retail. |
| **Sidebar** | `components/Sidebar.tsx` 136–213: menus differ by `businessIndustry`. Service vs retail sections are separate. |
| **Sales History** | `app/sales-history/page.tsx` 169–172: `business.industry === "service"` → redirect to `/invoices`. Page-level retail guard. |

---

## 5. OPEN QUESTIONS REQUIRING ARCHITECTURAL DECISION

1. **`products_services.type` 'product':** Is it used? Should it imply inventory or other behaviour for invoices/orders? Currently unused in observed code paths.
2. **Dashboard low-stock for service:** Should `loadLowStockCount` run when `businessIndustry === "service"`? It currently does and hits `products` / `products_stock` with no guard.
3. **Invoice new fallback:** Should invoice creation ever fall back to `products` and sync into `products_services`? Currently it does on `products_services` load failure.
4. **API-level sales guard:** Should `/api/sales/create` reject requests when `business.industry !== "retail"`? Today it does not check industry.
5. **Mixed invoice (service + product lines):** Is mixing `products_services` type 'service' and 'product' on one invoice supported or forbidden? No explicit validation or special handling found.

---

## PART 1 — ITEM & INVENTORY MODEL AUDIT

### 1.1 Item classification

**Tables:**

| Table | Location | Relevant fields | Behavioural impact |
|-------|----------|-----------------|--------------------|
| `products` | Migrations (e.g. `020_stock_tracking`, `051`) | `track_stock` (bool, default true), `cost_price`, `stock_quantity`, `stock` | Used for POS/sales. `track_stock` gates stock validation and decrement in `app/api/sales/create/route.ts` (1145, 1155). |
| `products_services` | `051`, `034`, `036` | `type` ('service'|'product'), `unit_price`, `tax_applicable`, `description` | Used for invoices, orders, estimates. No `track_stock`, `tracks_inventory`, `cost_price`, or stock fields. |
| `products_variants` | Retail migrations | `cost_price`, `stock_quantity`, `stock` (where used) | Referenced by `sale_items`; COGS and variant stock used in sales create. |
| `products_stock` | Multi-store migrations | `product_id`, `variant_id`, `store_id`, `stock`, `stock_quantity` | Per-store inventory. Written by sales create, void, refund, receive, stock transfers, bulk import. |

**Does "product" imply inventory?**

- **`products`:** Yes. `track_stock` gates inventory behaviour. Stock lives in `products_stock` (and legacy `products` fields where still used).
- **`products_services`:** No. No `track_stock` or `tracks_inventory`. `type` 'product' exists in schema but has no observed inventory behaviour in invoice/order code.

**Is "service" enforced as non-inventory?**

- **`products_services`:** No explicit enforcement. Service/invoice flows never touch `products_stock` or `products`. Non-inventory by **omission** (no inventory logic), not by a dedicated "service = no inventory" rule.

**Hardcoded assumptions:**

- `app/api/sales/create/route.ts` 1155: `if (product.track_stock !== false)` — only then validate/deduct stock for simple products. Variant path has no `track_stock` check; always deducts.
- `app/(dashboard)/pos/page.tsx` 966–967: `if (p.track_stock === false)` — always show product (no stock filter). Logic treats `track_stock` as "skip stock checks" for display.

### 1.2 Inventory trigger conditions

**Inventory mutation map:**

| File | Lines | Operation | Trigger condition |
|------|-------|-----------|-------------------|
| `app/api/sales/create/route.ts` | 906–1235 (approx.) | Stock decrement (variants and simple products) | `sale_items` with `product_id`; variant path always, simple product path only when `product.track_stock !== false` (1155). Requires `store_id` on sale. |
| `app/api/override/void-sale/route.ts` | 169–290 | Stock restore | Void flow; `product.track_stock !== false` (182, 292) for restore. |
| `app/api/override/refund-sale/route.ts` | 213–293, 278–293, 301–478 | Stock restore | Refund flow; `product.track_stock !== false` for restore. |
| `app/api/purchase-orders/[id]/receive/route.ts` | 102–149 | Stock increase | PO receive. No `track_stock` check in observed logic. |
| `app/api/stock-transfers/[id]/receive/route.ts` | 66–169 | Decrement source, increment destination | Stock transfer receive. No `track_stock` check. |
| `app/admin/retail/bulk-import/page.tsx` | 523–838 (approx.) | Insert/update `products_stock` | Bulk import. No `track_stock` check in observed logic. |
| `app/products/new/page.tsx` | 141–146 | Insert `products_stock` | New product (retail). |
| `app/products/[id]/edit/page.tsx` | 294–324 | Update/insert `products_stock` | Edit product (retail). |

**Trigger condition truth table:**

| Branch | Workspace? | Item type? | tracks_inventory / track_stock? |
|--------|------------|------------|----------------------------------|
| Sales create (simple product) | No | No (product_id) | Yes — `track_stock !== false` |
| Sales create (variant) | No | Yes — variant vs product | No — always deduct |
| Void restore | No | No | Yes — `track_stock !== false` |
| Refund restore | No | No | Yes — `track_stock !== false` |
| PO receive | No | No | No |
| Stock transfer receive | No | No | No |
| Bulk import | No | No | No |

---

## PART 2 — WORKSPACE COUPLING AUDIT

### 2.1 Workspace-based branching

| File | Lines | Branch | Effect | Affects |
|------|-------|--------|--------|---------|
| `lib/accessControl.ts` | 236–252 | `workspace === "retail"` vs `businessIndustry` | Block service/finance from retail; redirect retail from service | Access (UI/route) |
| `app/dashboard/page.tsx` | 584–768, 809, 1265 | `businessIndustry === "service"` | Service vs retail menu; service dashboard vs loading/retail fallback | UI only |
| `app/dashboard/page.tsx` | 196–202 | (none) | `loadLowStockCount` always run when staying on dashboard (service) | **Inventory** (reads `products`, `products_stock`) |
| `app/products/page.tsx` | 97–250, 250 | `business.industry === "service"` | Load `products_services` vs `products`; show/hide variants, stock, store UI | UI + data source |
| `app/customers/[id]/page.tsx` | 94–107, 189, 228, 372, 427 | `industry === "retail"` | Sales, layaways, retail actions | UI only |
| `app/api/customers/[id]/route.ts` | 26–73 | `business.industry === "retail"` | Include sales, set `industry` in response | API response |
| `app/sales-history/page.tsx` | 169–172 | `business.industry === "service"` | Redirect to `/invoices` | UI only |
| `app/reports/page.tsx` | 46, 120 | `industry === "retail"` | Retail-specific report links | UI only |
| `app/settings/staff/page.tsx` | 509 | `businessIndustry === "service"` | Service-specific staff UI | UI only |
| `components/Sidebar.tsx` | 136–246 | `businessIndustry === "service"` vs `"retail"` | Service vs retail menu items | UI only |
| `app/api/products/sync-to-services/route.ts` | 33–37 | `business.industry !== "service"` | 400, "sync only for service" | API |

**Risk classification:**

- **HIGH:** `loadLowStockCount` running for service dashboard (reads retail `products` / `products_stock`) with no workspace guard.
- **MEDIUM:** Invoice new fallback to `products` and sync to `products_services` (retail catalog in service flow).
- **LOW:** Sidebar, dashboard menu, sales-history redirect, sync-to-services guard — UI or explicit API guard.

### 2.2 Invoice / Order / Sale flow comparison

| Stage | Retail (Sale) | Service (Invoice) | Service (Order) |
|-------|----------------|-------------------|------------------|
| **Create** | `POST /api/sales/create` | `POST /api/invoices/create` | `POST /api/orders/create` |
| **Items** | `sale_items`: `product_id`, `variant_id` | `invoice_items`: `product_service_id` | `order_items`: `product_service_id` |
| **Catalog** | `products`, `products_variants` | `products_services` | `products_services` |
| **Validate** | Discount validation, stock checks (`track_stock`), store required | Required fields, line shape | Required fields, line shape |
| **Persist** | `sales`, `sale_items`; `products_stock` updates | `invoices`, `invoice_items` | `orders`, `order_items` |
| **Post** | `post_sale_to_ledger` (COGS, inventory 1200) | Trigger → `post_invoice_to_ledger` (AR, revenue, tax) | N/A (order not posted until converted to invoice) |
| **Inventory** | Decrement (and void/refund restore) | None | None |

**Divergence points:**

- **Catalog:** Sales use `products` (+ variants); invoices/orders use `products_services`.
- **Inventory:** Only sales flow touches `products_stock`; invoices/orders never do.
- **COGS:** Only in `sale_items` and `post_sale_to_ledger`; invoice posting has no COGS.

---

## PART 3 — MIXED LINE ITEM SAFETY

**Can a single document include both a service line (no inventory) and a product line (tracks inventory)?**

- **Invoices/orders:** Line items use `product_service_id` only. No link to `products` or `products_stock`. No stock decrement anywhere in these flows. So **within invoice/order**, “mixed” means mixing `products_services` rows (e.g. type 'service' vs 'product'); there is still **no inventory** for any line.
- **Validation:** No logic found that forbids or enforces mix by `products_services.type`.
- **Posting:** `post_invoice_to_ledger` uses only `invoices` (and `tax_lines`). No per-line or per–product_service logic; no COGS or inventory.
- **Stock decrement:** Only in sales. Invoices/orders never decrement stock.

**Conclusion:** **PARTIAL.**

- **Invoices/orders:** Can contain lines from different `products_services` rows (including mix of type 'service' and 'product'). No inventory either way. “Mixed” in that sense is allowed; no extra validation or isolation.
- **Sales:** All lines are retail products/variants; COGS and stock decrement apply. No “service” line type in `sale_items`. Mixed **service + inventory product** on a **sale** is not supported by the model (no service line type).
- **Explicit failure points:** None identified for invoice/order mixed lines. **Uncertainty:** No explicit design found for `products_services.type` 'product' (e.g. future inventory behaviour); that could introduce failure points later.

---

## PART 4 — ACCOUNTING & TAX INVARIANTS

### 4.1 Accounting posting rules

| Document | Posting entry point | Workspace-dependent? | Item-dependent? | Revenue | COGS | Inventory |
|----------|---------------------|----------------------|------------------|---------|------|-----------|
| Invoice | `post_invoice_to_ledger` (trigger on `invoices`) | No | No | 4000 credit | No | No |
| Payment | `post_invoice_payment_to_ledger` | No | No | N/A | No | No |
| Sale | `post_sale_to_ledger` (called from sales create) | No | No (uses sale totals and `sale_items` COGS) | 4000 credit | 5000 debit | 1200 credit |
| Refund | `post_sale_refund_to_ledger` | No | No | Reverses | Reverses | Reverses |
| Void | `post_sale_void_to_ledger` | No | No | Reverses | Reverses | Reverses |

**Tax application:** Per document (invoice, order, sale). Tax comes from `tax_lines` on the document or from request payload; no per-line workspace or item_type branching in observed posting code.

**Posting dependency matrix:**

| Posting function | Workspace-dependent? | Item-dependent? | Reads invoice_items / order_items / sale_items? | Reads products / products_services? | COGS | Inventory (1200) |
|------------------|----------------------|------------------|--------------------------------------------------|-------------------------------------|------|-------------------|
| `post_invoice_to_ledger` | No | No | No | No | No | No |
| `post_invoice_payment_to_ledger` | No | No | No | No | No | No |
| `post_sale_to_ledger` | No | No (uses sale-level totals + sale_items COGS) | Yes (`sale_items`) | No | Yes (5000) | Yes (1200) |
| `post_sale_refund_to_ledger` | No | No | Yes (`sale_items`) | No | Reverses | Reverses |
| `post_sale_void_to_ledger` | No | No | Yes (`sale_items`) | No | Reverses | Reverses |

### 4.2 Tax engine coupling

- **Workspace:** No branching on workspace in `lib/taxEngine` (`helpers.ts`, `serialize`, jurisdictions).
- **Item:** No branching on `products_services.type` or product vs service.
- **Retail context:** `lib/taxEngine/jurisdictions/ghana.ts` mentions “retail” in a comment only (line 18). No behavioural branch on retail.

---

## PART 5 — LEAKAGE ASSESSMENT

### 5.1 Retail → Service leakage

| Source | Target | Effect |
|--------|--------|--------|
| **Dashboard** `loadLowStockCount` | Service dashboard load | Reads `products` and `products_stock` when loading service dashboard. Low-stock UI not shown for service, but data fetching occurs. |
| **Invoice new** products fallback | Service invoice creation | On `products_services` failure, uses `products` as item source and syncs to `products_services`. Retail catalog used in service flow. |
| **Sync-to-services** | Service | Reads `products`, writes `products_services`. Explicitly service-only (industry check). Retail **data** used to populate service catalog. |

### 5.2 Service → Retail leakage

- No service-specific logic identified that writes or mutates retail-only tables (`products_stock`, `sale_items`, etc.) in service flows.

### 5.3 Cleanly isolated components

- Invoice create, order create, order→invoice convert: `products_services` / `invoice_items` / `order_items` only; no inventory.
- `post_invoice_to_ledger`: `invoices` only; no items or inventory.
- Tax engine: jurisdiction-based only.
- Access control and Sidebar: workspace/industry used for access and UI only.

---

## 6. INVENTORY MUTATION TRIGGER SUMMARY

| Location | Trigger | Workspace? | Item type? | track_stock? |
|----------|---------|------------|------------|--------------|
| `app/api/sales/create/route.ts` 906–1235 | Sale create with `sale_items` | No | Variant vs product (variant always deduct) | Yes for simple product |
| `app/api/override/void-sale/route.ts` 169–290 | Void sale | No | No | Yes |
| `app/api/override/refund-sale/route.ts` 213–478 | Refund sale | No | No | Yes |
| `app/api/purchase-orders/[id]/receive/route.ts` 102–149 | PO receive | No | No | No |
| `app/api/stock-transfers/[id]/receive/route.ts` 66–169 | Transfer receive | No | No | No |

---

*Audit complete. No recommendations, fixes, or opinions — observation and tracing only.*
