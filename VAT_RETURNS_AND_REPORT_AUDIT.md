# VAT Returns and VAT Report — Audit Report

## Summary

**Why the returns page is not working:** The VAT returns list page calls `/api/vat-returns/monthly` **without ever passing `business_id`**. When you open the page from the service workspace via the sidebar link `/vat-returns?business_id=xxx`, the page does not read `business_id` from the URL and does not send it to the API. The monthly API **does not accept `business_id`** in the query string; it only uses `getCurrentBusiness(supabase, user.id)` (or the first business in the DB as a fallback). So the API runs for a different business than the one in the URL (or returns 404 / empty / “Business country is required” if the resolved business is wrong or missing). That’s why the returns page appears broken in the service workspace.

---

## 1. VAT Returns (monthly list) — `/vat-returns` and `/api/vat-returns/monthly`

### Page (`app/vat-returns/page.tsx`)

- Calls `fetch("/api/vat-returns/monthly")` with **no query parameters**.
- Does **not** use `useSearchParams()` or pass `business_id` from the URL.
- When opened from the sidebar as `/vat-returns?business_id=xxx`, the `business_id` is ignored.

### API (`app/api/vat-returns/monthly/route.ts`)

- **Does not read `business_id` (or `businessId`) from `searchParams`.**
- Resolves business only by:
  1. `getCurrentBusiness(supabase, user.id)` when user exists
  2. If null, first row from `businesses` (`.limit(1).single()`)
- If no business: returns **404** `"Business not found"`.
- If business has no `address_country`: returns **400** `"Business country is required. Please set your business country in Business Profile settings."`
- If country is not Ghana: returns **400** `"Monthly VAT returns are not available for country XX"`.
- If the business has no tax accounts (2100, 2110, 2120, 2130): returns **200** with `monthlyReturns: []` (page shows “No VAT ledger entries found”).
- Auth check is commented out (`// if (!user) return 401`), so unauthenticated requests can hit the route and often get 404 when no user → no business.

**Root cause:** URL `business_id` is never sent by the page and never read by the API, so the “returns page not working” in the service workspace is due to wrong/missing business context.

---

## 2. VAT Report — `/reports/vat` and `/api/reports/vat-control`

### Page (`app/reports/vat/page.tsx`)

- Calls `fetch(\`/api/reports/vat-control?start_date=${startDate}&end_date=${endDate}\`)` **without `business_id`**.
- Does not read `business_id` from the URL.

### API (`app/api/reports/vat-control/route.ts`)

- Uses **`resolveAccountingContext({ supabase, userId, searchParams, source: "api" })`**, which **does** read `business_id` / `businessId` from `searchParams`.
- So the API *supports* `business_id` in the query string, but the page never passes it.
- When `business_id` is missing:
  - **Accountant:** gets **400** “Client not selected. Use Control Tower or select a client.”
  - **Owner/employee:** falls back to `getCurrentBusiness()`; if that’s wrong or null, same 400 or wrong business.

**Conclusion:** VAT report can work with `business_id` in the URL; the report page should pass through `business_id` when present (e.g. from service workspace links).

---

## 3. Other VAT returns APIs (for completeness)

| Route | Reads `business_id` from URL? | How business is resolved |
|-------|------------------------------|---------------------------|
| `GET /api/vat-returns/list` | Yes | `searchParams.business_id` → getCurrentBusiness → first business |
| `GET /api/vat-returns/monthly` | **No** | getCurrentBusiness → first business only |
| `GET /api/vat-returns/[id]` | No (uses body/param for return id only) | getCurrentBusiness only |
| `POST /api/vat-returns/calculate` | No | getCurrentBusiness only |
| `POST /api/vat-returns/create` | No | getCurrentBusiness only |

So only the **list** route is consistent with URL-based `business_id`; **monthly** (and others) are not.

---

## 4. Fixes applied

1. **`/api/vat-returns/monthly`**  
   - Read `business_id` (and `businessId`) from request `searchParams`.  
   - If present, use it (with same fallback order as list: current user business → first business).  
   - Ensures service workspace link `/vat-returns?business_id=xxx` drives the correct business.

2. **VAT returns page**  
   - Use `useSearchParams()`, read `business_id` from the URL.  
   - Append it to the fetch URL when calling `/api/vat-returns/monthly` so the API receives the same business as in the sidebar link.

3. **VAT report page**  
   - Use `useSearchParams()`, read `business_id` from the URL.  
   - Append it to the fetch URL when calling `/api/reports/vat-control` so the report uses the correct business when opened from the service workspace.

After these changes, the returns page and the VAT report should work when opened from the service workspace with `?business_id=...`.
