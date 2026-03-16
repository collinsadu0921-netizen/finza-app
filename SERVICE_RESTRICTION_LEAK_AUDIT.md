# Service Restriction Leak Audit

## Affected Pages

| Page | File | Restriction Message | Trigger Condition | Root Cause |
|------|------|---------------------|-------------------|------------|
| Portal Accounting (service entry) | `app/portal/accounting/page.tsx` | "Select a client or ensure you have an active business." | `if (noContext)` (line 405) | State `noContext` set in `loadContext` when `resolveAccountingBusinessContext` returns `"error"` in result or `!user`. **CONTEXT LEAK + STALE UI COPY**: Page uses Accounting-First helper and firm-style copy on a Service route. |
| Portal Accounting (service entry) | `app/portal/accounting/page.tsx` | "Business not found." | `resolvePeriod` when `!businessId` (line 169–170); displayed when `resolveError` is set (lines 515, 529) | `setResolveError("Business not found.")` in `resolvePeriod`. Same page uses accounting context; message shown when period resolve has no business. **CONTEXT LEAK** (page is Service but uses accounting context). |
| Reports Balance Sheet | `app/reports/balance-sheet/page.tsx` | "Business not found" | `if (!businessData)` after `getCurrentBusiness(supabase, user.id)` (lines 98–101); rendered at line 209 | State `error` set in load when `getCurrentBusiness` returns null. **LEGITIMATE SERVICE RESTRICTION**: Context from `getCurrentBusiness` only. |
| Reports Profit & Loss | `app/reports/profit-loss/page.tsx` | "Business not found" | `if (!businessData)` after `getCurrentBusiness(supabase, user.id)` (lines 94–96); rendered at lines 293–295 | Same as balance-sheet. **LEGITIMATE SERVICE RESTRICTION**. |
| Estimates list | `app/estimates/page.tsx` | "Business not found" | `if (!business)` after `getCurrentBusiness(supabase, user.id)` (lines 51–53) | State `error`; load. **LEGITIMATE SERVICE RESTRICTION**. |
| Estimate edit | `app/estimates/[id]/edit/page.tsx` | "Business not found" | `if (!business)` after `getCurrentBusiness(supabase, user.id)` (lines 83–85) | State `error`; load. **LEGITIMATE SERVICE RESTRICTION**. |
| Invoices list | `app/invoices/page.tsx` | "Business not found" | `if (!business)` after `getCurrentBusiness` (lines 116, 149) | State `error`; load. **LEGITIMATE SERVICE RESTRICTION**. |
| Invoice edit | `app/invoices/[id]/edit/page.tsx` | "Business not found" / "Business not found. Please refresh the page or contact support." | `if (!business)` (line 116); also set on save failure (line 491) | getCurrentBusiness; load and save. **LEGITIMATE SERVICE RESTRICTION**. |
| Invoice view | `app/invoices/[id]/view/page.tsx` | "Business not found" (thrown) | `if (!business)` after `getCurrentBusiness` (line 1119) | Throw in load. **LEGITIMATE SERVICE RESTRICTION**. |
| Invoice new | `app/invoices/new/page.tsx` | "Business not found. Please refresh the page or contact support." | Set when `!business` in load or on error (lines 468 etc.) | getCurrentBusiness. **LEGITIMATE SERVICE RESTRICTION**. |
| Invoices recurring | `app/invoices/recurring/page.tsx` | "Business not found" | `if (!business)` after `getCurrentBusiness` (lines 86–88) | State `error`; load. **LEGITIMATE SERVICE RESTRICTION**. |
| Orders list | `app/orders/page.tsx` | "Business not found" | `if (!business)` after `getCurrentBusiness` (lines 99–101) | State `error`; load. **LEGITIMATE SERVICE RESTRICTION**. |
| Customers list | `app/customers/page.tsx` | "Business not found" | `if (!business)` after `getCurrentBusiness` (lines 46–48) | State `error`; load. **LEGITIMATE SERVICE RESTRICTION**. |
| Customer detail | `app/customers/[id]/page.tsx` | "Business not found" | `if (!business)` after `getCurrentBusiness` (lines 76–78) | State `error`; load. **LEGITIMATE SERVICE RESTRICTION**. |

**Service pages with no restriction message rendered:**  
`app/dashboard/page.tsx` (redirects when `!businessData`; no "Select a client" or "Business not found" copy).  
`app/reports/page.tsx` (when `!business` only `setLoading(false)`; no error message set; UI may show empty stats).  
`app/ledger/page.tsx`, `app/trial-balance/page.tsx` (root): no `getCurrentBusiness` / `resolveAccountingBusinessContext`; no "Select a client" or "Business not found" in scanned logic.  
`app/expenses/create/page.tsx`, `app/expenses/[id]/edit/page.tsx` (when `!business` they `return` without setting "Business not found").

---

## Violations

- [x] **Context bleed from Accounting-First** — `app/portal/accounting/page.tsx` (Service entry) uses `resolveAccountingBusinessContext` and shows "Select a client or ensure you have an active business." and "Business not found." from accounting-style flow.
- [ ] Firm-only guard applied to Service — Not found. No Service page uses `getActiveFirmId` or firm-only guards.
- [ ] Incorrect helper usage — One page: `app/portal/accounting/page.tsx` uses `resolveAccountingBusinessContext` instead of `getCurrentBusiness` for a Service route.
- [ ] accessControl misclassification — Not found. `getWorkspaceFromPath("/portal/accounting")` returns `"service"` (path does not start with `/accounting`). Service workspace is not treated as Accounting-First in accessControl; no redirect to `/accounting/*` for `/portal/accounting`.
- [ ] None (false alarm) — Does not apply; one clear context bleed.

---

## accessControl behavior

- **getWorkspaceFromPath:**  
  - `/accounting` and `/accounting/*` → `"accounting"`.  
  - `/pos`, `/inventory`, `/sales`, `/retail`, `/admin/retail` → `"retail"`.  
  - All other paths (including `/portal/accounting`, `/dashboard`, `/orders`, `/invoices`, `/estimates`, `/customers`, `/expenses`, `/reports`) → `"service"`.
- **Service workspace** is not treated as Accounting-First: accounting-only logic (firm membership, accountant_readonly) runs only when `workspace === "accounting"` (lib/accessControl.ts lines 136, 266).
- No redirects from Service routes to `/accounting/*` in accessControl. Dashboard redirects to `/accounting/firm` or `/accounting/firm/setup` when `!businessData` and `signupIntent === "accounting_firm"` (dashboard page logic), not from accessControl.

---

## Context source validation

- **Service pages that resolve business via `getCurrentBusiness(supabase, user.id)` only (correct):**  
  `app/reports/balance-sheet/page.tsx`, `app/reports/profit-loss/page.tsx`, `app/reports/page.tsx`, `app/dashboard/page.tsx`, `app/estimates/page.tsx`, `app/estimates/new/page.tsx`, `app/estimates/[id]/edit/page.tsx`, `app/invoices/page.tsx`, `app/invoices/new/page.tsx`, `app/invoices/[id]/edit/page.tsx`, `app/invoices/[id]/view/page.tsx`, `app/invoices/recurring/page.tsx`, `app/orders/page.tsx`, `app/orders/new/page.tsx`, `app/customers/page.tsx`, `app/customers/[id]/page.tsx`, `app/expenses/create/page.tsx`, `app/expenses/[id]/edit/page.tsx`, `app/expenses/[id]/view/page.tsx` (view does not use getCurrentBusiness for initial load; uses API).
- **Service page that does NOT use getCurrentBusiness for context:**  
  `app/portal/accounting/page.tsx` — uses `resolveAccountingBusinessContext(supabase, user.id, searchParams)` (Accounting-First; can depend on URL/searchParams and firm client session). **Violation.**
- No Service page depends on `getActiveClientBusinessId` or `getActiveFirmId` (those appear only under `app/accounting/**` and `app/firm/**`).

---

## Classification summary

| Message / Page | Classification |
|----------------|----------------|
| "Select a client or ensure you have an active business." on `app/portal/accounting/page.tsx` | **CONTEXT LEAK + STALE UI COPY**: Accounting-First logic and firm-style copy on Service entry route. |
| "Business not found." on `app/portal/accounting/page.tsx` (noContext / resolveError) | **CONTEXT LEAK**: Same page uses accounting context; message is part of that flow. |
| "Business not found" (or variants) on all other Service pages listed above | **LEGITIMATE SERVICE RESTRICTION**: Triggered only when `getCurrentBusiness(supabase, user.id)` returns null (no business linked to user). No dependency on URL business_id, session client selection, or firm engagement. |

---

## Verdict

**Evidence-only:**  
One Service route shows restriction/blocking messages that stem from Accounting-First logic: **`app/portal/accounting/page.tsx`**. It is the only Service-scope page that calls `resolveAccountingBusinessContext` and the only one that renders "Select a client or ensure you have an active business." and "Business not found." in the accounting-style flow. `getWorkspaceFromPath("/portal/accounting")` returns `"service"`, so accessControl does not treat the route as accounting and does not redirect it to `/accounting/*`. The bleed is entirely in the page: it uses the accounting context resolver and firm-oriented copy on a Service entry point. All other Service pages in scope use `getCurrentBusiness(supabase, user.id)` only and show "Business not found" (or similar) only when the user has no linked business — i.e. legitimate Service restriction. This is consistent with a **regression introduced when the portal accounting view was added or refactored** to reuse Accounting-First context and copy (e.g. Phase 6–10) without switching to Service context (`getCurrentBusiness`) and Service-appropriate copy. The locked vision "Service = live truth, read-only accounting, no firm context" is violated only on that one page: Service is not otherwise using firm context or accounting-first resolution; the single violation is the portal accounting service entry using `resolveAccountingBusinessContext` and client/firm-oriented messaging.
