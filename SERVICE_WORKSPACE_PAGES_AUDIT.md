# Service Workspace Pages Audit

**Scope:** Orders, estimates, invoices (edit/view), convert-to-invoice, and related list/view pages in the **service** workspace (non‑retail / non‑POS).

**Findings below are service-workspace specific where noted; some affect shared APIs.**

---

## 1. Critical: Convert-to-Invoice Uses Invalid Status (API + Schema Mismatch)

**File:** `app/api/orders/[id]/convert-to-invoice/route.ts`

**Issue:** The route sets `status: "invoiced"` when linking the order to the new invoice (lines 618–624).  
Migration `208_orders_commercial_execution_state_separation.sql` defines `orders.status` as **commercial state** and allows only:

```text
'draft' | 'issued' | 'converted' | 'cancelled'
```

It explicitly migrated old `'invoiced'` → `'converted'`. There is no `'invoiced'` in the current constraint.

**Effect:**

- The `UPDATE orders SET … status = 'invoiced'` hits the DB constraint and fails.
- The invoice and `invoice_items` are already inserted; the order is **not** updated with `invoice_id` or new status.
- Result: converted invoice exists but the order still shows as issued/draft, has no `invoice_id`, and can be “converted” again → duplicate invoices and broken workflow.

**Required fix:**  
Use the status value allowed by the schema: set `status: "converted"` (not `"invoiced"`) when updating the order after conversion.  
Also align validation and comments: “already converted” should treat `status === "converted"` (and optionally still allow `"invoiced"` for backwards compatibility if any legacy rows exist).

**References:**

- `supabase/migrations/208_orders_commercial_execution_state_separation.sql` (constraint and migration of `invoiced` → `converted`).
- `app/api/orders/[id]/convert-to-invoice/route.ts` lines 96, 618–624, 657–658, 675–676.

---

## 2. Orders List Page: Status Filter vs Schema

**File:** `app/orders/page.tsx`

**Issue:** The status filter uses options that do not match the current `orders.status` enum:

- **Filter options (lines 251–256):** `"pending"`, `"active"`, `"completed"`, `"invoiced"`, `"cancelled"`.
- **Schema (`orders.status`):** `draft`, `issued`, `converted`, `cancelled`.

So:

- `pending` / `active` / `completed` are **execution_status** values, not `status`. Filtering by them returns no rows.
- `invoiced` is no longer valid; the schema uses `converted`. Filtering by `invoiced` also returns no rows.

**Effect:** In the service workspace, “Invoiced” and “Pending/Active/Completed” filters are ineffective or misleading.

**Required fix:**  
Use filter values that match the commercial state:

- Options: **Draft**, **Issued**, **Converted** (replacing “Invoiced”), **Cancelled**.
- If you need execution state in the UI, add a separate filter (or combined UX) for `execution_status`: pending / active / completed.

**Reference:** `app/orders/page.tsx` lines 242–257, 131–148 (badge uses draft/issued/converted/cancelled and is correct).

---

## 3. Hardcoded Currency in Orders / Estimates (Service Workspace)

**Files:**

- `app/orders/page.tsx`
- `app/orders/[id]/view/page.tsx`
- `app/orders/[id]/edit/page.tsx`
- `app/orders/new/page.tsx`
- `app/estimates/page.tsx`

**Issue:** Amounts and totals use fixed currency symbols/codes instead of the business’s default currency:

- **orders/page.tsx (line 328):** `₵{Number(order.total_amount || 0).toFixed(2)}`
- **orders/[id]/view (lines 492–493, 511–521):** `₵` for unit price, line total, subtotal, tax, total
- **orders/[id]/edit (line 319):** `₵` for line totals
- **orders/new (lines 400, 451, 507–527, 537):** `GHS` everywhere
- **estimates/page.tsx (line 247):** `GHS {estimate.total_amount.toFixed(2)}`

**Effect:** In the service workspace, businesses that are not Ghanaian still see GHS/₵. This is wrong for multi-currency or non-Ghana service businesses.

**Required fix:**  
Use the business’s `default_currency` (or invoice/order currency when available) and the existing `getCurrencySymbol()` (or equivalent) so all order and estimate list/view/new pages show the correct symbol/code. No schema change needed.

---

## 4. Orders List Type vs Response

**File:** `app/orders/page.tsx`

**Issue:** The local `Order` type uses:

```ts
status: "draft" | "issued" | "converted" | "cancelled"
```

The API returns whatever is in the DB. If migration 208 is applied, actual values are already draft/issued/converted/cancelled, so the type is correct.  
The only mismatch is the **filter** options (see §2), not the type itself.

**Action:** Keep the type as is; fix the filter options and any logic that assumes `"invoiced"` or uses execution_status as status.

---

## 5. Orders [id] Route: “Converted” vs “Invoiced”

**File:** `app/api/orders/[id]/route.ts` (PATCH)

**Issue:** The route blocks edits when `existingOrder.status === "converted"` or `existingOrder.invoice_id` is set (lines 173–178).  
The schema uses `converted` as the terminal commercial state after conversion, so this logic is correct.

**Note:** The bug is in **convert-to-invoice** writing `"invoiced"` (§1). Once that is fixed to set `"converted"`, no change is needed here.

---

## 6. Estimates “Convert to Invoice” in Service Workspace

**File:** `app/estimates/page.tsx`

**Behaviour:** “Convert to Invoice” navigates to `/estimates/${id}/convert`, which calls `POST /api/estimates/${estimateId}/convert`. That creates an invoice **directly** from the estimate (no order in the middle).  
This is the estimate → invoice path and is separate from the order → invoice path.

**Audit finding:** No incorrect status or schema mismatch was found in the estimate-convert flow for the service workspace. The main gaps here are currency (GHS hardcoded on the estimates list, §3) and any product/line rules that might differ between estimate→invoice and order→invoice (out of scope for this audit).

---

## 7. Invoices Edit / View in Service Workspace

**File:** `app/invoices/[id]/edit/page.tsx` (and related view/creation)

**Audit focus:** Service-specific behaviour and currency.

- Invoice edit/view uses invoice-level data (e.g. `currency_code` / `currency_symbol` where stored). If the app already uses those fields for display, service workspace invoices should show the correct currency.
- Remaining service-workspace risks here are the same as elsewhere: reliance on a single default currency when multiple currencies are allowed, and any hardcoded GHS/₵ in shared components. A quick grep for `GHS`/`₵` in `app/invoices` and in shared invoice components would confirm.

---

## Summary Table

| #  | Area                         | Severity  | Issue                                                                 | Fix direction                                                  |
|----|------------------------------|-----------|-----------------------------------------------------------------------|-----------------------------------------------------------------|
| 1  | convert-to-invoice API       | Critical  | Sets `status: "invoiced"`; schema allows only `"converted"`          | Set `status: "converted"` and align checks/docs                |
| 2  | orders list page             | High      | Status filter uses invalid/execution values (invoiced, pending, …)     | Filter by draft/issued/converted/cancelled; separate execution if needed |
| 3  | orders / estimates / new     | Medium    | Hardcoded GHS / ₵                                                     | Use business default currency + getCurrencySymbol (or equivalent) |
| 4  | orders list type             | Low       | Type is correct                                                       | None                                                            |
| 5  | orders [id] PATCH            | N/A       | Logic already uses “converted” and invoice_id                         | None once §1 is fixed                                          |
| 6  | estimates convert            | Low       | Flow is coherent; currency hardcoded on list                          | Fix currency per §3                                            |
| 7  | invoices edit/view           | Low       | Check for any remaining GHS/₵ in invoice UI                             | Replace with dynamic currency where needed                      |

---

## Recommended Order of Changes

1. **convert-to-invoice (critical):**  
   In `app/api/orders/[id]/convert-to-invoice/route.ts`, set `status: "converted"` (and adjust validation/comments to match schema). This prevents failed updates and duplicate conversions.

2. **Orders list filter:**  
   In `app/orders/page.tsx`, change status filter options to draft / issued / converted / cancelled, and wire them to the same `status` query param the list API already uses.

3. **Currency on orders/estimates:**  
   In orders list, order view, order edit, order new, and estimates list, replace hardcoded GHS/₵ with the business (or order/estimate) currency symbol/code from backend or existing helpers.

After that, a quick pass over invoice edit/view and shared invoice components for any remaining hardcoded currency will complete the service-workspace cleanup covered by this audit.
