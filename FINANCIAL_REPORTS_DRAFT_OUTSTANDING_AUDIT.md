# Financial Reports – Draft Invoices in Outstanding (Audit)

## Objective

Identify **where** draft invoices enter reporting aggregates on the Financial Reports page, specifically the **Outstanding** metric.

**Rules:** Read-only. No filters added. No logic changes.

---

## 1. Location of Outstanding Calculation

| Item | Value |
|------|--------|
| **File** | `app/reports/page.tsx` |
| **Outstanding logic** | Lines 59–61 |
| **Data source** | Direct Supabase query to `invoices` (lines 47–52) |

---

## 2. Query That Feeds Outstanding

**File:** `app/reports/page.tsx`  
**Lines:** 47–52

```ts
const { data: invoicesData } = await supabase
  .from("invoices")
  .select("id, total, status")
  .eq("business_id", business.id)
  .is("deleted_at", null)
```

- **Filters applied:** `business_id`, `deleted_at IS NULL` only.
- **No status filter:** All non-deleted invoices (any status) are fetched.

---

## 3. Outstanding Calculation Snippet

**File:** `app/reports/page.tsx`  
**Lines:** 59–61

```ts
const outstandingAmount = invoicesData
  .filter((inv: any) => inv.status !== "paid" && inv.status !== "cancelled")
  .reduce((sum: number, inv: any) => sum + Number(inv.total || 0), 0)
```

- **Filter:** `status !== "paid"` and `status !== "cancelled"`.
- **Aggregation:** Sum of `invoice.total` over the filtered list.

---

## 4. Invoice Statuses Included in Outstanding

Outstanding includes every invoice whose status is **not** `paid` and **not** `cancelled`. That implies:

| Status | Included in Outstanding? |
|--------|---------------------------|
| `draft` | **Yes** |
| `sent` | Yes |
| `partially_paid` | Yes |
| `overdue` | Yes |
| `void` | Yes |
| `converted` | Yes |
| `paid` | No |
| `cancelled` | No |

So **draft** (and void, converted) are included.

---

## 5. Missing or Incorrect Status Filters

- **Missing:** There is **no** exclusion of `draft` (or of `void` / `converted`).
- **Effective filter:** Only `paid` and `cancelled` are excluded.
- **Gap:** Drafts are treated as outstanding because they are “not paid and not cancelled.”

---

## 6. Intentional vs Accidental Inclusion of Drafts

**Conclusion: accidental.**

Evidence:

1. **Invoices page** (`app/invoices/page.tsx`, 441–460) explicitly excludes drafts from outstanding:
   - Comment: *"Draft invoices are NOT financial documents and cannot be outstanding"*.
   - Filter: `inv.status !== "draft"` and only `sent` | `overdue` | `partially_paid` for outstanding.
2. **Aging report API** (`app/api/reports/aging/route.ts`, 51–72):
   - Comment: *"Exclude draft invoices - drafts are NOT financial documents and cannot be outstanding"*.
   - Query: `.in("status", ["sent", "partially_paid", "overdue"])` and `.neq("status", "draft")`.
3. **Financial Reports page** has no equivalent exclusion and no comment about drafts. Its Outstanding logic only excludes `paid` and `cancelled`, so drafts are included by omission.

Drafts are therefore included **accidentally** due to a missing status filter on the Financial Reports page, not by design.

---

## 7. Summary

| Item | Detail |
|------|--------|
| **File** | `app/reports/page.tsx` |
| **Query (data)** | 47–52: `invoices` with `business_id`, `deleted_at IS NULL`; no status filter |
| **Outstanding (agg)** | 59–61: `filter(status !== "paid" && status !== "cancelled")` then `sum(total)` |
| **Statuses included** | `draft`, `sent`, `partially_paid`, `overdue`, `void`, `converted` |
| **Statuses excluded** | `paid`, `cancelled` |
| **Missing filter** | No exclusion of `draft` (or `void` / `converted`) |
| **Why drafts are included** | Filter only removes paid/cancelled; drafts match “not paid and not cancelled” |
| **Intentional?** | No. Invoices page and Aging API exclude drafts; Reports page does not. |

---

## 8. Root Cause

Outstanding on the Financial Reports page uses a **status filter that excludes only `paid` and `cancelled`**. Because **draft** is not excluded, draft invoices are included in Outstanding. This is a **missing status filter**, not an intentional choice.
