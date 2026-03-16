# Finza Authorization & Guard System Analysis

## Executive Summary

Finza has a multi-layered authorization system with guards at layout, route, and utility levels. Recent additions of stricter Tax Engine and Accounting Mode logic have introduced `accountant_readonly` flag checks that are causing POS, Inventory, Reports, and Analytics pages to briefly show "Access denied" before redirecting to `/dashboard`.

---

## 1. GUARD ARCHITECTURE OVERVIEW

### Guard Layers (Execution Order)

1. **ProtectedLayout** (Layout-level, runs first on every protected route)
2. **useRouteGuard** (Route-level hook, optional per-page)
3. **checkRouteAccess** (Utility function, used by both above)
4. **Store Context Guards** (Route-specific, for store-scoped routes)
5. **Page-Level Guards** (Inline checks in component loadData functions)

---

## 2. ALL AUTHORIZATION GUARDS

### 2.1 ProtectedLayout (Layout-Level Guard)

**File:** `components/ProtectedLayout.tsx`  
**Applies to:** ALL routes wrapped in ProtectedLayout (essentially all protected routes)

**Conditions Enforced:**
1. **Authentication Check**
   - Supabase session OR cashier PIN session
   - Redirects to `/login` if no session
   - Special handling for POS routes (allows cashier PIN)

2. **Role-Based Route Access**
   - Fetches user role via `getUserRole()`
   - Fetches `accountant_readonly` flag via `isUserAccountantReadonly()`
   - Calls `checkRouteAccess(role, pathname, accountantReadonly)`
   - If access denied → redirects to `getHomeRouteForRole(role, accountantReadonly)`

3. **Store Context Auto-Bind**
   - Calls `autoBindSingleStore()` to auto-set store for single-store users
   - Runs BEFORE route access check

**Execution Flow:**
```
User navigates → ProtectedLayout mounts → checkAuth() runs → 
  - Check session
  - Auto-bind store (if single store)
  - Get role + accountant_readonly flag
  - checkRouteAccess()
  - Redirect if denied
```

**Redirect Targets:**
- `/login` (no session)
- `/pos/pin` (cashier PIN required)
- `getHomeRouteForRole()` result (access denied)

---

### 2.2 useRouteGuard Hook (Route-Level Guard)

**File:** `lib/useRouteGuard.ts`  
**Applies to:** Routes that explicitly call `useRouteGuard()` in their component

**Routes Using useRouteGuard:**
- `/admin/retail/analytics` (`app/admin/retail/analytics/page.tsx`)
- `/sales/open-session` (`app/sales/open-session/page.tsx`)
- `/sales/close-session` (`app/sales/close-session/page.tsx`)
- Various accounting pages
- Various settings pages

**Conditions Enforced:**
1. **Cashier PIN Session Check** (first priority)
   - If cashier authenticated → checks route access for cashier role only
   - Redirects to `/pos` if blocked

2. **Supabase Auth Check**
   - Redirects to `/login` if no user

3. **Business Check**
   - Redirects to `/business-setup` if no business

4. **Role-Based Route Access**
   - Fetches role + `accountant_readonly` flag
   - Calls `checkRouteAccess(role, pathname, accountantReadonly)`
   - Redirects to `getHomeRouteForRole()` if denied

**NOTE:** This is a DUPLICATE of ProtectedLayout logic, causing redundant checks.

---

### 2.3 checkRouteAccess (Core Guard Logic)

**File:** `lib/routeGuards.ts`  
**Function:** `checkRouteAccess(role, pathname, isAccountantReadonly)`

**Conditions Enforced:**

#### Priority 1: Accountant Readonly Check (STRICT)
**If `isAccountantReadonly === true`:**
- **ALLOW ONLY:** `/accounting`, `/accounting/ledger`, `/accounting/trial-balance`, `/accounting/periods` (and subroutes)
- **BLOCK ALL OTHER ROUTES** → redirect to `/accounting`

#### Priority 2: Cashier Rules (STRICT)
**If `role === "cashier"`:**
- **ALLOW ONLY:** Routes starting with `/pos`
- **BLOCK:** All other routes → redirect to `/pos`
- Explicit block list: `/login`, `/retail`, `/dashboard`, `/reports`, `/settings`, `/sales-history`, `/sales/open-session`, `/sales/close-session`, `/admin`, `/accounting`, `/clients`, `/invoices`, `/products`, `/inventory`, `/staff`, `/payroll`

#### Priority 3: Manager Rules
**If `role === "manager"`:**
- **BLOCK:** `/settings/staff`, `/admin` (admin-only settings)
- **ALLOW:** `/sales/open-session`, `/sales/close-session`, `/retail/dashboard`, `/pos`, `/sales`, `/retail/*`
- **DEFAULT:** Allow all other routes (catch-all allows access)

#### Priority 4: Admin/Owner Rules
**If `role === "admin" || role === "owner"`:**
- **ALLOW ALL ROUTES** (no restrictions)

#### Default
- **ALLOW ACCESS** (catch-all)

---

### 2.4 Store Context Guards

**File:** `lib/storeContextGuard.ts`  
**Functions:** `checkStoreContext()`, `checkStoreContextClient()`

**Applies to:** Store-specific routes (POS, Inventory, Reports, Analytics)

**Routes Using Store Context Guards:**
- `/admin/retail/inventory-dashboard` (uses `checkStoreContextClient`)
- `/inventory/history` (uses `checkStoreContextClient`)
- `/reports/cash-office` (uses `checkStoreContextClient`)

**Conditions Enforced:**

1. **Cashiers:** Skip check (store implicit from cashier session)

2. **Managers:**
   - Must have `assignedStoreId` (from `users.store_id`) OR `activeStoreId` (from sessionStorage)
   - If missing → redirect to `/select-store?return={currentPath}`

3. **Admins/Owners:**
   - If route requires store (`requireStore=true`): Must have `activeStoreId` in sessionStorage
   - If route allows global mode (`requireStore=false`): Can use `null` store
   - If store required but missing → redirect to `/select-store?return={currentPath}`

**Execution:** Runs in page `loadData()` functions, AFTER ProtectedLayout and route guards.

---

### 2.5 Page-Level Guards (Inline Checks)

**Applies to:** Individual pages with custom permission logic

**Examples:**

#### `/admin/retail/inventory-dashboard`
- **Checks:** Role must be `owner`, `admin`, or `manager`
- **Action:** Sets `hasAccess=false`, shows error message
- **Does NOT redirect** (just blocks UI rendering)

#### `/admin/retail/analytics`
- **Uses:** `useRouteGuard()` hook (see section 2.2)
- **Also:** Has store context validation logic

#### `/sales/open-session`, `/sales/close-session`
- **Uses:** `useRouteGuard()` hook
- **Additional:** Explicit cashier block in `loadData()` → redirects to `/pos`

---

## 3. RECENTLY INTRODUCED/MODIFIED GUARDS

### 3.1 Accountant Readonly System (Recent Addition)

**Migrations:**
- `102_accounting_period_actions_audit.sql` - Audit table for period actions
- `103_accountant_write_guard.sql` - Adds `accountant_readonly` column + guard function
- `104_accountant_firms_client_access.sql` - Accountant firm access tables
- `105_accountant_access_guard.sql` - Guard function for firm access

**Key Changes:**
1. **New Column:** `business_users.accountant_readonly` (BOOLEAN, default false)
2. **New Function:** `isUserAccountantReadonly()` in `lib/userRoles.ts`
3. **Guard Logic:** `checkRouteAccess()` now checks `isAccountantReadonly` FIRST (before role checks)
4. **Integration:** `ProtectedLayout` and `useRouteGuard` both call `isUserAccountantReadonly()` and pass it to `checkRouteAccess()`

**Impact:** If a user has `accountant_readonly=true`, they are STRICTLY limited to accounting routes only, regardless of their role.

---

## 4. WHY POS/INVENTORY/REPORTS ARE BEING DENIED

### Root Cause Analysis

The issue occurs because **`checkRouteAccess()` checks `accountant_readonly` FIRST, before checking the user's role**.

**Execution Flow for Admin/Manager Users:**
```
1. User navigates to /pos (or /admin/retail/inventory-dashboard, etc.)
2. ProtectedLayout runs:
   - Gets user role (e.g., "admin")
   - Gets accountant_readonly flag (false for normal users, but checked for ALL users)
   - Calls checkRouteAccess("admin", "/pos", false)
3. checkRouteAccess() checks accountant_readonly FIRST:
   - If accountant_readonly === true → BLOCK all non-accounting routes → redirect to /accounting
   - If accountant_readonly === false → Continue to role checks
4. Role checks pass (admin/owner allow all routes)
```

**However, there's a potential issue:**

If `isUserAccountantReadonly()` returns `true` for a user who should have normal access (e.g., due to a database state issue, or if the function incorrectly returns true), then:
- `checkRouteAccess()` will BLOCK all non-accounting routes
- User gets redirected to `/accounting`
- But if they navigate to `/dashboard` (which is also blocked), they might get redirected to `getHomeRouteForRole("admin", true)` which returns `/accounting`
- This creates a redirect loop or unwanted redirects

**Another Potential Issue:**

For users with `accountant_readonly=false`, the flow should work correctly. However, if there's a timing issue or race condition:
- `isUserAccountantReadonly()` might not be called correctly
- The flag might be read incorrectly
- There could be a brief moment where the guard thinks the user is readonly

**Most Likely Cause:**

The `accountant_readonly` check is being applied to ALL users, even those who should have normal access. If the database query for `isUserAccountantReadonly()` fails or returns an unexpected value, it could cause false positives.

Additionally, `getHomeRouteForRole()` returns `/accounting` for `accountant_readonly=true` users, which might cause unwanted redirects if the flag is incorrectly set.

---

## 5. GUARD OVERLAPS AND CONFLICTS

### 5.1 ProtectedLayout vs useRouteGuard

**OVERLAP:** Both perform identical checks:
- Session validation
- Role fetching
- `accountant_readonly` flag fetching
- `checkRouteAccess()` call
- Redirect logic

**CONFLICT:** Pages using `useRouteGuard()` perform the same checks TWICE:
1. ProtectedLayout runs first (on mount)
2. useRouteGuard runs second (in useEffect)

This causes:
- Duplicate database queries
- Potential race conditions
- Unnecessary redirects if the first guard passes but the second fails

**Affected Routes:**
- `/admin/retail/analytics` (uses useRouteGuard, also wrapped in ProtectedLayout)

---

### 5.2 Route Guards vs Store Context Guards

**OVERLAP:** Both can redirect users:
- Route guards redirect to `/dashboard`, `/accounting`, `/pos`, etc.
- Store context guards redirect to `/select-store?return={path}`

**CONFLICT:** Execution order matters:
1. ProtectedLayout route guard runs FIRST
2. Store context guard runs LATER (in page loadData)

If route guard redirects to `/dashboard`, the store context guard never runs. However, if route guard passes but store context guard fails, user gets redirected to `/select-store`, which might then trigger route guard again.

**Example Flow (Problematic):**
```
User → /admin/retail/inventory-dashboard
ProtectedLayout → checkRouteAccess() → PASSES (admin allowed)
Page loadData() → checkStoreContextClient() → FAILS (no store)
Redirect to /select-store?return=/admin/retail/inventory-dashboard
ProtectedLayout → checkRouteAccess() → PASSES
/select-store page loads
User selects store → redirects back to /admin/retail/inventory-dashboard
ProtectedLayout → checkRouteAccess() → PASSES
Page loadData() → checkStoreContextClient() → PASSES (store now set)
Page loads successfully
```

This causes the "brief Access denied" flicker because:
1. Route guard passes
2. Store guard fails
3. Redirect happens
4. User sees loading/redirect state

---

### 5.3 Accountant Readonly vs Role-Based Access

**OVERLAP:** Both control route access:
- `accountant_readonly` flag blocks all non-accounting routes
- Role-based checks allow/deny specific routes

**CONFLICT:** `accountant_readonly` check runs FIRST and overrides role checks:
- If `accountant_readonly=true`, user is blocked from ALL non-accounting routes, even if their role would normally allow access
- This is intentional (readonly accountants should ONLY see accounting), but creates confusion if the flag is incorrectly set

**Example:**
- User has role="admin" AND accountant_readonly=true
- User tries to access `/pos`
- `checkRouteAccess("admin", "/pos", true)` → BLOCKS (accountant_readonly takes precedence)
- Redirects to `/accounting`
- User cannot access POS, Inventory, Reports, etc., even though they're an admin

---

## 6. SUMMARY OF GUARD CONDITIONS

### Conditions Checked by Each Guard

| Guard | Auth | Role | Business | Store | Accountant Readonly | Accounting Period |
|-------|------|------|----------|-------|-------------------|-------------------|
| ProtectedLayout | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| useRouteGuard | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| checkRouteAccess | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Store Context Guards | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Page-Level Guards | Varies | Varies | Varies | Varies | Varies | ❌ |

**Note:** Accounting period checks are NOT implemented in route guards (they're only in API routes).

---

## 7. ROUTES AFFECTED BY CURRENT ISSUE

Based on the analysis, these routes are experiencing "Access denied" flicker:

1. **POS Routes:**
   - `/pos` (main POS page)
   - `/pos/*` (all POS subroutes)

2. **Inventory Routes:**
   - `/admin/retail/inventory-dashboard`
   - `/inventory/history`

3. **Reports Routes:**
   - `/reports/cash-office`
   - `/reports/*` (potentially all report routes)

4. **Analytics Routes:**
   - `/admin/retail/analytics`

**Why These Routes Are Affected:**
- All are wrapped in `ProtectedLayout` (route guard runs)
- All have store context requirements (store guard runs)
- All are blocked by `accountant_readonly=true` (if flag is set)
- Execution order causes flicker: route guard passes → store guard fails → redirect → route guard runs again

---

## 8. KEY FINDINGS

### Issues Identified

1. **Duplicate Guard Logic:** ProtectedLayout and useRouteGuard perform identical checks, causing redundant queries and potential race conditions.

2. **Accountant Readonly Check Priority:** The `accountant_readonly` flag is checked FIRST in `checkRouteAccess()`, which is correct but may cause confusion if the flag is incorrectly set for non-accountant users.

3. **Store Context Guard Timing:** Store context guards run AFTER route guards, causing redirects that trigger route guards again, leading to flicker.

4. **No Middleware:** There's no Next.js middleware, so all guards run client-side, causing visible redirects and flicker.

5. **getHomeRouteForRole Logic:** Returns `/accounting` for `accountant_readonly=true` users, which might cause unwanted redirects if users navigate to blocked routes.

### What's Working Correctly

1. **Role-Based Access:** Admin/Owner/Manager/Cashier role checks work as intended.
2. **Store Context Logic:** Store context guards correctly enforce store requirements for store-specific routes.
3. **Accountant Readonly Isolation:** Accountant readonly users are correctly isolated to accounting routes only.

---

## 9. RECOMMENDED INVESTIGATION AREAS

1. **Check `isUserAccountantReadonly()` Implementation:**
   - Verify the function correctly returns `false` for normal users
   - Check database state: Are any users incorrectly marked with `accountant_readonly=true`?
   - Add logging to see what values are being returned

2. **Check Execution Timing:**
   - Add console logs to see the order of guard execution
   - Check if there are race conditions between ProtectedLayout and useRouteGuard

3. **Check Redirect Targets:**
   - Verify `getHomeRouteForRole()` is returning correct redirect targets
   - Check if redirects are happening unnecessarily

4. **Verify Store Context Auto-Bind:**
   - Ensure `autoBindSingleStore()` is running correctly
   - Check if store context is being set before route guards run

---

## 10. GUARD EXECUTION FLOW DIAGRAM

```
User Navigation
    ↓
ProtectedLayout (mounts)
    ↓
checkAuth() runs
    ↓
[Session Check] → No session? → Redirect to /login
    ↓
[Auto-bind Store] → autoBindSingleStore()
    ↓
[Get Role] → getUserRole()
    ↓
[Get Accountant Readonly] → isUserAccountantReadonly()
    ↓
[Route Access Check] → checkRouteAccess(role, pathname, accountantReadonly)
    ↓
    ├─ accountant_readonly=true? → Block non-accounting → Redirect to /accounting
    ├─ cashier? → Block non-POS → Redirect to /pos
    ├─ manager? → Check blocked routes → Redirect if blocked
    └─ admin/owner? → Allow all
    ↓
[Access Denied?] → Redirect to getHomeRouteForRole()
    ↓
[Access Allowed] → Render children
    ↓
Page Component (mounts)
    ↓
useRouteGuard() hook? → DUPLICATE CHECKS (if present)
    ↓
loadData() runs
    ↓
Store Context Guard? → checkStoreContextClient()
    ↓
    └─ Store missing? → Redirect to /select-store
    ↓
Page-level Guards? → Custom permission checks
    ↓
Render Page Content
```

---

**END OF ANALYSIS**




