# Current Tax Architecture Analysis

## Overview
This document describes the **CURRENT** tax architecture in the Finza system as it exists today. This is a descriptive analysis only - no fixes or improvements are proposed.

---

## 1. Tax Calculation Locations

### 1.1 Service Workspace (Invoices)

**Location**: `app/api/invoices/create/route.ts`

**Tax Calculation Path**:
1. Uses **new tax engine** (`lib/taxEngine/index.ts`)
2. Entry point: `calculateTaxes(lineItems, business.address_country, effectiveDate, taxInclusive=true)`
3. Tax engine selection: Based on `business.address_country` (normalized via `normalizeCountry()`)
4. **Tax-inclusive mode**: All invoice prices are treated as tax-inclusive (default `taxInclusive=true`)
5. Effective date: Uses `issue_date` for drafts, `sent_at` date for sent invoices

**Tax Storage**:
- **Generic columns** (source of truth): `tax_lines` (JSONB), `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction`
- **Legacy Ghana columns** (for backward compatibility): `nhil`, `getfund`, `covid`, `vat`, `total_tax`
- Legacy columns are **only populated if country is GH** (`countryCode === "GH"`)

**Key Files**:
- `app/api/invoices/create/route.ts` - Invoice creation
- `app/api/invoices/[id]/route.ts` - Invoice updates (uses same tax engine)
- `app/api/recurring-invoices/generate/route.ts` - Recurring invoice generation

---

### 1.2 Retail/POS Workspace (Sales)

**Location**: `app/(dashboard)/pos/page.tsx` (cart calculation), `app/api/sales/create/route.ts` (sale storage)

**Tax Calculation Path**:
1. **Frontend (Cart)**: Uses **new tax engine** (`lib/taxEngine/index.ts`)
   - Entry point: `calculateTaxes(lineItems, businessCountry, effectiveDate, taxInclusive=true)`
   - Location: `app/(dashboard)/pos/page.tsx` lines 1167-1175
   - Calculates taxes for display/reporting (tax portions are extracted internally)

2. **Legacy Retail Tax Functions** (still used):
   - `lib/vat.ts`: `calculateCartTaxes()` - Used by POS for cart totals
   - This function filters items by VAT type (standard/zero/exempt) and calculates only on standard-rated items
   - Uses VAT type from product categories

3. **Tax-inclusive mode**: POS **always** uses VAT-inclusive pricing (`retailVatInclusive = true`)
   - Prices shown to customers already include tax
   - Tax amounts are extracted internally for reporting but not added to cart total

**Tax Storage**:
- Stored in `sales` table with legacy Ghana columns: `nhil`, `getfund`, `covid`, `vat`
- **No generic tax columns** (`tax_lines`, `tax_engine_code`) are stored for sales
- Tax values are calculated from cart and sent to API in request body
- Only standard-rated items contribute to tax amounts (zero-rated and exempt items have zero tax)

**Key Files**:
- `app/(dashboard)/pos/page.tsx` - POS cart tax calculation (uses both new and old engines)
- `app/api/sales/create/route.ts` - Sale creation (stores legacy tax columns only)
- `lib/vat.ts` - Legacy retail tax calculation (`calculateCartTaxes()`)

**VAT Type Filtering**:
- Retail uses product **categories** to determine VAT type (`vat_type`: "standard", "zero", "exempt")
- Only items with `vat_type === "standard"` are included in taxable subtotal
- VAT report reconstructs VAT type from current product/category state (not stored in `sale_items`)

---

### 1.3 Receipts and Reports

**Receipts** (`app/sales/[id]/receipt/page.tsx`):
- Reads tax values from `sale` record (legacy columns: `nhil`, `getfund`, `covid`, `vat`)
- Determines VAT-inclusive mode from `business.retail_vat_inclusive` flag
- Displays tax breakdown if taxes exist
- For VAT-inclusive: Shows "Tax Breakdown (included in price)"

**VAT Reports** (`app/reports/vat/page.tsx`):
- Reads taxes from `sales` table (legacy columns)
- **Problem**: VAT report reconstructs VAT types from current products/categories
- If category `vat_type` changed after sale, report may show incorrect classification
- Calculates "Standard Rated Sales" by summing `sale_items` where current category is "standard"
- Tax totals are summed from `sale.nhil`, `sale.getfund`, `sale.covid`, `sale.vat` columns

**Tax Summary Reports** (`app/api/reports/tax-summary/route.ts`):
- Aggregates taxes from invoices, sales, bills, expenses
- Uses legacy Ghana columns from each table

---

## 2. Tax Engine Architecture

### 2.1 Tax Engine Registry

**Location**: `lib/taxEngine/index.ts`

**Structure**:
- Registry: `TAX_ENGINES` object maps jurisdiction codes to engine implementations
- Currently registered: `'GH'` and `'GHA'` → `ghanaTaxEngine`
- Selection: `getTaxEngine(jurisdiction)` returns engine or fallback (zero-tax)

**Fallback Behavior**:
- If country not in registry: Returns `fallbackTaxEngine` (zero taxes)
- Logs warning: "No tax engine available for country [X]. Using zero-tax fallback."
- **Does not throw error** - allows unsupported countries to work with zero tax

**Normalization**:
- `normalizeJurisdiction(country)`: Maps country names/codes to jurisdiction codes
- Maps: 'GHANA' → 'GH', 'GHA' → 'GH', 'KENYA' → 'KE'
- If not in map: Uses first 2 characters of normalized input

---

### 2.2 Ghana Tax Engine Implementation

**Location**: `lib/taxEngine/jurisdictions/ghana.ts`

**Versioned Tax Rates**:
- **Version A** (before 2026-01-01): NHIL 2.5%, GETFund 2.5%, COVID 1%, VAT 15%
- **Version B** (>= 2026-01-01): NHIL 2.5%, GETFund 2.5%, COVID 0% (removed), VAT 15%
- Selection: `getRatesForDate(effectiveDate)` returns rates for date

**Tax Calculation Formula**:
1. Calculate levies on base: `nhil = base * 0.025`, `getfund = base * 0.025`, `covid = base * 0.01` (if version A)
2. VAT base = `base + nhil + getfund + covid`
3. VAT = `vatBase * 0.15`
4. Total tax = `nhil + getfund + covid + vat`
5. Total incl tax = `base + totalTax`

**Reverse Calculation (Tax-Inclusive)**:
- Multiplier = `(1 + nhil_rate + getfund_rate + covid_rate) * (1 + vat_rate)`
- For Version A: Multiplier = `1.219` (hardcoded in old code, calculated dynamically in new engine)
- Base = `totalInclusive / multiplier`

**Tax Lines**:
- Returns array of `TaxLine` objects with: `code`, `name`, `rate`, `base`, `amount`
- Includes ledger metadata: `ledger_account_code`, `ledger_side`, `is_creditable_input`
- Only includes non-zero taxes (COVID excluded in Version B)

---

### 2.3 Legacy Ghana Tax Engine

**Location**: `lib/ghanaTaxEngine.ts`

**Status**: Still used by some endpoints (bills, orders, estimates)

**Functions**:
- `calculateGhanaTaxes(taxableAmount, applyTaxes)`: Direct calculation (no versioning)
- `calculateGhanaTaxesFromLineItems(lineItems, applyTaxes)`: From line items
- `calculateBaseFromTotalIncludingTaxes(totalInclusive, applyTaxes)`: Reverse calculation
  - Uses hardcoded multiplier `1.219` (assumes Version A)

**Usage**:
- `app/api/bills/create/route.ts` - Bill creation
- `app/api/orders/[id]/convert-to-invoice/route.ts` - Order to invoice conversion
- `app/api/estimates/create/route.ts` - Estimate creation

---

### 2.4 Retail VAT Calculation (Legacy)

**Location**: `lib/vat.ts`

**Functions**:
- `calculateGhanaVAT(price, quantity, vatType)`: Single item calculation
- `extractTaxFromInclusivePrice(inclusivePrice, quantity, vatType)`: Reverse calculation (hardcoded `1.219`)
- `calculateCartTaxes(cartItems, categories, vatInclusive)`: Cart-level calculation

**VAT Type Handling**:
- Accepts `vatType`: "standard", "zero", "exempt"
- Zero-rated and exempt: Return zero taxes, `total_with_tax = taxable_amount`
- Standard-rated: Full Ghana tax calculation

**Cart Calculation Behavior**:
- Filters items by VAT type from categories
- Only standard-rated items included in `taxableSubtotal`
- In VAT-inclusive mode: Extracts tax from taxable subtotal using `/1.219`
- Grand total = subtotal (tax already included, not added again)

---

## 3. Ghana Tax Representation

### 3.1 Tax Components

**Ghana taxes consist of**:
1. **NHIL** (National Health Insurance Levy): 2.5% of base
2. **GETFund** (Ghana Education Trust Fund Levy): 2.5% of base
3. **COVID Levy**: 1% of base (removed in Version B, >= 2026-01-01)
4. **VAT** (Value Added Tax): 15% of `(base + NHIL + GETFund + COVID)`

**Storage**:
- **Generic**: `tax_lines` JSONB array with `code`, `name`, `rate`, `base`, `amount`
- **Legacy**: Separate columns `nhil`, `getfund`, `covid`, `vat` (Ghana only)

---

### 3.2 Single VAT Line vs Multiple Components

**Current State**: **Multiple components stored separately**
- Invoices: Both `tax_lines` array (generic) AND legacy columns (Ghana only)
- Sales: Only legacy columns (`nhil`, `getfund`, `covid`, `vat`)
- Bills: Only legacy columns
- Receipts: Display all components separately

**Display**:
- Receipts show: NHIL, GETFund, COVID (if > 0), VAT as separate lines
- Reports sum individual components

---

### 3.3 NHIL / GETFund / COVID Visibility

**Where They Appear**:
1. **Receipts** (`app/sales/[id]/receipt/page.tsx`): All components shown if > 0
2. **VAT Reports**: Summed from `sale.nhil`, `sale.getfund`, `sale.covid`, `sale.vat`
3. **Tax Summary Reports**: Aggregated from all transaction types
4. **VAT Returns** (`app/api/vat-returns/calculate/route.ts`): Uses `nhil`, `getfund`, `covid`, `vat` columns

**Version Handling**:
- New tax engine: COVID excluded if `effectiveDate >= '2026-01-01'`
- Legacy engine: Always includes COVID (hardcoded rates)

---

### 3.4 Retail vs Service Differences

**Service (Invoices)**:
- Uses new tax engine with country-based selection
- Stores both generic (`tax_lines`) and legacy columns
- Tax-inclusive pricing (prices entered include tax)
- Effective date tracking (`tax_engine_effective_from`)

**Retail (Sales)**:
- Uses **mixed approach**: New engine in cart, legacy columns in storage
- **Only stores legacy columns** (`nhil`, `getfund`, `covid`, `vat`)
- VAT-inclusive pricing (always)
- **No effective date stored** (uses current date at sale time)
- VAT type filtering by product category (standard/zero/exempt)
- Tax calculated only on standard-rated items

**Key Difference**: Service has generic tax storage, Retail does not.

---

## 4. Country Usage in Tax System

### 4.1 Normalization

**Location**: `lib/payments/eligibility.ts` → `normalizeCountry()`

**Function**: Maps business `address_country` to ISO country code
- Input: String from `businesses.address_country`
- Output: `CountryCode` (e.g., "GH", "KE") or `null`
- Used by: Tax engine selection, payment eligibility, currency validation

---

### 4.2 Tax Engine Gating

**Selection Logic** (`lib/taxEngine/index.ts`):
1. Normalize country via `normalizeJurisdiction()`
2. Lookup in `TAX_ENGINES` registry
3. If found: Use country-specific engine
4. If not found: Use fallback (zero-tax) + log warning

**Current Registry**:
- `'GH'` → `ghanaTaxEngine`
- `'GHA'` → `ghanaTaxEngine` (alternative code)
- All others → `fallbackTaxEngine` (zero taxes)

**No Country = Error?**:
- Invoice creation: **BLOCKS** if `business.address_country` is missing (returns 400)
- Tax engine: Throws error if country is `null`/`undefined` in `normalizeJurisdiction()`

---

### 4.3 Feature Enablement

**Tax Calculation**:
- Requires `business.address_country` to be set
- Invoice API: Validates country exists before proceeding
- POS: Uses `businessCountry` state (loaded from business)

**Currency Validation**:
- Country must match currency (`assertCountryCurrency()`)
- Example: GH must use GHS

**Payment Methods**:
- Country determines eligible payment methods (`assertMethodAllowed()`)
- Example: Mobile money only available in certain countries

---

## 5. Retail Assumptions vs Service

### 5.1 Stores

**Retail Assumption**: **Always has stores**
- POS requires `store_id` before any operations
- Sale creation: **BLOCKS** if `store_id` is null or 'all'
- Register sessions: Tied to stores (`register.store_id`)
- Stock tracking: Per-store (`products_stock.store_id`)
- User restrictions: Managers/cashiers assigned to specific stores

**Service Assumption**: **No stores concept**
- Invoices: No `store_id` field
- No store selection UI in invoice creation
- Business-level operations only

**Implicit Invariant**: "Retail always has stores, Service never has stores"

---

### 5.2 Tax Inclusion

**Retail**: **Always VAT-inclusive**
- `retailVatInclusive` state is hardcoded to `true`
- No toggle in UI
- Prices shown to customers already include tax
- Cart total = subtotal (tax not added)

**Service**: **Tax-inclusive by default, but flexible**
- Invoices: Treats prices as tax-inclusive (`taxInclusive=true` by default)
- Can have `apply_taxes=false` to disable taxes
- UI shows "Subtotal (tax inclusive)" label

**Difference**: Retail has no option to disable tax inclusion, Service does.

---

### 5.3 Pricing Model

**Retail**:
- Product prices are stored as selling prices (tax-inclusive)
- Category determines VAT type (standard/zero/exempt)
- Tax extracted from price for reporting

**Service**:
- Line item prices entered by user (treated as tax-inclusive if `apply_taxes=true`)
- No category-based VAT type filtering
- All items taxed equally (or all exempt if `apply_taxes=false`)

---

### 5.4 Registers

**Retail Assumption**: **Always has registers**
- POS: Requires open register session before sale
- Register tied to store (`register.store_id`)
- Sale creation: Validates `register_id` is provided
- Cashier sessions: Tied to register

**Service**: **No registers concept**
- Invoices created without register reference

**Implicit Invariant**: "Retail always has registers, Service never has registers"

---

### 5.5 VAT Type Filtering

**Retail**:
- Uses product categories to determine VAT type
- Only standard-rated items taxed
- Zero-rated and exempt items: Price includes in total, but zero tax extracted

**Service**:
- No VAT type filtering
- If `apply_taxes=true`, all line items are taxed
- No concept of zero-rated or exempt items in invoices

---

## 6. Implicit Invariants

### 6.1 Retail Invariants

1. **"Retail always has stores"**
   - POS blocks operation without store selection
   - Sales require `store_id` (cannot be null or 'all')
   - Stock is per-store

2. **"Retail always has registers"**
   - POS requires register session
   - Sales require `register_id`

3. **"Retail VAT is always inclusive"**
   - `retailVatInclusive` is always `true`
   - No toggle exists

4. **"Retail tax calculated only on standard-rated items"**
   - Category `vat_type` determines taxation
   - Zero-rated and exempt items contribute to total but not to tax amounts

5. **"Retail stores legacy tax columns only"**
   - Sales table has no `tax_lines`, `tax_engine_code`, `tax_engine_effective_from`
   - Only `nhil`, `getfund`, `covid`, `vat` columns

---

### 6.2 Service Invariants

1. **"Service never has stores"**
   - Invoices have no `store_id` field
   - No store selection in invoice UI

2. **"Service never has registers"**
   - Invoices have no `register_id` field

3. **"Service prices are tax-inclusive when taxes applied"**
   - Default behavior: `taxInclusive=true`
   - Can be disabled with `apply_taxes=false`

4. **"Service stores both generic and legacy tax columns"**
   - Invoices have `tax_lines` (JSONB), `tax_engine_code`, `tax_engine_effective_from`
   - Also has legacy columns (populated only if GH)

5. **"Service tracks effective date for tax calculation"**
   - Stores `tax_engine_effective_from` (issue_date for drafts, sent_at for sent invoices)
   - Used for versioned tax rates

---

### 6.3 System-Wide Invariants

1. **"Tax always assumes Ghana if not specified"**
   - **FALSE**: New tax engine does not default to Ghana
   - Falls back to zero-tax if country not in registry
   - Invoice API **blocks** creation if country missing

2. **"VAT is always exclusive/inclusive"**
   - **FALSE**: Behavior varies by workspace
   - Retail: Always inclusive
   - Service: Inclusive by default, but can be disabled

3. **"Country determines tax engine"**
   - **TRUE**: Tax engine selected by `business.address_country`
   - If country not in registry, zero-tax fallback used

4. **"Legacy tax columns only for Ghana"**
   - **TRUE**: Legacy columns (`nhil`, `getfund`, `covid`, `vat`) only populated if `countryCode === "GH"`
   - But: Sales table always has these columns (may be 0 for non-GH)

5. **"Ghana tax uses hardcoded 1.219 multiplier"**
   - **Partially TRUE**: Legacy code uses `1.219`
   - New tax engine calculates multiplier dynamically based on version
   - Version B (>= 2026): Multiplier changes (no COVID)

---

## 7. Tax Storage Schema

### 7.1 Invoices Table

**Generic Columns** (source of truth):
- `tax_lines` (JSONB): Array of `TaxLine` objects
- `tax_engine_code` (TEXT): Engine identifier (e.g., "ghana")
- `tax_engine_effective_from` (DATE): Effective date for version selection
- `tax_jurisdiction` (TEXT): Normalized country code

**Legacy Columns** (Ghana only, populated if `countryCode === "GH"`):
- `nhil` (NUMERIC)
- `getfund` (NUMERIC)
- `covid` (NUMERIC)
- `vat` (NUMERIC)
- `total_tax` (NUMERIC)

**Subtotal/Total**:
- `subtotal` (NUMERIC): Base amount before taxes
- `total` (NUMERIC): Total including taxes

---

### 7.2 Sales Table

**Only Legacy Columns**:
- `nhil` (NUMERIC)
- `getfund` (NUMERIC)
- `covid` (NUMERIC)
- `vat` (NUMERIC)
- **No generic columns**: `tax_lines`, `tax_engine_code`, `tax_engine_effective_from` do not exist

**Totals**:
- `amount` (NUMERIC): Total sale amount (tax-inclusive)
- No `subtotal` or `total_tax` columns

---

### 7.3 Bills Table

**Only Legacy Columns**:
- `subtotal` (NUMERIC): Base before taxes (reverse-calculated)
- `nhil`, `getfund`, `covid`, `vat` (NUMERIC)
- `total_tax` (NUMERIC)
- `total` (NUMERIC): Total including taxes

**Uses**: Legacy `ghanaTaxEngine` (not new tax engine)

---

## 8. Tax Calculation Flow Summary

### 8.1 Invoice Creation Flow

```
1. User enters line items (prices are tax-inclusive)
2. API validates business.address_country exists
3. normalizeCountry(business.address_country) → jurisdiction code
4. getTaxEngine(jurisdiction) → ghanaTaxEngine or fallback
5. calculateTaxes(lineItems, country, issue_date, taxInclusive=true)
6. Engine.reverseCalculate(subtotal) → extracts base and taxes
7. Store both tax_lines (JSONB) and legacy columns (if GH)
8. Store tax_engine_code, tax_engine_effective_from
```

---

### 8.2 POS Sale Creation Flow

```
1. User adds products to cart (prices are tax-inclusive)
2. Cart totals calculated (useMemo):
   a. Filter items by category vat_type (standard/zero/exempt)
   b. calculateTaxes(taxableItems, businessCountry, currentDate, taxInclusive=true)
   c. Extract tax portions (nhil, getfund, covid, vat) for reporting
   d. Cart total = subtotal (tax already included, not added)
3. On checkout:
   a. Send tax amounts to /api/sales/create
   b. API stores only legacy columns (nhil, getfund, covid, vat)
   c. No generic tax columns stored
```

---

### 8.3 Bill Creation Flow

```
1. User enters line items (prices are tax-inclusive)
2. calculateBaseFromTotalIncludingTaxes(subtotal, true) [legacy function]
   a. Uses hardcoded 1.219 multiplier (assumes Version A)
   b. Returns baseAmount and taxBreakdown
3. Store legacy columns only (nhil, getfund, covid, vat, total_tax)
4. No generic tax columns stored
```

---

## 9. Duplicated Logic

### 9.1 Tax Calculation Functions

**Three separate implementations**:
1. **New tax engine** (`lib/taxEngine/jurisdictions/ghana.ts`): Versioned, generic structure
2. **Legacy tax engine** (`lib/ghanaTaxEngine.ts`): Direct calculation, hardcoded rates
3. **Retail VAT functions** (`lib/vat.ts`): Cart-specific, VAT type filtering

**Where each is used**:
- **New engine**: Invoices, recurring invoices, POS cart (partially)
- **Legacy engine**: Bills, orders, estimates
- **Retail functions**: POS cart totals (still used alongside new engine)

---

### 9.2 Reverse Calculation (Tax-Inclusive)

**Three implementations**:
1. **New engine**: `ghanaTaxEngine.reverseCalculate()` - Dynamic multiplier based on version
2. **Legacy engine**: `calculateBaseFromTotalIncludingTaxes()` - Hardcoded `1.219`
3. **Retail**: `extractTaxFromInclusivePrice()` - Hardcoded `1.219`

**Problem**: Hardcoded `1.219` will break when Version B becomes effective (2026-01-01, no COVID).

---

### 9.3 Tax Amount Derivation

**Legacy tax columns derived from `tax_lines`**:
- `app/api/invoices/create/route.ts`: Uses `deriveLegacyGhanaTaxAmounts(tax_lines)` to populate `nhil`, `getfund`, `covid`, `vat`
- Only if `countryCode === "GH"`, otherwise zeros

**Sales**: No derivation (tax amounts calculated upfront and stored directly)

---

## 10. Country-Based Behavior

### 10.1 Tax Engine Selection

**Current State**:
- Registry only has Ghana engine
- All non-GH countries → zero-tax fallback
- No error thrown, but warning logged

**Invoice Creation**:
- **Blocks** if country missing (returns 400 error)
- If country exists but not in registry: Zero taxes applied (no error)

**POS/Sales**:
- Uses `businessCountry` state
- If country not in registry: Zero taxes calculated (cart shows 0 tax)

---

### 10.2 Legacy Tax Columns

**Populated Only for Ghana**:
- Invoices: Legacy columns set only if `countryCode === "GH"` (otherwise 0)
- Sales: Always stores columns (may be 0 for non-GH, but columns exist)

**Derivation**:
- Invoices: Legacy columns derived from `tax_lines` (only if GH)
- Sales: Calculated directly from cart (no derivation)

---

## 11. Missing or Incomplete Features

### 11.1 Sales Tax Storage

**Missing Generic Columns**:
- `sales` table has no `tax_lines`, `tax_engine_code`, `tax_engine_effective_from`
- Cannot reconstruct tax calculation for sales after fact
- No version tracking for sales

---

### 11.2 VAT Type Snapshot

**Problem**: `sale_items` table does not store `vat_type` or `category_id`
- VAT report must reconstruct VAT type from current product/category state
- If category changed after sale, report may show incorrect classification
- Tax amounts were calculated from sale-time VAT types, but report uses current types

---

### 11.3 Store Country

**Assumption**: Tax calculation uses `business.address_country`
- No concept of per-store country
- If store in different country than business, still uses business country

---

### 11.4 Version Transition

**Hardcoded Multipliers**:
- Legacy code uses `1.219` (Version A with COVID)
- When Version B becomes effective (2026-01-01), legacy code will calculate wrong base
- New engine handles versioning, but legacy code does not

---

## 12. Key Observations

### 12.1 Architecture Split

**Two Parallel Systems**:
1. **New system**: Generic tax engine, country-based selection, versioned rates, generic storage
2. **Legacy system**: Ghana-specific functions, hardcoded rates, legacy column storage

**Migration Status**:
- **Invoices**: Fully migrated to new system (but keeps legacy columns for compatibility)
- **Bills/Orders/Estimates**: Still use legacy system
- **Sales**: **Hybrid** - New engine in cart, legacy columns in storage

---

### 12.2 Retail vs Service Divergence

**Service (Invoices)**:
- Generic tax storage (`tax_lines` JSONB)
- Country-based engine selection
- Version tracking (`tax_engine_effective_from`)
- Flexible tax inclusion (`apply_taxes` flag)

**Retail (Sales)**:
- Legacy tax storage only (no generic columns)
- Mixed tax calculation (new engine + legacy functions)
- No version tracking
- Always tax-inclusive (no toggle)

**Key Issue**: Retail has not been fully migrated to generic tax storage.

---

### 12.3 Country Handling

**Validation**:
- Invoice API: **Strict** - blocks if country missing
- Tax engine: **Strict** - throws error if country null
- POS: **Loose** - uses state, may be null

**Fallback**:
- Unsupported countries: Zero-tax fallback (no error)
- Logs warning but allows operation to proceed

---

## 13. Current State Summary

### 13.1 What Works Today

1. **Invoice tax calculation**: Uses new engine, versioned rates, generic storage
2. **POS cart tax calculation**: Uses new engine (partially), calculates tax portions
3. **Ghana tax structure**: NHIL, GETFund, COVID (pre-2026), VAT stored separately
4. **Country-based selection**: Tax engine selected by business country
5. **Tax-inclusive pricing**: Both workspaces treat prices as tax-inclusive by default

---

### 13.2 What Is Incomplete

1. **Sales tax storage**: No generic columns, no version tracking
2. **Bills/Orders/Estimates**: Still use legacy engine (no versioning)
3. **VAT type snapshot**: Not stored in `sale_items`, report reconstructs from current state
4. **Legacy multipliers**: Hardcoded `1.219` in legacy code (will break in 2026)
5. **Retail migration**: Not fully migrated to generic tax storage

---

### 13.3 What Is Duplicated

1. **Tax calculation**: New engine + legacy engine + retail functions
2. **Reverse calculation**: Three implementations (dynamic + two hardcoded)
3. **Ghana tax logic**: Present in new engine, legacy engine, and retail functions

---

## End of Analysis

**Note**: This document describes the system **as it exists today**. No fixes or improvements are proposed - only an accurate map of current behavior.
