# Multi-Store Permission System Fix

## Summary

This document outlines the comprehensive fix for the Finza Retail multi-store permission system, ensuring Admins have global access while store users remain restricted to their assigned stores.

## Key Changes

### 1. Role-Based Store Context Helper (`lib/storeContext.ts`)

Created `getEffectiveStoreId` and `getEffectiveStoreIdClient` functions that:
- **Admin/Owner**: Can work in global mode (null store_id) or filter by selected store
- **Manager/Cashier**: Always locked to their assigned store_id

### 2. Backend API Routes Updated

#### `app/api/sales-history/list/route.ts`
- Uses `getEffectiveStoreId` for role-based filtering
- Admin: null = global mode (all sales), store_id = filtered view
- Manager: Always filtered by assigned store

#### `app/api/sales/create/route.ts`
- Added role validation to enforce store restrictions
- Manager/Cashier can only create sales for their assigned store
- Admin can create sales for any store

#### `app/api/reports/cash-office/route.ts`
- Uses `getEffectiveStoreId` for role-based session filtering
- Admin: Can see all sessions or filter by store
- Manager: Only sees sessions for assigned store

### 3. Frontend Components Updated

#### `components/StoreSwitcher.tsx`
- Admin: Can select "All Stores" (global mode) or specific store
- Manager/Cashier: No selector shown, auto-locked to assigned store
- Uses `shouldShowStoreSelector` and `canAccessGlobalMode` helpers

#### `app/sales-history/page.tsx`
- Uses `getEffectiveStoreIdClient` for role-based filtering
- Admin: Can view all sales (global mode) or filter by store
- Manager: Only sees sales for assigned store

#### `app/settings/registers/page.tsx`
- Uses `getEffectiveStoreIdClient` for role-based register filtering
- Admin: Can see all registers or filter by store
- Manager: Only sees registers for assigned store

### 4. Database Migration

#### `supabase/migrations/031_backfill_store_id.sql`
- Backfills null `store_id` in:
  - `sales` table (from `users.store_id`)
  - `sale_items` table (from parent `sales.store_id`)
  - `registers` table (from `users.store_id` or `cashier_sessions`)
  - `cashier_sessions` table (from `registers.store_id`)

## Role Behavior

### Admin/Owner
- ✅ Can access ALL stores
- ✅ Can view ALL sales, inventory, registers, staff, reports
- ✅ Can work in global mode (no store filter)
- ✅ Store selector shows all stores with "All Stores" option
- ✅ Can create sales for any store
- ✅ Can manage registers for any store

### Store Manager
- ✅ Access limited to assigned store
- ✅ Can only view their store's dashboards, products, sales, reports
- ✅ Cannot view global data
- ✅ Store selector is hidden (auto-locked to assigned store)
- ✅ Can only create sales for assigned store
- ✅ Can only manage registers for assigned store

### Cashier
- ✅ Access restricted to POS terminal + register operations
- ✅ Cannot see admin dashboards, reports, or manage products
- ✅ Must only see assigned store
- ✅ Store selector is hidden (auto-locked to assigned store)
- ✅ Can only create sales for assigned store

## Implementation Details

### Store Context Resolution

```typescript
// Server-side (API routes)
const effectiveStoreId = await getEffectiveStoreId(
  supabase,
  userId,
  businessId,
  selectedStoreId // from request params
)

// Client-side (React components)
const effectiveStoreId = getEffectiveStoreIdClient(
  userRole,
  selectedStoreId, // from session storage
  userStoreId // from database
)
```

### Query Filtering Pattern

```typescript
// Admin: null = global mode (no filter), store_id = filter by store
// Manager/Cashier: Always filter by assigned store
let query = supabase.from("table").select("*").eq("business_id", businessId)

if (effectiveStoreId) {
  query = query.eq("store_id", effectiveStoreId)
}
// If effectiveStoreId is null and user is admin, no filter = global mode
```

## Testing Checklist

- [ ] Admin can view all stores in selector
- [ ] Admin can select "All Stores" (global mode)
- [ ] Admin can filter by specific store
- [ ] Manager sees only assigned store (no selector)
- [ ] Cashier sees only assigned store (no selector)
- [ ] Manager cannot create sales for other stores
- [ ] Cashier cannot create sales for other stores
- [ ] Sales history shows correct data based on role
- [ ] Registers list shows correct data based on role
- [ ] Reports filter correctly based on role
- [ ] Migration backfills null store_id correctly

## Next Steps

1. Run migration: `supabase/migrations/031_backfill_store_id.sql`
2. Test admin global mode functionality
3. Test manager/cashier store restrictions
4. Verify all queries respect role-based filtering
5. Update remaining pages that need role-based store context (if any)

## Files Modified

- `lib/storeContext.ts` (NEW)
- `app/api/sales-history/list/route.ts`
- `app/api/sales/create/route.ts`
- `app/api/reports/cash-office/route.ts`
- `components/StoreSwitcher.tsx`
- `app/sales-history/page.tsx`
- `app/settings/registers/page.tsx`
- `supabase/migrations/031_backfill_store_id.sql` (NEW)

## Notes

- Admin global mode (null store_id) allows viewing all data without filtering
- Store users are always restricted to their assigned store
- All sales must have a store_id (never null except in rare admin cases)
- Store selector is only visible to admins/owners

