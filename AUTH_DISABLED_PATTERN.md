# Authorization Disabled Pattern

This document describes the pattern used to disable authorization checks across the system.

## Pattern Applied

All authorization checks have been commented out with the marker:
`// AUTH DISABLED FOR DEVELOPMENT`

## Changes Made

1. **User Authentication Checks**: Commented out but kept structure
   ```ts
   // AUTH DISABLED FOR DEVELOPMENT - Keep login check only
   // if (!user) {
   //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
   // }
   ```

2. **Business Ownership Checks**: Commented out
   ```ts
   // AUTH DISABLED FOR DEVELOPMENT - Bypass business ownership check
   // const business = await getCurrentBusiness(supabase, user.id)
   // if (!business || business.id !== business_id) {
   //   return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
   // }
   ```

3. **Business ID Filters**: Removed from queries
   ```ts
   // AUTH DISABLED FOR DEVELOPMENT - Removed business_id filter
   // .eq("business_id", business.id)
   ```

4. **Business ID Ownership Checks**: Commented out
   ```ts
   // AUTH DISABLED FOR DEVELOPMENT - Bypass business_id ownership check
   // if (invoiceCheck.business_id !== business.id) {
   //   return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
   // }
   ```

## Files Modified

### Critical Routes (Fully Updated)
- `app/api/payments/create/route.ts`
- `app/api/invoices/create/route.ts`
- `app/api/invoices/[id]/route.ts` (GET, PUT, DELETE)
- `app/api/invoices/[id]/send/route.ts`
- `app/api/invoices/list/route.ts`
- `app/api/expenses/create/route.ts`
- `app/api/bills/create/route.ts`
- `app/api/credit-notes/create/route.ts`

### Remaining Routes (Need Same Pattern)
All other API routes in `app/api/**/route.ts` need the same pattern applied:
- Remove `getCurrentBusiness` checks
- Remove `business.id !== business_id` checks
- Remove `.eq("business_id", business.id)` filters
- Comment out all `Unauthorized` returns (401/403)

## Frontend Changes Needed

Remove role-based conditionals:
```tsx
// Before:
{userRole === "owner" && <Button>...</Button>}

// After:
<Button>...</Button>
```

## Re-enabling Authorization

To re-enable, uncomment all lines marked with `// AUTH DISABLED FOR DEVELOPMENT`


