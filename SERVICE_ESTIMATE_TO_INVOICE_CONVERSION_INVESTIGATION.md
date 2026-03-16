# SERVICE BUG INVESTIGATION — ESTIMATE → INVOICE FLOW (READ-ONLY)

**Date:** 2026-01-24  
**Status:** Investigation complete — **no fixes applied**

---

## PHASE 1 — FLOW TRACE

### 1. UI / Button

| Location | Trigger |
|----------|---------|
| **Estimates list** | `app/estimates/page.tsx` — "Convert to Invoice" button → `convertToInvoice(estimate.id)` |
| **Estimate view** | `app/estimates/[id]/view/page.tsx` — "Convert to Invoice" button |

Both call `router.push(\`/estimates/${estimateId}/convert\`)` and navigate to the convert page.

### 2. Convert page

| File | Behavior |
|------|----------|
| `app/estimates/[id]/convert/page.tsx` | `useEffect` runs `convertEstimate()` on mount. |

### 3. Handler → API

| Step | Detail |
|------|--------|
| **Handler** | `convertEstimate()` in `app/estimates/[id]/convert/page.tsx` (lines 17–38) |
| **Request** | `POST /api/estimates/${estimateId}/convert` — **no body**, no `Content-Type` |
| **Response handling** | `const data = await response.json()`. On `response.ok`: `router.push(\`/invoices/${data.invoice.id}/view\`)`. Else: `alert(data.error)`, `router.push("/estimates")`. On `catch`: `alert("Error converting estimate")`, `router.push("/estimates")`. |

### 4. API route

| File | Handler |
|------|---------|
| `app/api/estimates/[id]/convert/route.ts` | `POST` |

**Logic:**

1. Auth: `supabase.auth.getUser()` → 401 if no user.
2. Business: `getCurrentBusiness(supabase, user.id)` → 404 if none.
3. Fetch estimate: `supabase.from("estimates").select("*").eq("id", id).eq("business_id", business.id).single()`.
4. Reject if `estimate.converted_to` is set.
5. Fetch estimate items: `supabase.from("estimate_items").select("*").eq("estimate_id", id)`. **Error is only logged**; execution continues.
6. Invoice number: Last invoice by `business_id`, `created_at`; parse `INV-XXXX`, increment. Fallback `INV-0001`.
7. Invoice insert: Build payload from estimate (see Phase 2). `supabase.from("invoices").insert(...).select().single()`.
8. If invoice ok and `estimateItems?.length > 0`: map items → `invoice_items` payload (see Phase 2), `insert` into `invoice_items`. On items error: **delete** invoice, return 500.
9. Update estimate: `status: "accepted"`, `converted_to: "invoice"`.
10. Return `{ invoice, message }`.

### 5. Redirect

- Success: redirect to `/invoices/${data.invoice.id}/view`.
- Error: alert, redirect to `/estimates`.

---

## PHASE 2 — DATA MAPPING

### Estimate → Invoice (header)

| Convert route uses | Invoices schema (034 / 036) | Issue |
|--------------------|-----------------------------|--------|
| `subtotal` | `subtotal` | OK |
| `subtotal_before_tax` | **Not present** | Extra / wrong |
| `nhil_amount` | `nhil` (034 renames `nhil_amount` → `nhil`) | **Wrong name** |
| `getfund_amount` | `getfund` | **Wrong name** |
| `covid_amount` | `covid` | **Wrong name** |
| `vat_amount` | `vat` | **Wrong name** |
| `total_tax_amount` | `total_tax` (036) or absent (034) | **Wrong / missing** |
| `tax` | **Not present** | Extra / wrong |
| `total_amount` | `total` (034/036) | **Wrong name** |
| `issue_date` | `issue_date` (036) | OK if column exists |
| `invoice_number` | `invoice_number` | OK |
| `due_date`, `notes`, `status`, `customer_id`, `business_id` | Present | OK |

**Result:** Invoice insert uses **wrong or non-existent column names**. DB may reject the insert or ignore unknown columns; legacy tax columns are misnamed.

### Estimate items → Invoice items (lines)

| Convert route maps | Invoice_items schema (034 / 036) | Issue |
|--------------------|----------------------------------|--------|
| `product_id` | `product_service_id` | **Wrong name** |
| `quantity` | `qty` | **Wrong name** |
| `price` | `unit_price` | **Wrong name** |
| `total` | `line_subtotal` (036) / `line_total` (034) | **Wrong name** |
| `discount_amount` | Optional | **Not set** (0 would be OK) |

**Result:** Invoice items insert uses **wrong column names**. Inserts will fail or not match schema.

### Estimate items source (DB)

- **034:** `estimate_items` → `qty`, `unit_price`, `line_total`, `product_service_id`.
- **041:** `estimate_items` → `quantity`, `price`, `total`, `product_id`.

Convert **only** reads `item.quantity`, `item.price`, `item.total`, `item.product_id`. If the DB uses `qty` / `unit_price` / `line_total` / `product_service_id`, those values are **undefined** when building `invoice_items`, so we insert null/undefined into wrong columns anyway.

---

## PHASE 3 — CURRENCY & TAX CONTEXT

- **Estimate:** No `currencyCode` / `currencySymbol` in convert flow. Totals come from estimate row only.
- **Invoice creation:** Convert **does not** use tax engine, business currency, or country. It copies numeric fields from the estimate.
- **Defaults / fallbacks:** None. We use `estimate.*` and `item.*` as-is. Missing or undefined values propagate.
- **Order → Invoice:** Uses tax engine, jurisdiction, effective date, recomputes from line items. **Estimate → Invoice does not.**

---

## PHASE 4 — BACKEND RESPONSE

- On success, API returns `{ invoice, message }` with `invoice` from `.select().single()` (includes `id`). Convert page redirects to `/invoices/${data.invoice.id}/view`. **OK.**
- On error, API returns `NextResponse.json({ error: ... }, { status: 4xx|5xx })`. Convert page does `response.json()` then `alert(data.error)`. If the API ever returns non-JSON (e.g. HTML 500), `response.json()` throws → `catch` → generic alert, real error lost.
- **Estimate items fetch:** Failure is only `console.error`’d. Conversion continues. If `estimateItems` is empty or undefined, we create an **invoice with no line items** and still return success.

---

## ADDITIONAL FINDINGS

### Supabase client

- Convert route uses `import { supabase } from "@/lib/supabaseClient"` (browser client).
- Other API routes (e.g. invoice create, order convert-to-invoice) use `createSupabaseServerClient`.
- Using the browser client in an API route can cause auth/session/RLS issues.

### Invoice number

- Convert derives next number by `MAX(created_at)`, then `parseInt(invoice_number.replace("INV-", ""))`.
- Assumes `INV-XXXX` format. If business uses another prefix (e.g. via settings), parsing can fail or clash.

### Deleted estimates

- Estimate fetch does **not** filter `deleted_at`. Soft-deleted estimates can still be converted.

---

## OUTPUT — SUMMARY

### 1. Where the flow breaks

| Layer | File | Line(s) | What breaks |
|-------|------|--------|-------------|
| **API / Mapping** | `app/api/estimates/[id]/convert/route.ts` | 76–94 | Invoice insert uses wrong column names (`*_amount`, `total_amount`, `tax`, `subtotal_before_tax`, etc.) vs. `invoices` schema (`nhil`, `getfund`, `covid`, `vat`, `total`, etc.). |
| **API / Mapping** | `app/api/estimates/[id]/convert/route.ts` | 106–116 | Invoice items insert uses `product_id`, `quantity`, `price`, `total` vs. `invoice_items` schema (`product_service_id`, `qty`, `unit_price`, `line_subtotal`). |
| **API / Data** | `app/api/estimates/[id]/convert/route.ts` | 47–55 | Estimate items are read with `quantity` / `price` / `total` / `product_id`. If DB has `qty` / `unit_price` / `line_total` / `product_service_id`, we use undefined. |
| **API / Client** | `app/api/estimates/[id]/convert/route.ts` | 2 | Uses `supabaseClient` (browser) instead of server client; possible auth/RLS issues. |

The **primary** failure is almost certainly the **invoice** and **invoice_items** inserts (wrong column names and wrong source fields), leading to DB errors or inconsistent data.

### 2. What data is missing or wrong

- **Invoice:** Tax/total columns misaligned with schema (`*_amount` vs `*`, `total_amount` vs `total`, extra columns).
- **Invoice items:** Wrong column names and no `discount_amount`; source uses `quantity`/`price`/`total`/`product_id` while DB may use `qty`/`unit_price`/`line_total`/`product_service_id`.
- **Estimate items fetch:** Errors not fatal; we can create an invoice with **no line items** and still report success.

### 3. Bug classification

| Type | Yes/No | Notes |
|------|--------|--------|
| **UI bug** | No | Buttons and redirect work; generic error alert if API fails. |
| **Mapping bug** | **Yes** | Estimate → invoice and estimate_items → invoice_items use wrong column names and wrong source fields. |
| **API bug** | **Yes** | Wrong inserts, wrong client, non-fatal estimate items fetch. |

### 4. Accounting

**Accounting is not involved.** Convert only inserts into `invoices` and `invoice_items`. No ledger posting, period checks, or accounting logic in this flow.

---

## SUCCESS CRITERIA

We know **exactly** why Estimate → Invoice is broken:

1. **Invoice insert** uses column names that don’t match the `invoices` table (`*_amount` vs `*`, `total_amount` vs `total`, etc.).
2. **Invoice items insert** uses column names that don’t match `invoice_items` (`product_id`, `quantity`, `price`, `total` vs `product_service_id`, `qty`, `unit_price`, `line_subtotal`).
3. **Estimate items** are read with names that may not exist in the DB (`quantity`/`price`/`total`/`product_id`), so we often pass undefined into the wrong columns.
4. Convert uses the **browser** Supabase client instead of the **server** client, which can cause auth/RLS issues.

**No fixes have been applied.** This report is read-only.
