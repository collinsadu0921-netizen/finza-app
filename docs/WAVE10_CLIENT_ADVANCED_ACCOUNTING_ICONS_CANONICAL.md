# Wave 10: Client Advanced Accounting Icons → Canonical + Dead Surface Cleanup

## 1) Icon row location

**Component/file:** `app/dashboard/page.tsx`

The "client advanced accounting" icon row is the **service dashboard** card grid built from `getMenuSections(business?.id)`. It includes:

- **Accounting** section: Chart of Accounts, General Ledger, Trial Balance (plus Assets, Audit & Security, etc.)
- **Reconciliation** section: Reconcile Accounts

Cards are rendered at ~line 1363: `menuSections.map((section, sectionIdx) => ...)` with `router.push(item.route)` on click.

**Business ID source:** The page already has `business` in state from `loadBusinessAndRedirect()` (which calls `getCurrentBusiness()` once at load). The icon row does **not** call `getCurrentBusiness()` or read cookies; it only uses `business?.id` passed into `getMenuSections(business?.id)`.

---

## 2) Before / after icon targets

| Icon label         | Before (legacy)     | After (canonical)                                              |
|--------------------|---------------------|-----------------------------------------------------------------|
| Chart of Accounts  | `/accounts`         | `/accounting/chart-of-accounts?business_id=__BID__`            |
| General Ledger     | `/ledger`           | `/accounting/ledger?business_id=__BID__`                       |
| Trial Balance      | `/trial-balance`    | `/accounting/reports/trial-balance?business_id=__BID__`        |
| Reconcile Accounts | `/reconciliation`  | `/accounting/reconciliation?business_id=__BID__`               |

Reconciliation discrepancy banner link:

- **Before:** `href="/accounting/reconciliation"`
- **After:** `href={buildAccountingRoute("/accounting/reconciliation", business?.id)}` → includes `?business_id=__BID__` when `business` is set.

---

## 3) Files changed

| File | Change |
|------|--------|
| `lib/accounting/routes.ts` | **New.** `buildAccountingRoute(path, businessId?)` for canonical URLs and consistent `business_id` handling. |
| `app/dashboard/page.tsx` | Import `buildAccountingRoute`; `getMenuSections(businessId?)`; Accounting + Reconciliation items use `buildAccountingRoute(..., businessId)`; call `getMenuSections(business?.id)`; reconciliation banner link uses `buildAccountingRoute(..., business?.id)`. |

No legacy route pages were deleted (e.g. `app/ledger/page.tsx`, `app/trial-balance/page.tsx`, `app/reconciliation/page.tsx`, `app/accounts/page.tsx` remain as redirect-only per Wave 8). The dashboard no longer links to them.

---

## 4) Grep proof

**No `getCurrentBusiness(` in the icon row path:**

- `getMenuSections` and the JSX that renders the cards do **not** call `getCurrentBusiness()`.
- The only call is in `loadBusinessAndRedirect()` (line 104), which runs once on load and sets `business` state. The icon row only uses `business?.id` from that state.

```bash
# In dashboard page, getCurrentBusiness appears only in loadBusinessAndRedirect:
rg "getCurrentBusiness\(" finza-web/app/dashboard/page.tsx
# → line 104 (loadBusinessAndRedirect only)
```

**No cookie client usage in that component:**

- The dashboard does not read cookies for client/business context. Industry is from `getTabIndustryMode()` (sessionStorage); business is from `business` state set by `loadBusinessAndRedirect()`.

```bash
rg "cookie|document\.cookie" finza-web/app/dashboard/page.tsx
# → only in comment "no getCurrentBusiness/cookies here"
```

---

## 5) Acceptance checklist

- **A) From the client advanced accounting icon row:** Each of Chart of Accounts, General Ledger, Trial Balance, Reconcile Accounts now goes to `/accounting/...` with `?business_id=<client>` when the service dashboard has a loaded `business`; page loads or shows readiness EmptyState (no "Business not found" / "Missing business_id" from these links).
- **B) Multi-tab:** Client A ledger and Client B trial balance in two tabs both carry correct context via URL `business_id`.
- **C) No fallback bleed:** Icon row does not call `getCurrentBusiness()` and does not use cookies for client context; it uses `business?.id` from page state only.

---

## 6) Optional helper usage

`lib/accounting/routes.ts`:

- `buildAccountingRoute(path: string, businessId?: string)`  
  Returns canonical path; for client-scoped paths appends `?business_id=<id>` when `businessId` is set; Control Tower path is returned without `business_id`. Used by the dashboard icon row and reconciliation banner; can be reused by control-tower drill links or other shortcuts.
