# Refund Authorization and Supervisor Override - Current Behavior Analysis

## 1. Refund Initiation

### File: `lib/hooks/useRefund.ts` (lines 20-86)

**Who can initiate refunds:**
- Any authenticated user can call `requestRefund()` function
- Access to sales history page is controlled separately:
  - File: `app/sales-history/page.tsx` (lines 217-221)
  - Cashiers are redirected to `/pos` (cannot access sales history)
  - Only `owner`, `admin`, `manager`, `employee` roles can access sales history (via `hasAccessToCashOffice()` check on line 224)

**Enforcement location:**
- Sales history page: `app/sales-history/page.tsx` (line 224)
- Uses `hasAccessToCashOffice()` from `lib/userRoles.ts` (lines 39-47)

**Refund initiation flow:**
1. User clicks refund button on sales history page
2. `requestRefund(targetSaleId)` is called
3. Function gets current authenticated user: `supabase.auth.getUser()` (line 26)
4. Sets `cashierId = user.id` (line 71 or 78)
5. Opens override modal with `cashierId` prop

## 2. Actor Identification

### File: `lib/hooks/useRefund.ts` (lines 70-72, 77-78)

**"Acting user" (cashier_id) is determined by:**
- The currently authenticated Supabase user session
- Retrieved via `supabase.auth.getUser()` (line 26)
- Stored as `cashierId = user.id` (lines 71, 78)

**Identity source:**
- Supabase authentication session (`supabase.auth.getUser()`)
- NOT from POS session, NOT from cashier session
- NOT from the sale's original cashier
- The `cashier_id` passed to the API is ALWAYS the authenticated user who clicked the refund button

## 3. Override Approval

### File: `app/api/override/refund-sale/route.ts` (lines 29-128)

**Approving user authentication:**
- Lines 30-40: Supervisor credentials are verified using `supabaseAnon.auth.signInWithPassword()`
- Line 42: `supervisorId = authResponse.data.user.id`
- The supervisor ID is extracted from the authenticated user returned by Supabase Auth

**Approving user role determination:**
- Lines 90-118: Role is determined AFTER identity check
- First checks if supervisor is business owner (lines 91-97)
- If not owner, queries `business_users` table (lines 102-115)
- Role is stored in `supervisorRole` variable

**Comparison with acting user:**
- YES, approving user IS compared to acting user
- File: `app/api/override/refund-sale/route.ts` (lines 44-50)
- Comparison: `if (supervisorId === cashier_id)`
- Fields compared: `user.id` (from Supabase Auth)
- This is a direct user_id comparison, NOT role-based
- This check happens BEFORE role/authority validation

## 4. Error Condition

### File: `app/api/override/refund-sale/route.ts` (lines 44-50)

**Exact condition that triggers "Cashier cannot override themselves":**
```typescript
if (supervisorId === cashier_id) {
  return NextResponse.json(
    { error: "Cashier cannot override themselves." },
    { status: 403 }
  )
}
```

**When this check runs:**
- Lines 44-50: This check runs IMMEDIATELY after supervisor authentication (line 42)
- BEFORE sale lookup (line 66)
- BEFORE business owner check (line 91)
- BEFORE role determination (lines 99-118)
- BEFORE authority validation (lines 120-128)

**Does this check run for admin/manager?**
- YES - This check runs for ALL users, regardless of role
- The identity comparison (`supervisorId === cashier_id`) happens BEFORE any role checks
- Even if the supervisor has admin/manager role, if their `user.id` matches the `cashier_id`, the error is returned
- Role and authority validation (lines 120-128) never executes if this check fails

## 5. Role vs Session

### File: `app/api/override/refund-sale/route.ts`

**Does refund logic rely on POS session identity?**
- NO - The refund logic does NOT check POS session or cashier session
- The `cashier_id` is derived from the authenticated Supabase user (line 20 in request body, set by client code)
- No queries to `cashier_sessions` table for identity (cashier_sessions is only queried later for updating supervised_actions_count on lines 146-162)

**Role resolution at this point:**
- Role resolution is store-aware (queries `business_users` table with `business_id` filter on line 105)
- However, the identity comparison (`supervisorId === cashier_id`) happens BEFORE role resolution
- Store context is not checked in the identity comparison
- The comparison is purely: authenticated user ID === cashier_id (from request body)

## Summary of Control Flow

1. **Client-side (`lib/hooks/useRefund.ts`):**
   - Gets authenticated user: `user = await supabase.auth.getUser()`
   - Sets `cashierId = user.id`
   - Opens modal with `cashierId` prop

2. **Modal (`components/RefundOverrideModal.tsx`):**
   - Receives `cashierId` prop
   - User enters supervisor email/password
   - Sends to API: `{ supervisor_email, supervisor_password, sale_id, cashier_id }`

3. **API Route (`app/api/override/refund-sale/route.ts`):**
   - Line 42: `supervisorId = authResponse.data.user.id` (from credentials)
   - Lines 44-50: **IDENTITY CHECK FIRST** - `if (supervisorId === cashier_id)` → Error if match
   - Lines 66-77: Sale lookup
   - Lines 90-118: Role determination (only if identity check passes)
   - Lines 120-128: Authority validation (only if identity check passes)

## Key Finding

The "Cashier cannot override themselves" error is triggered by a user_id comparison that happens BEFORE any role or authority checks. If an admin user initiates a refund (making their user_id the `cashier_id`) and then enters their own credentials in the override modal (making their user_id the `supervisorId`), the comparison `supervisorId === cashier_id` will be true, triggering the error regardless of their admin role.




