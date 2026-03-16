# Option B Unified Item Model — Trace Map Audit (Read-Only)

**Audit type:** Measurement only. No fixes, refactors, or recommendations.  
**Baseline:** Unified Item Model (Option B) — Architectural Foundation (`UNIFIED_ITEM_MODEL_OPTION_B_SPEC.md`).  
**Date:** 2026-01-26.

---

## 1. Executive Summary

1. **Total violations by severity:** SEV-1: 4 | SEV-2: 13 | SEV-3: 8 | SEV-4: 5 → **30** total.
2. **Highest-risk hotspots:** Invoice new/edit fallback (product→service rewrite); sync-to-services (product→service rewrite); dashboard `loadLowStockCount` (service reads retail tables); sales/create + override + stock-transfers + purchase-orders (inventory mutation without domain guard, no StockMove pattern); invoice/order/estimate APIs (assume non-inventory, no store/stock/period validation for tracked lines).
3. **Dual catalog:** `products` and `products_services` both in use. Document lines use `product_service_id` (invoices/orders/estimates) or `product_id` (sales). No single `items` table; no `item_id` on document lines.
4. **Semantic rewriting:** Products rewritten as services (sync-to-services, invoice fallback). Option B forbids this.
5. **Inventory mutation:** All stock changes are direct `products_stock` (and sometimes `stock_movements`) updates. No StockMove domain event; no `cost_snapshot`, `posting_status`, or idempotency keys as in Option B.
6. **Invoice/order/estimate:** No `store_id` or stock validation; no `track_stock`-based branching; no accounting-period-open check for stock-affecting lines. APIs assume documents are non-inventory.
7. **Posting:** `post_invoice_to_ledger` assumes invoices are non-inventory (AR + Revenue + Tax only). `post_sale_to_ledger` reads `sale_items`, posts COGS + Inventory; no event-linked StockMove posting.
8. **Enforcement:** Retail mutation routes (sales, override, stock-transfers, purchase-orders) rely on route/access control. No industry or domain guard at API boundary.
9. **Option B migration feasibility:** Migration is feasible without **data loss** only if existing `products` / `products_services` / `invoice_items` / `order_items` / `estimate_items` / `sale_items` are mapped into `items` and Option B document/StockMove logic is introduced alongside or after. Current behaviour would need to be replaced, not preserved as-is.
10. **Clean zones:** Tax engine (jurisdiction-only); access control (workspace–industry); invoice/order/estimate **create** APIs do not touch inventory (but assume non-inventory and lack Option B validation).

---

## 2. Trace Map Table

| ID | Severity | Layer | File / Table | Read / Write | Workspace | Description | Option B Invariant Violated |
|----|----------|-------|--------------|--------------|-----------|-------------|-----------------------------|
| T01 | SEV-1 | UI | `app/invoices/new/page.tsx` 128–184, 196–255 | R+W | Service | Fallback to `products` on `products_services` failure; sync into `products_services` with `type: "service"`. Products used as invoice line source. | Single item truth; no semantic rewriting |
| T02 | SEV-1 | UI | `app/invoices/[id]/edit/page.tsx` 189–203 | R | Service | Fallback to `products` on `products_services` error; products used as selector. | Single item truth; no semantic rewriting |
| T03 | SEV-1 | API | `app/api/products/sync-to-services/route.ts` 40–97 | R+W | Service | Reads `products`, inserts into `products_services` with `type: "service"`. | Single item truth; no semantic rewriting |
| T04 | SEV-1 | Data | `products` vs `products_services` | R+W | Both | Dual catalog. `invoice_items`/`order_items`/`estimate_items` use `product_service_id`; `sale_items` use `product_id`. No `items` or `item_id`. | Single item truth |
| T05 | SEV-2 | API | `app/api/invoices/create/route.ts` | R+W | Service | Uses `invoice_items` + `product_service_id` only. No `store_id`, stock, or period check. Assumes non-inventory. | Document validation (store, stock, period when tracked); conditional complexity |
| T06 | SEV-2 | API | `app/api/orders/create/route.ts` | R+W | Service | Same as T05 for orders. | Document validation; conditional complexity |
| T07 | SEV-2 | API | `app/api/estimates/create/route.ts` | R+W | Service | Same for estimates. `product_id`/`product_service_id` comments indicate dual-catalog awareness. | Document validation; conditional complexity |
| T08 | SEV-2 | API | `app/api/orders/[id]/convert-to-invoice/route.ts` 226–246, 568–572 | R+W | Service | Maps `order_items` → `invoice_items`, `product_service_id` only. No inventory validation. | Document validation; conditional complexity |
| T09 | SEV-2 | API | `app/api/sales/create/route.ts` 764–1276 | R+W | Retail | Reads `products`, `products_variants`; writes `sale_items`, `products_stock`, `stock_movements`. No industry guard. No StockMove pattern. | Event-linked accounting; inventory mutation outside StockMove; explicit domain guards |
| T10 | SEV-2 | API | `app/api/override/void-sale/route.ts` 169–290 | R+W | Retail | Restores `products_stock`; inserts `stock_movements`. No industry guard. | Event-linked accounting; domain guards |
| T11 | SEV-2 | API | `app/api/override/refund-sale/route.ts` 205–478 | R+W | Retail | Inserts `stock_movements`, updates `products_stock`. No industry guard. | Event-linked accounting; domain guards |
| T12 | SEV-2 | API | `app/api/stock-transfers/route.ts` 64–149 | R+W | Retail | Reads `products`, `products_variants`, `products_stock`; validates stock. No industry guard. | Domain guards |
| T13 | SEV-2 | API | `app/api/stock-transfers/[id]/receive/route.ts` 66–169 | R+W | Retail | Updates `products_stock` (decrement source, increment dest). No industry guard. | Event-linked accounting; domain guards |
| T14 | SEV-2 | API | `app/api/purchase-orders/[id]/receive/route.ts` 102–149 | R+W | Retail | Reads `products_stock`, increments stock. No industry guard. | Domain guards |
| T15 | SEV-2 | DB | `post_invoice_to_ledger` (e.g. `migrations/130_*` 37–143) | R | — | Reads `invoices` only. AR + Revenue + Tax. "Service revenue" hardcoded. No COGS/inventory. | Event-linked accounting (invoices may trigger stock; posting contract) |
| T16 | SEV-2 | DB | `post_sale_to_ledger` (migrations e.g. 174, 180, 182, 183, 189, 190) | R+W | — | Reads `sales`, `sale_items`; posts COGS (5000), Inventory (1200). No StockMove; no `cost_snapshot` in Option B sense. | Event-linked accounting; StockMove domain event |
| T17 | SEV-2 | UI | `app/dashboard/page.tsx` 196–202, 228–305 | R | Service | `loadLowStockCount` runs for service dashboard; reads `products`, `products_stock`. No `businessIndustry` guard. | Conditional complexity; no inventory reads for non-tracked |
| T18 | SEV-3 | API | `app/api/invoices/[id]/route.ts` 176–180, 515–520 | R+W | Service | Joins `products_services`; uses `product_service_id`. | Single item truth (dual catalog) |
| T19 | SEV-3 | API | `app/api/orders/[id]/route.ts` 78–84, 251–257, 404–456, 504–510 | R+W | Service | Same. | Single item truth |
| T20 | SEV-3 | API | `app/api/orders/convert-from-estimate/route.ts` 220–226, 84–86, 148–152 | R+W | Service | Uses `products_services`, `product_service_id`. | Single item truth |
| T21 | SEV-3 | API | `app/api/estimates/[id]/convert/route.ts` 142–176 | R+W | Service | `product_service_id` from estimate items. | Single item truth |
| T22 | SEV-3 | UI | `app/invoices/[id]/view/page.tsx` 674–682 | R | Service | Displays `products_services` name for line items. | Single item truth (dual catalog) |
| T23 | SEV-3 | UI | `app/products/page.tsx` 97–262, 369–448, 511–540 | R+W | Both | Service: `products_services`; retail: `products`, `products_variants`, `products_stock`. Branch by `business.industry`. | Single item truth; conditional complexity |
| T24 | SEV-3 | UI | `app/orders/new/page.tsx` 70–88 | R | Service | Loads `products_services` only. No fallback. | Single item truth (dual catalog) |
| T25 | SEV-3 | UI | `app/estimates/new/page.tsx` 73–104 | R | Service | Loads `products_services` only. No products fallback. | Single item truth (dual catalog) |
| T26 | SEV-4 | API | `app/api/purchase-orders/route.ts` 84–88 | R | Retail | Reads `products`. | Coupling; transitional |
| T27 | SEV-4 | API | `app/api/purchase-orders/[id]/route.ts` 36–40 | R | Retail | Joins `products`. | Coupling; transitional |
| T28 | SEV-4 | API | `app/api/onboarding/retail/finalize/route.ts` 116–134 | R | Retail | Reads `products` for validation. | Coupling; transitional |
| T29 | SEV-4 | API | `app/api/debug/refund-stock/route.ts` 70–134 | R | — | Reads `products_stock`, `sale_items`. Debug only. | Transitional |
| T30 | SEV-4 | UI | `app/admin/retail/analytics/page.tsx` 659–691, 910–943 | R | Retail | Reads `products_variants`, `products_stock`, `products` for COGS/analytics. | Reporting dependency; transitional |

---

## 3. Hotspot Clusters

### 3.1 Invoice fallback (product → service rewrite)

- **T01, T02:** Invoice new/edit fallback to `products` when `products_services` fails or is empty; sync or use products as selector. Semantic rewrite (product as service).
- **Root cause:** Dual catalog + fallback logic in UI.

### 3.2 Sync-to-services (product → service rewrite)

- **T03:** API reads `products`, writes `products_services` with `type: "service"`. Explicit product→service rewrite.
- **Root cause:** Dual catalog plus “sync” use case.

### 3.3 Dashboard inventory reads in service context

- **T17:** `loadLowStockCount` runs on service dashboard load; reads `products` and `products_stock`. No workspace guard.
- **Root cause:** Shared dashboard code path; no conditional bypass for service.

### 3.4 Inventory mutation without domain guard or StockMove

- **T09, T10, T11, T12, T13, T14:** Sales create, void, refund, stock-transfers, PO receive. All mutate `products_stock` (and often `stock_movements`). No industry/domain guard at API. No StockMove domain event, no `cost_snapshot`/`posting_status`/idempotency.
- **Root cause:** Inventory implemented as direct stock updates; retail isolation by route/UI only.

### 3.5 Document APIs assume non-inventory

- **T05, T06, T07, T08:** Invoice, order, estimate create/convert. No `store_id`, no stock check, no period-open check for “tracked” lines. No `track_stock`-based branching.
- **Root cause:** Design assumes invoice/order/estimate are always non-inventory.

### 3.6 Posting assumes invoice non-inventory; sale COGS/inventory ad hoc

- **T15, T16:** `post_invoice_to_ledger` never does COGS/inventory. `post_sale_to_ledger` reads `sale_items`, posts COGS and inventory directly. No event-linked StockMove posting.
- **Root cause:** Posting design predates Option B; no StockMove concept.

### 3.7 Dual catalog usage across app

- **T04, T18–T25:** All document and product UX use either `product_service_id` + `products_services` or `product_id` + `products`/variants. No single `items` / `item_id`.
- **Root cause:** Two catalogs and two line-item reference shapes.

---

## 4. Clean Zones

| Area | Evidence |
|------|----------|
| **Tax engine** | `lib/taxEngine/helpers.ts`: `getCanonicalTaxResultFromLineItems` branches on `config.jurisdiction` only. No workspace or item type. |
| **Access control** | `lib/accessControl.ts` 232–252: workspace–industry match; retail vs service route blocking. |
| **Sidebar** | `components/Sidebar.tsx`: menus differ by `businessIndustry`. |
| **Sales history redirect** | `app/sales-history/page.tsx` 169–172: service → redirect to `/invoices`. Page-level guard. |
| **Invoice create API (no inventory)** | Does not read/write `products`, `products_stock`, or variants. Violates Option B only by omission (no validation), not by touching inventory. |
| **Order create API (no inventory)** | Same. |
| **Estimate create API (no inventory)** | Same. |
| **Order→Invoice convert (no inventory)** | No inventory tables. Violations are validation and model only. |
| **Invoice list / order list** | No product or stock tables in list routes. |

---

## 5. Open Risks

1. **`product_id` vs `product_service_id` in payloads:** Invoice new sends `product_service_id: item.product_id`. When fallback uses `products`, `item.product_id` is `products.id`. `invoice_items.product_service_id` references `products_services(id)`. Possible FK mismatch or silent misreference; exact behaviour under fallback unclear.
2. **`products_services.type` 'product':** Schema allows it; sync and fallback use `'service'` only. No code path creates or filters by `'product'`. Role under Option B undefined.
3. **Variant vs simple product:** Sales create always deducts variant stock; `track_stock` gates only simple products. Option B gates by `track_stock` only. Variance in current behaviour vs spec.
4. **`stock_movements` vs Option B StockMove:** Current `stock_movements` is audit-style. No `posting_status`, `cost_snapshot`, or `source_document_*` as in Option B. Whether it is transitional or replaced is undefined.
5. **Period-open check:** `post_invoice_to_ledger` asserts period open. Invoice/order/estimate **create** do not. Option B requires period open for stock-affecting documents. Gap between posting and create.
6. **Eliminate vs migrate vs tolerate:** Below, “eliminate” = must remove for Option B; “migrate” = replace with Option B pattern; “tolerate” = can remain temporarily during migration.

---

## 6. Violations: Eliminate vs Migrate vs Tolerate

| Severity | Eliminate | Migrate | Tolerate |
|----------|-----------|---------|----------|
| **SEV-1** | T01, T02, T03 (rewrite + fallback), T04 (dual catalog) | — | — |
| **SEV-2** | T09–T14 (inventory APIs without guard / StockMove), T15–T16 (posting assumptions) | T05–T08 (add validation + optional StockMove), T17 (guard or bypass) | — |
| **SEV-3** | — | T18–T25 (move to `items` + `item_id`) | — |
| **SEV-4** | — | — | T26–T30 (reporting/onboarding/debug) |

- **Eliminate:** Semantic rewrite, dual catalog, inventory mutation without Option B pattern, posting that assumes invoice non-inventory or bypasses StockMove.
- **Migrate:** Document validation, StockMove-based inventory, single `items` model, guarded dashboard.
- **Tolerate:** Legacy reporting/onboarding/debug reads until replaced or deprecated.

---

## 7. Scope Cross-Check (A–D)

### A. Data models / tables

- **`products`:** Illegal. Read/write from retail and service (fallback, sync). See §8 table.
- **`products_services`:** Illegal. Read/write from service and sync. See §8 table.
- **`products_stock`:** Transitional. Read/write from sales, override, stock-transfers, PO receive, bulk-import, products, dashboard. See §8 table.
- **`products_variants`:** Illegal. Read/write from sales, override, stock-transfers, bulk-import, products. See §8 table.
- **`invoice_items`:** Transitional. Read/write from invoice APIs and convert. Uses `product_service_id`. See §8 table.
- **`order_items`:** Transitional. Same; `product_service_id`. See §8 table.
- **`estimate_items`:** Transitional. Same. See §8 table.
- **`sale_items`:** Transitional. Read/write from sales, override, refund, void, debug. Uses `product_id`/`variant_id`. See §8 table.
- **`stock_movements`:** Transitional. Written by sales create, refund, void. See §8 table.

### B. API routes (§2 trace map)

- **`/api/invoices/**`:** create (T05), [id] (T18), list, send, etc. List/send do not touch product/stock tables.
- **`/api/orders/**`:** create (T06), [id] (T19), convert-from-estimate (T20), convert-to-invoice (T08), list.
- **`/api/estimates/**`:** create (T07), [id]/convert (T21).
- **`/api/sales/**`:** create (T09), park. Park not traced for product/stock.
- **`/api/products/**`:** sync-to-services (T03) only.
- **`/api/stock-transfers/**`:** route (T12), [id]/receive (T13). Send/cancel not traced.
- **`/api/dashboard/**`:** No dedicated dashboard API; dashboard data loaded in page (T17).

### C. UI / page-level (§2 trace map)

- **Dashboard:** T17 (loadLowStockCount).
- **Invoice create/edit:** T01, T02 (fallback), T18, T22 (view).
- **Order create:** T24. **Order view/convert:** uses order API.
- **Estimate create:** T25. **Estimate convert:** T21.
- **Product/service selectors:** T01, T02, T23, T24, T25. Fallbacks T01, T02.

### D. Accounting / posting (§2 trace map, §3.6)

- **Invoice posting:** T15. Assumes non-inventory; AR + Revenue + Tax only.
- **Sale posting:** T16. Reads `sale_items`; COGS + Inventory; no StockMove.
- **Refund/void:** T10, T11. Restore stock; post via `post_sale_refund_to_ledger` / `post_sale_void_to_ledger`. No industry guard at API.

---

## 8. Data Models Under Option B

| Table | Canonical / Transitional / Illegal | Read | Write | Workspace context |
|-------|------------------------------------|------|-------|-------------------|
| `products` | **Illegal** (replaced by `items`) | Yes | Yes | Retail + service (fallback, sync) |
| `products_services` | **Illegal** (replaced by `items`) | Yes | Yes | Service (+ sync) |
| `products_stock` | **Transitional** (inventory store-scoped; Option B uses StockMove + inventory) | Yes | Yes | Retail |
| `products_variants` | **Illegal** (Option B v1 single item; variants out of scope or later) | Yes | Yes | Retail |
| `invoice_items` | **Transitional** (must use `item_id`; today `product_service_id`) | Yes | Yes | Service |
| `order_items` | **Transitional** (same) | Yes | Yes | Service |
| `estimate_items` | **Transitional** (same) | Yes | Yes | Service |
| `sale_items` | **Transitional** (must use `item_id`; today `product_id`/`variant_id`) | Yes | Yes | Retail |
| `stock_movements` | **Transitional** (audit only; not Option B StockMove) | Yes | Yes | Retail |

---

*End of trace map audit. Measurement only; no fixes or recommendations.*
