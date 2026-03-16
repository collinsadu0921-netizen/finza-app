# Audit Report: Add External Client (Books-Only) Failure

**Date**: 2024-12-19  
**Scope**: Accounting Workspace - Engagement Creation Flow  
**Objective**: Identify root causes of "Failed to create engagement" error and UI showing only general/POS clients

---

## Executive Summary

**Critical Finding**: Two blocking issues prevent engagement creation:

1. **P0: Missing RLS INSERT Policy** - `firm_client_engagements` table has no INSERT RLS policy, causing all engagement creation attempts to fail with RLS violation.
2. **P1: Businesses Search Returns All Types** - Search API returns ALL businesses (general/POS/service), not filtering for books-only clients suitable for accounting engagements.

---

## A) Trace Map (End-to-End Flow)

### Flow: Add External Client (Books-Only) → Create Engagement

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. UI: /app/accounting/firm/clients/add/page.tsx                │
│    - Line 89: Calls /api/businesses/search?q=...                │
│    - Line 92: Sets businesses list (NO FILTERING)               │
│    - Line 139: POST /api/accounting/firm/engagements            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. API: /app/api/businesses/search/route.ts                     │
│    - Line 33-38: SELECT * FROM businesses WHERE name ILIKE ...  │
│    - ISSUE: No filter for books-only (industry IS NULL)         │
│    - Returns: ALL businesses (general/POS/service)               │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. API: /app/api/accounting/firm/engagements/route.ts           │
│    - Line 25: createSupabaseServerClient() [USES ANON KEY]      │
│    - Line 123-135: INSERT INTO firm_client_engagements          │
│    - ISSUE: No INSERT RLS policy exists                         │
│    - BLOCKED: RLS policy violation                              │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Database: firm_client_engagements table                      │
│    - Migration 146: Only SELECT policies created                │
│    - Comment says: "INSERT/UPDATE/DELETE will be added later"   │
│    - STATUS: Never added                                        │
│    - RLS ENABLED: Yes, but no INSERT policy                     │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Error Response: "Failed to create engagement"                │
│    - Line 137-142: createError captured but generic message     │
│    - Real error: RLS policy violation (not logged)              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files & Functions

| Layer | File | Function/Lines | Issue |
|-------|------|----------------|-------|
| **UI** | `app/accounting/firm/clients/add/page.tsx` | Lines 87-97, 139-149 | No filtering of business types |
| **API** | `app/api/businesses/search/route.ts` | Lines 33-38 | Returns all businesses |
| **API** | `app/api/accounting/firm/engagements/route.ts` | Lines 25, 123-135 | Uses anon key (RLS applies) |
| **DB** | `supabase/migrations/146_firm_client_engagements_step8_8_batch2.sql` | Lines 169-197 | Only SELECT policies, no INSERT |
| **Lib** | `lib/supabaseServer.ts` | Lines 4-29 | Returns client with ANON KEY (not service role) |

---

## B) Failure Evidence

### Error Location

**File**: `app/api/accounting/firm/engagements/route.ts`  
**Lines**: 137-142

```typescript
if (createError) {
  console.error("Error creating engagement:", createError)
  return NextResponse.json(
    { error: "Failed to create engagement" },
    { status: 500 }
  )
}
```

**Issue**: Generic error message hides the real RLS violation error.

### Actual Failure Points

#### 1. RLS Policy Violation (PRIMARY CAUSE)

**Table**: `firm_client_engagements`  
**Migration**: `146_firm_client_engagements_step8_8_batch2.sql`

```sql
-- Line 169-197: Only SELECT policies exist
CREATE POLICY "Firm users can view their firm engagements" ... FOR SELECT
CREATE POLICY "Business owners can view their business engagements" ... FOR SELECT

-- Line 195-197: Comment says INSERT will be added later
-- Note: INSERT/UPDATE/DELETE policies will be added in later steps as needed
-- For now, we rely on API-level enforcement
```

**Problem**: RLS is ENABLED on the table (`ALTER TABLE firm_client_engagements ENABLE ROW LEVEL SECURITY`), but no INSERT policy exists. This means:
- ✅ SELECT works (has policies)
- ❌ INSERT fails (no policy = default DENY)
- ❌ UPDATE fails (no policy)
- ❌ DELETE fails (no policy)

**Error**: Supabase returns an RLS policy violation error (typically `new row violates row-level security policy for table "firm_client_engagements"`).

#### 2. Anon Key Usage (SECONDARY ISSUE)

**File**: `lib/supabaseServer.ts`

```typescript
export async function createSupabaseServerClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,  // <-- ANON KEY, NOT SERVICE ROLE
    // ...
  )
}
```

**Problem**: Anon key respects RLS policies. Even if an INSERT policy existed, it would need to properly check firm membership.

**Note**: Using service role key would bypass RLS, but that's not recommended for security. The correct fix is to add proper RLS INSERT policy.

#### 3. Business Search Returns All Types

**File**: `app/api/businesses/search/route.ts`

```typescript
const { data: businesses, error } = await supabase
  .from("businesses")
  .select("id, name, industry")
  .ilike("name", `%${query}%`)
  .limit(20)
  .order("name", { ascending: true })
```

**Problem**: No filter for books-only businesses. Books-only clients have `industry = null` (per `/api/firm/accounting-clients/route.ts` line 129), but search returns all businesses including:
- General businesses (industry = 'retail', 'service', 'professional', 'logistics')
- POS businesses (same industries)
- Books-only businesses (industry IS NULL)

---

## C) Root Cause Checklist

| Issue | Status | Evidence | Impact |
|-------|--------|----------|--------|
| **Missing INSERT RLS Policy** | ✅ **CONFIRMED** | Migration 146 only has SELECT policies | **P0 - Blocks all engagement creation** |
| **createSupabaseServerClient uses anon key** | ✅ **CONFIRMED** | `lib/supabaseServer.ts` line 9 | P1 - Anon key respects RLS |
| **Business search doesn't filter books-only** | ✅ **CONFIRMED** | `app/api/businesses/search/route.ts` line 33-38 | P1 - Shows wrong businesses |
| Firm context missing in request | ❌ **REFUTED** | `firm_id` is passed correctly (line 143) | Not an issue |
| business_id vs client_user_id mismatch | ❌ **REFUTED** | Uses `client_business_id` correctly (line 127) | Not an issue |
| Wrong engagement table columns | ❌ **REFUTED** | Columns match schema (lines 125-132) | Not an issue |
| Missing required fields | ❌ **REFUTED** | All required fields present | Not an issue |
| Engaging a user instead of business | ❌ **REFUTED** | Uses `client_business_id` (business, not user) | Not an issue |
| Creating POS user instead of business | ❌ **REFUTED** | Uses `businesses` table correctly | Not an issue |
| Onboarding not creating firm membership | ❌ **REFUTED** | Separate issue, not related | Not an issue |
| Service role key missing | ⚠️ **NOT APPLICABLE** | Should use RLS policy, not service role bypass | Would work but insecure |

---

## D) Fix Plan (Prioritized)

### P0: Missing RLS INSERT Policy (CRITICAL - Blocks Engagement Creation)

**File**: Create new migration: `supabase/migrations/155_add_firm_client_engagements_insert_policy.sql`

**Change**: Add INSERT RLS policy allowing Partners and Seniors to create engagements

```sql
-- ============================================================================
-- MIGRATION: Add INSERT RLS policy for firm_client_engagements
-- ============================================================================
-- Problem: No INSERT policy exists, blocking all engagement creation
-- Solution: Add policy allowing Partners/Seniors to create engagements
-- ============================================================================

-- Helper function to check if user is Partner or Senior in firm
-- (Uses existing helper from migration 152)
-- NOTE: Assumes check_user_is_partner_or_senior_in_firm() exists
-- If not, use check_user_is_partner_in_firm() OR check via accounting_firm_users

-- Policy: Partners and Seniors can create engagements for their firm
DROP POLICY IF EXISTS "Partners and Seniors can create engagements" ON firm_client_engagements;

CREATE POLICY "Partners and Seniors can create engagements"
  ON firm_client_engagements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    )
  );

COMMENT ON POLICY "Partners and Seniors can create engagements" ON firm_client_engagements IS 
  'Allows Partners and Seniors to create new firm-client engagements. Enforces role-based access control.';
```

**Validation**:
1. Run migration
2. Attempt to create engagement via UI
3. Check engagement is created successfully
4. Verify error logs no longer show RLS violations

---

### P1: Improve Error Logging (HIGH - Better Debugging)

**File**: `app/api/accounting/firm/engagements/route.ts`

**Change**: Log actual error details for debugging

```typescript
// Line 137-142: Replace generic error with detailed logging
if (createError) {
  console.error("Error creating engagement:", {
    error: createError,
    message: createError.message,
    code: createError.code,
    details: createError.details,
    hint: createError.hint,
    firm_id,
    business_id,
    user_id: user.id,
  })
  
  // Return more specific error message
  const errorMessage = createError.message || "Failed to create engagement"
  return NextResponse.json(
    { 
      error: errorMessage,
      code: createError.code,
      details: createError.details,
    },
    { status: 500 }
  )
}
```

**Validation**:
1. Attempt to create engagement
2. Check server logs for detailed error information
3. Verify error response includes code/details

---

### P1: Filter Businesses Search for Books-Only (HIGH - UX Issue)

**Option A: Filter in Search API** (Recommended)

**File**: `app/api/businesses/search/route.ts`

**Change**: Add optional filter parameter for books-only businesses

```typescript
// Line 25-30: Add books_only parameter
const { searchParams } = new URL(request.url)
const query = searchParams.get("q")
const booksOnly = searchParams.get("books_only") === "true"

// Line 33-38: Add filter condition
let businessesQuery = supabase
  .from("businesses")
  .select("id, name, industry")
  .ilike("name", `%${query}%`)

if (booksOnly) {
  businessesQuery = businessesQuery.is("industry", null)
}

const { data: businesses, error } = await businessesQuery
  .limit(20)
  .order("name", { ascending: true })
```

**Option B: Filter in UI** (Alternative)

**File**: `app/accounting/firm/clients/add/page.tsx`

**Change**: Filter businesses client-side after search

```typescript
// Line 87-97: After receiving businesses, filter for books-only
const searchBusinesses = async () => {
  try {
    const response = await fetch(`/api/businesses/search?q=${encodeURIComponent(searchQuery)}`)
    if (response.ok) {
      const data = await response.json()
      // Filter for books-only (industry IS NULL)
      const booksOnlyBusinesses = (data.businesses || []).filter(
        (b: Business) => b.industry === null
      )
      setBusinesses(booksOnlyBusinesses)
    }
  } catch (err) {
    console.error("Error searching businesses:", err)
  }
}
```

**Recommendation**: Use Option A (server-side filter) for better performance and clarity.

**Validation**:
1. Search for businesses in Add Client UI
2. Verify only books-only businesses (industry IS NULL) are shown
3. Verify general/POS businesses are excluded

---

### P2: Add UPDATE Policy (MEDIUM - Future Needs)

**File**: Create new migration or add to migration 155

**Change**: Add UPDATE policy for engagement status changes

```sql
-- Policy: Partners/Seniors can update engagements (e.g., accept, suspend, terminate)
DROP POLICY IF EXISTS "Partners and Seniors can update engagements" ON firm_client_engagements;

CREATE POLICY "Partners and Seniors can update engagements"
  ON firm_client_engagements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    )
  );
```

---

### P2: Improve UI Labels (LOW - UX Enhancement)

**File**: `app/accounting/firm/clients/add/page.tsx`

**Change**: Add clarification that only books-only businesses can be engaged

```typescript
// Line 226: Update label
<label
  htmlFor="business_search"
  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
>
  Select Business (Books-Only) <span className="text-red-500">*</span>
</label>

// Add helper text
<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
  Only books-only businesses (no service/POS features) can be engaged as external clients.
</p>
```

---

## E) Implementation Steps

### Step 1: Create Migration (P0 Fix)

1. Create file: `supabase/migrations/155_add_firm_client_engagements_insert_policy.sql`
2. Add INSERT policy as shown in Fix Plan P0
3. Run migration: `supabase migration up`

### Step 2: Improve Error Logging (P1)

1. Update `app/api/accounting/firm/engagements/route.ts` with detailed error logging
2. Test error handling with invalid data

### Step 3: Filter Business Search (P1)

1. Update `app/api/businesses/search/route.ts` to filter books-only businesses
2. Update UI to pass `books_only=true` parameter (or filter client-side)
3. Test that only books-only businesses appear in search

### Step 4: Add UPDATE Policy (P2)

1. Add UPDATE policy to migration 155 or create new migration
2. Test engagement status updates

### Step 5: Verify End-to-End

1. ✅ Navigate to `/accounting/firm/clients/add`
2. ✅ Search for businesses - should only show books-only
3. ✅ Select a business
4. ✅ Create engagement - should succeed (no RLS error)
5. ✅ Verify engagement appears in firm dashboard

---

## F) Testing Checklist

- [ ] P0: Engagement creation succeeds (no RLS error)
- [ ] P0: Error logs show detailed error information if creation fails
- [ ] P1: Business search only returns books-only businesses (industry IS NULL)
- [ ] P1: General/POS businesses are excluded from search
- [ ] P2: Engagement status can be updated (if UPDATE policy added)
- [ ] Integration: Full flow from UI to database works end-to-end
- [ ] Security: Only Partners/Seniors can create engagements (RLS enforced)

---

## G) Additional Notes

### Why Not Use Service Role Key?

Using service role key would bypass RLS and "fix" the issue, but:
- ❌ **Security Risk**: Bypasses all RLS policies
- ❌ **No Role Enforcement**: Would allow any user to create engagements
- ❌ **Bad Practice**: RLS is the correct security layer

**Recommendation**: Always use RLS policies for security. Service role key should only be used for admin/system operations, not user-facing APIs.

### Books-Only Business Identification

Books-only businesses are identified by `industry IS NULL`:
- Source: `/api/firm/accounting-clients/route.ts` line 129: `industry: null, // Books-only (no service/POS)`
- This is the convention used when creating external clients
- Search API should filter for this condition

### Related Files to Review

- `app/api/firm/accounting-clients/route.ts` - Creates external clients (different flow)
- `lib/firmEngagements.ts` - Engagement helper functions
- `lib/firmAuthority.ts` - Authority checks
- `lib/firmActivityLog.ts` - Activity logging

---

## Summary

**Root Cause**: Missing RLS INSERT policy on `firm_client_engagements` table blocks all engagement creation attempts.

**Secondary Issue**: Business search API doesn't filter for books-only businesses, showing irrelevant results.

**Fix**: Add RLS INSERT policy + filter business search for books-only clients.

**Priority**: P0 (RLS policy) must be fixed immediately. P1 (search filter) can be done in parallel.