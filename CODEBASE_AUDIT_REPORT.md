# Codebase Audit Report - Read-Only Analysis

**Date**: Generated from codebase analysis  
**Purpose**: Explain WHY issues exist and which assumptions caused them  
**Status**: READ-ONLY - No fixes proposed

---

## 1. Currency Issues: GHS Displayed for Kenyan (KE) Business

### Problem
Retail Analytics, VAT Report, and Inventory forms show GHS for a Kenyan (KE) business instead of KSh.

### Root Causes

#### 1.1 Hardcoded "GHS" in Analytics Display
**Location**: `app/admin/retail/analytics/page.tsx` (lines 888, 900, 906, 912, 924)

**Issue**: Currency symbol is hardcoded as "GHS" string literal instead of using the business currency hook.

```typescript
// Line 888 - Hardcoded GHS
GHS {kpiData.totalSales.toLocaleString(...)}

// Should use:
const { format } = useBusinessCurrency()
format(kpiData.totalSales)
```

**Assumption**: The codebase was initially built for Ghana market only, and currency formatting was added later without updating all display locations.

**Why it exists**: 
- The `useBusinessCurrency()` hook exists and is imported (line 13) but not used for KPI cards
- Only used for inventory value display (line 1147)
- Incomplete migration from hardcoded currency to dynamic currency system

#### 1.2 Database Default: GHS in Migration
**Location**: `supabase/migrations/051_fix_all_table_structures.sql` (line 178, 195)

**Issue**: `default_currency` column defaults to 'GHS':

```sql
default_currency TEXT DEFAULT 'GHS'
```

**Assumption**: System was designed for Ghana market first, with multi-currency added later.

**Why it exists**:
- Migration 051 sets GHS as default for all new businesses
- Migration 037 also sets GHS default (line 20)
- No country-based currency detection during business creation
- Kenyan businesses created before currency was set inherit GHS default

#### 1.3 Currency Sources Hierarchy (Not Applied Consistently)

**Currency Resolution Chain**:
1. `businesses.default_currency` (database column)
2. `useBusinessCurrency()` hook (reads from business table)
3. `lib/currency.ts` - `getCurrencySymbol()` (maps code to symbol)
4. `lib/money.ts` - `formatMoney()` (formats with symbol)

**Problem**: Not all components use this chain:
- ✅ VAT Report uses `useBusinessCurrency()` correctly (line 13)
- ✅ Inventory Dashboard uses `useBusinessCurrency()` correctly (line 13)
- ❌ Retail Analytics hardcodes "GHS" in KPI cards
- ❌ Some reports hardcode "GHS" (see `app/reports/vat/diagnostic/page.tsx` lines 558, 562, etc.)

**Assumption**: Currency system was implemented incrementally, and some components were never migrated.

#### 1.4 KSh Applied After Creation

**Why KSh is only applied after creation**:

1. **Onboarding Flow**: 
   - Business created → `default_currency` = NULL or 'GHS' (from migration default)
   - User sets currency in Business Profile → `default_currency` = 'KES'
   - But existing displays may have cached or hardcoded values

2. **No Country-Based Default**:
   - `app/onboarding/page.tsx` doesn't set currency based on country
   - `app/business-setup/page.tsx` doesn't set currency
   - Currency must be manually set in Business Profile

3. **Migration Timing**:
   - Businesses created before currency system existed have NULL or GHS
   - Migration 126 (`126_remove_ghana_defaults.sql`) may have removed defaults, but existing businesses weren't updated

**Assumption**: Currency was treated as a user preference to be set manually, not derived from business country.

---

## 2. Retail Analytics Behavior

### 2.1 Data Flow: UI → API → DB

**Flow Path**:
1. **UI**: `app/admin/retail/analytics/page.tsx`
   - `loadAnalytics()` called on mount (line 238)
   - Uses `useBusinessCurrency()` hook (line 13) - but doesn't use it for KPI cards

2. **Data Loading** (lines 238-664):
   - Queries `sales` table directly (line 265)
   - Filters by `business_id`, `payment_status = "paid"`, date range
   - Filters by `store_id` if `storeFilter` is set (line 286)

3. **No API Layer**:
   - Analytics page queries database directly via Supabase client
   - No intermediate API route (`/api/analytics/...`)
   - All calculations done client-side

4. **Database Queries**:
   - `sales` table: amount, vat, nhil, getfund, covid (line 267)
   - `sale_items` table: qty, price, cogs (line 410)
   - `cashier_sessions` table: register sessions (line 668)

**Assumption**: Analytics was built as a direct database query page, not as an API-backed feature.

### 2.2 Register Scoping: Why "Cashier1" Appears

**Location**: `app/admin/retail/analytics/page.tsx` (lines 666-741)

**Issue**: Analytics shows register names from `cashier_sessions.registers(name)` join (line 671).

**Why it's scoped to a register**:
1. **Register-Based Sessions**: System uses register-based sessions (not user-based)
2. **Session Filtering**: `loadRegisterSessions()` filters by `store_id` if `storeFilter` is set (line 678)
3. **Register Name Display**: Line 729 shows `register_name` from joined `registers` table
4. **Default Register**: If only one register exists, it's named "Main Register" (from onboarding)
5. **User-Created Registers**: If user creates "Cashier1", that name appears in analytics

**Assumption**: Register names are user-defined and displayed as-is in analytics, without normalization.

**Why register naming affects display**:
- Register name is stored in `registers.name` column
- Analytics joins `cashier_sessions` → `registers` to get name (line 671)
- No validation or standardization of register names
- User can name register anything (e.g., "Cashier1", "Register 1", "Main Register")

### 2.3 Totals Calculation

**Location**: `app/admin/retail/analytics/page.tsx` (lines 410-460)

**Sales Total** (line 436):
```typescript
const revenue = Number(item.qty || 0) * Number(item.price || 0)
totalRevenue += revenue
```
- Calculated from `sale_items`: `qty * price`
- Summed across all sale items in date range

**VAT Total** (line 445):
```typescript
totalVat += Number(sale.vat || 0)
```
- Summed from `sales.vat` column (pre-calculated during sale creation)

**COGS** (line 438):
```typescript
totalCogs += Number(item.cogs || 0)
```
- From `sale_items.cogs` column (cost of goods sold per item)

**Gross Profit** (line 449):
```typescript
const grossProfit = totalRevenue - totalCogs
```
- Calculated as: Revenue - COGS

**Assumption**: All financial calculations are done client-side from raw database values, not from a ledger or accounting system.

**Why this approach**:
- No separate accounting/ledger system
- Sales table stores pre-calculated tax amounts
- COGS stored per sale item (not calculated from inventory movements)
- Real-time aggregation from transaction data

---

## 3. VAT Leakage: Ghana Tax Components for KE Business

### 3.1 Why NHIL, GETFund, COVID Appear for KE Business

**Root Cause**: Ghana tax calculation is hardcoded in the tax engine, regardless of business country.

**Location**: `lib/vat.ts` (lines 90-132)

**Ghana Tax Formula** (hardcoded):
```typescript
const nhil = taxable_amount * 0.025 // 2.5%
const getfund = taxable_amount * 0.025 // 2.5%
const covid = taxable_amount * 0.01 // 1%
const vat_base = taxable_amount + nhil + getfund + covid
const vat = vat_base * 0.15 // 15% VAT
```

**Also in**: `lib/ghanaTaxEngine.ts` (lines 37-84)

**Assumption**: System was built exclusively for Ghana tax regime, with no country-based tax engine selection.

**Why it exists**:
1. **Single Tax Engine**: Only one tax calculation file exists (`lib/vat.ts`, `lib/ghanaTaxEngine.ts`)
2. **No Country Check**: Tax calculation functions don't check `business.address_country` or business country
3. **Hardcoded Rates**: Tax rates (2.5%, 2.5%, 1%, 15%) are hardcoded constants
4. **Used Everywhere**: POS, invoices, sales all use `calculateCartTaxes()` which applies Ghana taxes

**Where Ghana taxes are injected**:

1. **POS Cart Calculation** (`app/(dashboard)/pos/page.tsx` line 1105-1211):
   - `calculateCartTaxes()` called with `vatInclusive = true` (line 1129)
   - Returns `nhil`, `getfund`, `covid`, `vat` in totals

2. **Sale Creation** (`app/api/sales/create/route.ts`):
   - Tax amounts stored in `sales` table: `nhil`, `getfund`, `covid`, `vat` columns
   - These columns exist for all businesses, regardless of country

3. **VAT Report** (`app/reports/vat/page.tsx` lines 185-196):
   - Sums `nhil`, `getfund`, `covid`, `vat` from sales table
   - Displays all four tax components

4. **Database Schema**: 
   - `sales` table has columns: `nhil`, `getfund`, `covid`, `vat`
   - These are always populated, even for non-Ghana businesses

**Assumption**: Database schema was designed for Ghana tax structure, and tax calculation was never made country-aware.

### 3.2 VAT Computation: UI vs API vs Ledger

**VAT is API-computed, not ledger-derived**:

1. **Calculation Location**: `lib/vat.ts` - `calculateCartTaxes()` function
2. **When Calculated**: 
   - **POS**: Client-side during cart updates (line 1105 in POS page)
   - **Sale Creation**: Server-side in `/api/sales/create/route.ts` (uses same function)
3. **Storage**: Calculated values stored in `sales` table columns
4. **No Ledger**: No separate ledger table that derives VAT from accounting entries

**Why UI-computed in POS**:
- Real-time cart updates require immediate tax calculation
- `useMemo` hook recalculates on cart changes (line 1105)
- Same calculation function used in API ensures consistency

**Why API-computed in Sale Creation**:
- Server-side validation and calculation
- Uses same `calculateCartTaxes()` function
- Stores results in database

**Assumption**: VAT is a transaction-level calculation, not an accounting ledger entry.

---

## 4. Register Onboarding Anomaly

### 4.1 When "Main Register" is Created

**Location**: `app/onboarding/retail/register.tsx` (lines 56-74)

**Creation Logic**:
```typescript
// If no registers exist, create one automatically
if (!registersData || registersData.length === 0) {
  const { data: newRegister } = await supabase
    .from("registers")
    .insert({
      business_id: businessId,
      store_id: activeStoreId,
      name: "Main Register"  // Hardcoded name
    })
}
```

**When it happens**:
1. User reaches onboarding step: "open_register"
2. `loadRegisters()` is called (line 36)
3. Queries registers for active store (lines 48-52)
4. If no registers found → auto-creates "Main Register" (line 57-66)
5. Auto-selects the newly created register (line 70)

**Assumption**: Every store needs at least one register, so system auto-creates one during onboarding.

### 4.2 Why User-Created Register Gets Renamed or Duplicated

**Issue**: User creates a register (e.g., "Cashier1"), but "Main Register" appears instead.

**Root Causes**:

1. **Auto-Creation Override**:
   - If user creates register before reaching onboarding step, onboarding still checks for registers
   - If query fails or returns empty (due to store_id mismatch), auto-creates "Main Register"
   - User's register may exist but not be linked to active store

2. **Store ID Mismatch**:
   - Registers are store-specific (`store_id` column)
   - Onboarding uses `activeStoreId` from session
   - If user created register for different store, it won't be found
   - System creates new "Main Register" for active store

3. **Register Selection Logic** (line 73):
   ```typescript
   setSelectedRegisterId(registersData[0].id)  // Selects first register
   ```
   - If multiple registers exist, selects first one alphabetically
   - If "Main Register" was created first, it's selected
   - User's "Cashier1" may exist but not be selected

**Assumption**: Register creation and selection logic assumes single register per store during onboarding.

### 4.3 Why Open Register Forces "Main Register"

**Location**: `app/sales/open-session/page.tsx` (lines 85-99)

**Register Loading**:
```typescript
let registersQuery = supabase
  .from("registers")
  .select("id, name, store_id")
  .eq("business_id", business.id)

if (storeIdForRegisters) {
  registersQuery = registersQuery.eq("store_id", storeIdForRegisters)
}

const { data: regs } = await registersQuery.order("name", { ascending: true })
```

**Why "Main Register" appears**:
1. **Alphabetical Ordering**: `order("name", { ascending: true")` (line 94)
2. **First Selection**: If "Main Register" exists, it appears first alphabetically
3. **No User Preference**: System doesn't remember which register user last used
4. **Auto-Creation**: If no registers exist, onboarding creates "Main Register"

**Assumption**: Register selection is alphabetical, with no user preference or "default register" concept.

**Files Involved**:
- `app/onboarding/retail/register.tsx` - Auto-creates "Main Register"
- `app/sales/open-session/page.tsx` - Loads and displays registers
- `app/(dashboard)/pos/page.tsx` - Uses selected register session

---

## 5. Product Visibility in POS

### 5.1 Product Creation → POS Loading Flow

**Product Creation**:
- Products created via Products page (`app/products/page.tsx`)
- Stored in `products` table with `business_id`
- Stock initialized in `products_stock` table with `store_id`

**POS Loading**:
**Location**: `app/(dashboard)/pos/page.tsx` (lines 494-664)

**Flow**:
1. `loadProductsForStore()` called (line 494)
2. Loads all products for business (lines 499-503):
   ```typescript
   .from("products")
   .select("...")
   .eq("business_id", businessId)
   ```
3. Loads stock from `products_stock` (lines 519-531):
   ```typescript
   .from("products_stock")
   .select("product_id, variant_id, stock, stock_quantity")
   .in("product_id", allProducts.map(p => p.id))
   .is("variant_id", null)  // Only base products
   .eq("store_id", storeId)  // Filter by store
   ```
4. Filters products by stock (lines 612-631):
   ```typescript
   .filter((p: Product) => {
     if (p.track_stock === false) return true  // Services always show
     if (!hasAnyStockRecords) return true  // New setup - show all
     if (productsWithVariants.has(p.id)) return true  // Variants always show
     return (p.stock || 0) > 0  // Only show if stock > 0
   })
   ```

### 5.2 Filters Applied

**Business ID Filter**: ✅ Applied (line 502)
- `eq("business_id", businessId)`
- Only shows products for current business

**Store Filter**: ✅ Applied (line 526-528)
- `eq("store_id", storeId)` if specific store selected
- If `storeId === 'all'`, aggregates stock across stores

**Location Filter**: ❌ Not applied
- No `location_id` or geographic filtering
- Products are business-scoped, not location-scoped

**Status Flags**: ✅ Applied (line 614)
- `track_stock === false` → Always shows (service items)
- `track_stock === true` → Only shows if `stock > 0`

### 5.3 Why Newly Created Products Don't Appear

**Root Causes**:

1. **Stock Requirement** (line 630):
   ```typescript
   return (p.stock || 0) > 0
   ```
   - Products with `stock = 0` are filtered out
   - New products may have no `products_stock` row yet
   - Or `products_stock.stock = 0` if not initialized

2. **Stock Record Missing**:
   - If `products_stock` row doesn't exist for active store, `stockMap[p.id]` is `undefined`
   - `stockMap[p.id] || 0` evaluates to `0`
   - Product is filtered out (line 630)

3. **Store-Specific Stock**:
   - Stock is store-specific (`products_stock.store_id`)
   - If product created but stock not initialized for active store, it won't appear
   - Product may exist for other stores but not current store

4. **Exception Cases** (lines 618-627):
   - ✅ `track_stock === false` → Shows (services)
   - ✅ `!hasAnyStockRecords` → Shows (new setup, no stock records yet)
   - ✅ `hasVariants` → Shows (variants have own stock)
   - ❌ Otherwise → Only if `stock > 0`

**Assumption**: POS only shows products that are available for sale (stock > 0), to prevent selling out-of-stock items.

**Why this causes issues**:
- Product creation may not initialize `products_stock` row
- Or initializes with `stock = 0`
- User expects to see product immediately after creation
- But POS filters it out until stock is added

---

## 6. Business Settings Visibility

### 6.1 Where Onboarding Business Data is Stored

**Database Table**: `businesses` table

**Columns** (from `supabase/migrations/037_business_profile_invoice_settings.sql`):
- `legal_name`, `trading_name`
- `address_street`, `address_city`, `address_region`, `address_country`
- `phone`, `whatsapp_phone`, `email`, `website`
- `tin` (Tax Identification Number)
- `logo_url`
- `default_currency`
- `start_date`

**Onboarding Storage**:
- `app/onboarding/page.tsx` - Main onboarding flow
- `app/onboarding/retail/profile.tsx` - Retail-specific profile step
- Data saved via `PUT /api/business/profile` (line 54 in `app/api/business/profile/route.ts`)

### 6.2 Why Not Visible or Editable After Onboarding

**Settings UI Exists**: ✅ `app/settings/business-profile/page.tsx`

**Why it may not be visible**:

1. **Route Access**:
   - Settings page exists at `/settings/business-profile`
   - May be hidden in navigation menu
   - Or requires specific permissions

2. **Data Loading** (lines 47-90):
   ```typescript
   const loadBusinessProfile = async () => {
     const response = await fetch("/api/business/profile")
     const { business: businessData } = await response.json()
     setFormData({...})  // Populates form
   }
   ```
   - ✅ Loads data from API
   - ✅ Populates form fields
   - ✅ Allows editing and saving

3. **API Endpoint**: ✅ `GET /api/business/profile` (line 5)
   - Returns all business profile fields (lines 23-44)
   - Includes `default_currency`, address fields, contact info

4. **Update Endpoint**: ✅ `PUT /api/business/profile` (line 54)
   - Updates business profile fields
   - Validates required fields during onboarding (lines 125-144)

**Why it might seem hidden**:

1. **Navigation Menu**: Settings link may not be prominently displayed
2. **Onboarding Context**: User may expect to edit in onboarding flow, not settings page
3. **Permission Check**: Settings page may have role-based access restrictions
4. **URL Path**: User may not know `/settings/business-profile` exists

**Assumption**: Business profile editing is intentionally separated from onboarding flow, requiring users to navigate to Settings page.

### 6.3 Settings UI Completeness

**Settings Page**: `app/settings/business-profile/page.tsx` (583 lines)

**Fields Available**:
- ✅ Legal name, Trading name
- ✅ Address (street, city, region, country)
- ✅ Phone, WhatsApp phone
- ✅ Email, Website
- ✅ TIN
- ✅ Logo upload
- ✅ Default currency (dropdown)
- ✅ Start date

**Functionality**:
- ✅ Loads existing data
- ✅ Allows editing all fields
- ✅ Saves via API
- ✅ Shows success/error messages
- ✅ Handles logo upload

**Conclusion**: Settings UI is complete and functional. Issue is likely navigation/visibility, not missing functionality.

---

## Summary of Assumptions

1. **Ghana-First Design**: System was built for Ghana market, with multi-currency and multi-country added later
2. **Incremental Migration**: Currency system was added incrementally, leaving hardcoded values in some components
3. **Single Tax Engine**: Only Ghana tax calculation exists, with no country-based tax engine selection
4. **Direct Database Queries**: Analytics queries database directly, no API layer
5. **Register Auto-Creation**: System assumes one register per store during onboarding
6. **Stock-Based Visibility**: POS only shows products with stock > 0 to prevent overselling
7. **Settings Separation**: Business profile editing is in Settings page, not onboarding flow

---

## File Reference Summary

### Currency Issues
- `app/admin/retail/analytics/page.tsx` - Hardcoded GHS in KPI cards
- `supabase/migrations/051_fix_all_table_structures.sql` - GHS default
- `lib/hooks/useBusinessCurrency.ts` - Currency hook (not used everywhere)
- `lib/currency.ts` - Currency symbol mapping
- `lib/money.ts` - Money formatting utilities

### Analytics
- `app/admin/retail/analytics/page.tsx` - Main analytics page
- `app/reports/vat/page.tsx` - VAT report
- `app/admin/retail/inventory-dashboard/page.tsx` - Inventory dashboard

### VAT Leakage
- `lib/vat.ts` - Ghana tax calculation (hardcoded)
- `lib/ghanaTaxEngine.ts` - Ghana tax engine
- `app/(dashboard)/pos/page.tsx` - POS cart tax calculation
- `app/api/sales/create/route.ts` - Sale creation with taxes

### Register Onboarding
- `app/onboarding/retail/register.tsx` - Auto-creates "Main Register"
- `app/sales/open-session/page.tsx` - Register selection
- `app/(dashboard)/pos/page.tsx` - Register session usage

### Product Visibility
- `app/(dashboard)/pos/page.tsx` - Product loading and filtering
- `app/products/page.tsx` - Product creation
- `products_stock` table - Store-specific stock

### Business Settings
- `app/settings/business-profile/page.tsx` - Settings UI
- `app/api/business/profile/route.ts` - Profile API
- `app/onboarding/page.tsx` - Onboarding flow

---

**End of Audit Report**



