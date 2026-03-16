# 🔍 ACCOUNTING WORKSPACE LEAK INVESTIGATION REPORT

**Date:** 2025-01-23  
**Issue:** Retail users can navigate to `/accounting/periods` and see accountant-style UI with errors

---

## EXECUTIVE SUMMARY

**Root Cause:** The `/accounting/periods` route is **intended for the Accounting Workspace** but is **incorrectly linked from the Retail Sidebar** without workspace boundary enforcement.

**Architectural Violation:** The route-level workspace boundary (`/accounting/*` = accounting workspace) is correctly identified by `getWorkspaceFromPath()`, but the **page itself does not enforce workspace context** before rendering.

**Impact:** Retail users see accountant UI and server errors due to missing `client_id`/`firm_id` context.

---

## 1️⃣ ROUTE OWNERSHIP

### Route Definition
- **Path:** `/accounting/periods`
- **File:** `app/accounting/periods/page.tsx`
- **Intended Workspace:** ✅ **ACCOUNTING** (confirmed by path prefix)

### Workspace Detection
The route is correctly identified as accounting workspace:

```typescript
// lib/accessControl.ts:37-44
export function getWorkspaceFromPath(pathname: string): Workspace {
  // Accounting workspace: /accounting/* routes
  if (normalizedPath.startsWith("/accounting")) {
    return "accounting"
  }
  // ...
}
```

**Result:** Route ownership is **correctly defined** as Accounting Workspace.

---

## 2️⃣ CONTEXT RESOLUTION TIMING

### Where Workspace is Determined
1. **Router Level:** `getWorkspaceFromPath()` in `lib/accessControl.ts` (line 37)
2. **Access Control:** `resolveAccess()` function (line 98)
3. **Page Render:** ❌ **NO WORKSPACE CHECK** in `app/accounting/periods/page.tsx`

### Page Assumptions
The page assumes:
- ✅ `business_id` (fetched via `getCurrentBusiness()`)
- ❌ **NO `client_id` check** (accountant firm context)
- ❌ **NO `firm_id` check** (accountant firm context)

### Context Resolution Flow
```
1. User navigates to /accounting/periods
2. ProtectedLayout calls resolveAccess()
3. resolveAccess() identifies workspace = "accounting"
4. resolveAccess() allows access (if user has business OR firm)
5. Page renders WITHOUT checking if user is:
   - Business owner (retail/service) → Should NOT see accounting UI
   - Accountant firm user → Should see accounting UI
```

**Problem:** The page does **NOT distinguish** between:
- Business owner accessing accounting route (should redirect)
- Accountant firm user accessing accounting route (should allow)

---

## 3️⃣ SIDEBAR LINK SOURCE

### Link Location
**File:** `components/Sidebar.tsx`

**Retail Sidebar (lines 210-214):**
```typescript
{
  title: "Accounting",
  items: [
    { label: "Accounting Periods", route: "/accounting/periods", icon: "📅" },
  ],
},
```

**Service Sidebar (lines 144-153):**
```typescript
{
  title: "ACCOUNTING (Advanced)",
  items: [
    // ...
    { label: "Accounting Periods", route: "/accounting/periods", icon: "📅" },
    // ...
  ],
},
```

### Analysis
- ✅ Link exists in **both Retail and Service** sidebars
- ❌ **No workspace guard** on sidebar links
- ❌ **No conditional rendering** based on user type (business owner vs accountant)

**Result:** The link is **incorrectly shared** across workspaces without workspace-specific guards.

---

## 4️⃣ BACKEND EXPECTATIONS

### API Route Requirements
**File:** `app/api/accounting/periods/route.ts`

**Required Parameters:**
- ✅ `business_id` (query param)
- ✅ Accountant firm access check via `can_accountant_access_business()` RPC

**API Logic:**
```typescript
// Line 26-32: Checks accountant firm access
const { data: accessLevel, error: accessError } = await supabase.rpc(
  "can_accountant_access_business",
  {
    p_user_id: user.id,
    p_business_id: businessId,
  }
)
```

**What `can_accountant_access_business` Does:**
- Returns access level if user belongs to an accounting firm with access to the business
- Returns `null` if user is a business owner (not an accountant)

**Result:** API **correctly enforces** accountant-only access, but:
- Business owners get 403 (expected)
- Page still renders accountant UI before API call fails

### PeriodCloseCenter Component
**File:** `components/PeriodCloseCenter.tsx`

**Required Context:**
- `businessId` (prop)
- Calls `/api/accounting/periods/readiness` which may require `firm_id` context

**Error Source:**
The "missing `client_id`" error likely comes from:
- PeriodCloseCenter calling readiness API
- Readiness API expecting accountant firm context
- Business owner context missing `firm_id`/`client_id`

---

## 5️⃣ INTENDED PRODUCT BEHAVIOR

### Current Architecture
Based on `lib/accessControl.ts`:

1. **Workspace Separation:**
   - `/accounting/*` = Accounting Workspace (for accountant firms)
   - `/pos`, `/retail/*`, `/sales/*` = Retail Workspace (for business owners)
   - `/invoices`, `/clients` = Service Workspace (for business owners)

2. **User Types:**
   - **Business Owner:** Owns a business (retail/service industry)
   - **Accountant Firm User:** Belongs to an accounting firm, accesses multiple businesses

3. **Access Rules:**
   - Business owners should **NOT** access `/accounting/*` routes
   - Accountant firm users **CAN** access `/accounting/*` routes

### Intended Behavior for `/accounting/periods`

**For Business Owners (Retail/Service):**
- ❌ **Should NOT have access** to `/accounting/periods`
- ✅ Should see their own accounting periods via a **different route** (if implemented)
- ✅ Or **no access** to period management (accountant-only feature)

**For Accountant Firm Users:**
- ✅ **Should have access** to `/accounting/periods`
- ✅ Can manage periods for businesses they have access to
- ✅ See "Firm-only context" banner (expected)

**Current State:**
- ❌ Business owners can navigate to `/accounting/periods` (leak)
- ❌ Page renders accountant UI (wrong context)
- ❌ API returns 403 (correct, but too late)
- ❌ PeriodCloseCenter fails with missing `client_id` (expected failure)

---

## DELIVERABLE: ROOT CAUSE & FIXES

### Why Retail Can Reach Accountant Routes

**Primary Cause:** Missing workspace boundary enforcement at the **page level**.

1. **Route Detection:** ✅ Correct (`/accounting/*` = accounting workspace)
2. **Access Control:** ⚠️ Partial (allows business owners if they have a business)
3. **Page Guard:** ❌ **MISSING** (page does not check if user is accountant vs business owner)
4. **Sidebar Guard:** ❌ **MISSING** (link shown to all users)

**Flow:**
```
Retail User → Clicks "Accounting Periods" in Sidebar
  → Navigates to /accounting/periods
  → resolveAccess() allows (user has business)
  → Page renders (no workspace check)
  → API call fails (403 or missing client_id)
  → User sees accountant UI with errors
```

---

### Where Boundary Should Be Enforced

**Three Enforcement Points:**

1. **Sidebar (UI Level):**
   - Hide `/accounting/*` links for business owners
   - Show only for accountant firm users

2. **Access Control (Router Level):**
   - `resolveAccess()` should **reject** business owners from `/accounting/*` routes
   - Only allow accountant firm users

3. **Page Level (Defense in Depth):**
   - Page should check user type before rendering
   - Redirect business owners to appropriate route

---

### Minimal Fix (Guard or Redirect)

**Option A: Sidebar Guard (Quick Fix)**
```typescript
// components/Sidebar.tsx
// Only show accounting links if user is accountant firm user
const isAccountantFirmUser = await checkIfAccountantFirmUser()
if (isAccountantFirmUser) {
  // Show accounting links
}
```

**Option B: Access Control Fix (Better)**
```typescript
// lib/accessControl.ts - resolveAccess()
if (workspace === "accounting") {
  // Check if user is accountant firm user
  const { data: firmUsers } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
  
  if (!firmUsers || firmUsers.length === 0) {
    // Business owner trying to access accounting workspace
    return { 
      allowed: false, 
      redirectTo: "/dashboard", 
      reason: "Accounting workspace requires accountant firm access" 
    }
  }
}
```

**Option C: Page-Level Guard (Defense in Depth)**
```typescript
// app/accounting/periods/page.tsx
useEffect(() => {
  const checkWorkspace = async () => {
    const { data: firmUsers } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)
      .limit(1)
    
    if (!firmUsers || firmUsers.length === 0) {
      // Business owner - redirect
      router.push("/dashboard")
      return
    }
  }
  checkWorkspace()
}, [])
```

**Recommended:** **Option B** (Access Control Fix) + **Option A** (Sidebar Guard) for defense in depth.

---

### Correct Long-Term Fix (Routing Separation)

**Architectural Solution:**

1. **Separate Routes for Business Owners:**
   - Create `/business/accounting/periods` for business owners
   - Keep `/accounting/periods` for accountant firm users only

2. **Workspace-Specific Sidebars:**
   - Retail sidebar → `/business/accounting/periods` (if needed)
   - Accounting sidebar → `/accounting/periods` (accountant only)

3. **Access Control Enhancement:**
   - `resolveAccess()` should check user type (business owner vs accountant)
   - Reject business owners from `/accounting/*` routes
   - Allow accountant firm users only

4. **API Context:**
   - Business owner routes use `business_id` only
   - Accountant routes use `business_id` + `firm_id` + `client_id`

**Migration Path:**
1. Implement access control fix (Option B)
2. Add sidebar guard (Option A)
3. Create business owner period page (if needed)
4. Update sidebar links to workspace-specific routes

---

## SUMMARY

| Question | Answer |
|----------|--------|
| **Why can Retail reach Accountant routes?** | Missing workspace boundary enforcement at page/access control level |
| **Is it intentional?** | ❌ **NO** - Architectural violation |
| **What rule is violated?** | Workspace separation: `/accounting/*` should be accountant-only |
| **Minimal fix?** | Access control guard + Sidebar conditional rendering |
| **Long-term fix?** | Separate routes for business owners vs accountants |

---

**END OF INVESTIGATION**
