# Complete Tax System Changes Summary

## Overview
Redesigned Finza's tax calculation system from hard-coded Ghana-specific logic to a multi-jurisdiction, versioned tax engine architecture. The system now supports country-specific tax engines selected by business/store country, versioned by effective date, with generic tax storage.

---

## 🆕 NEW FILES CREATED

### 1. `lib/taxEngine/types.ts`
**Purpose:** Shared type definitions for all tax engines

**Key Types:**
- `TaxLine`: Generic tax line item (`code`, `name`, `rate`, `base`, `amount`)
- `TaxCalculationResult`: Result structure with `taxLines[]`, `subtotal_excl_tax`, `tax_total`, `total_incl_tax`
- `TaxEngineConfig`: Configuration (`jurisdiction`, `effectiveDate`, `taxInclusive`)
- `TaxEngine`: Interface that all jurisdiction engines must implement
- `LineItem`: Input structure for tax calculation

---

### 2. `lib/taxEngine/index.ts`
**Purpose:** Central entry point for tax calculations

**Key Functions:**
- `getTaxEngine(jurisdiction)`: Selects engine by country code (defaults to Ghana)
- `calculateTaxes(lineItems, country, effectiveDate, taxInclusive)`: Main calculation function
- `calculateTaxesFromAmount(amount, country, effectiveDate, taxInclusive)`: Calculate from single amount
- `getLegacyTaxAmounts(result)`: Helper for backward compatibility (extracts Ghana tax amounts)

**Features:**
- Jurisdiction-based engine selection
- Handles tax-inclusive and tax-exclusive pricing
- Supports discounts (reduces taxable base before tax calculation)

---

### 3. `lib/taxEngine/jurisdictions/ghana.ts`
**Purpose:** Ghana-specific tax engine implementation

**Key Features:**
- **Versioned Tax Rates:**
  - Version A (before 2026-01-01): NHIL 2.5%, GETFund 2.5%, COVID 1%, VAT 15%
  - Version B (>= 2026-01-01): NHIL 2.5%, GETFund 2.5%, COVID 0% (removed), VAT 15%
  
- **Dynamic Multiplier Calculation:**
  - `getCompoundMultiplier(rates)`: Calculates inclusive divisor dynamically
  - Version A: `(1 + 0.025 + 0.025 + 0.01) × (1 + 0.15) = 1.219`
  - Version B: `(1 + 0.025 + 0.025 + 0) × (1 + 0.15) = 1.2075`
  - **Eliminates hard-coded magic number `1.219`**

- **Functions:**
  - `calculateFromLineItems()`: Calculate from line items with discounts
  - `calculateFromAmount()`: Calculate from taxable base amount
  - `reverseCalculate()`: Extract base and taxes from tax-inclusive total
  - `getRatesForDate()`: Select tax version based on effective date

- **Conditional COVID Tax:**
  - Only includes COVID tax line when `rates.covid > 0` (Version A only)

---

### 4. `lib/taxEngine/helpers.ts`
**Purpose:** Utility functions for tax data handling

**Key Functions:**
- `deriveLegacyGhanaTaxAmounts(taxLines)`: Extracts Ghana tax amounts from generic tax lines for backward compatibility
- `getTaxEngineCode(jurisdiction)`: Maps jurisdiction codes to engine codes (e.g., "GH" → "ghana")
- `taxResultToJSONB(result)`: Converts TaxCalculationResult to JSONB for database storage
- `jsonbToTaxResult(jsonb)`: Parses JSONB back to TaxCalculationResult

---

### 5. `supabase/migrations/083_add_generic_tax_columns.sql`
**Purpose:** Database migration for generic tax storage

**Changes:**
- **Invoices table:**
  - `tax_lines JSONB`: Array of tax line items (source of truth)
  - `tax_engine_code TEXT`: Engine identifier (e.g., "ghana")
  - `tax_engine_effective_from DATE`: Effective date for tax calculation
  - `tax_jurisdiction TEXT`: Country/jurisdiction code (e.g., "GH")
  
- **Sales table:**
  - Same columns (with `tax_engine_effective_from` as TIMESTAMP)
  
- **Legacy columns preserved:**
  - `nhil`, `getfund`, `covid`, `vat` kept for backward compatibility
  - These are now **derived from `tax_lines`** rather than being source of truth

---

### 6. `SANITY_TEST_CHECKLIST.md`
**Purpose:** Comprehensive test checklist for tax system

---

## 🔄 MODIFIED FILES

### Invoice API Routes

#### 1. `app/api/invoices/create/route.ts`
**Changes:**
- ✅ Removed: Direct imports from `lib/ghanaTaxEngine`
- ✅ Added: Import `calculateTaxes`, `deriveLegacyGhanaTaxAmounts`, `getTaxEngineCode`, `taxResultToJSONB`
- ✅ Fetches `business.address_country` to determine jurisdiction
- ✅ Uses `sent_at` date (when status is "sent") or `issue_date` (for drafts) as effective date
- ✅ Stores generic tax columns:
  - `tax_lines` (JSONB) - source of truth
  - `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction`
- ✅ Derives legacy columns (`nhil`, `getfund`, `covid`, `vat`) from `tax_lines` for backward compatibility
- ✅ Uses shared tax engine instead of hard-coded Ghana logic

---

#### 2. `app/api/invoices/[id]/route.ts` (Update Route)
**Changes:**
- ✅ Removed: Direct imports from `lib/ghanaTaxEngine`
- ✅ Added: Import shared tax engine functions
- ✅ Uses `existingInvoice.sent_at` (if sent) or `issue_date` as effective date
- ✅ Stores generic tax columns and derives legacy columns
- ✅ Clears tax columns when `apply_taxes = false`

---

#### 3. `app/api/invoices/preview/route.ts`
**Changes:**
- ✅ Removed: Import from `lib/ghanaTaxEngine`
- ✅ Added: Import `calculateTaxes` from shared engine
- ✅ Fetches `business.address_country` for jurisdiction
- ✅ Uses `issue_date` as effective date (for preview)
- ✅ Passes `tax_lines` to `FinancialDocument` component for dynamic rendering

---

#### 4. `app/api/invoices/[id]/pdf-preview/route.ts`
**Changes:**
- ✅ Added: Import `jsonbToTaxResult` helper
- ✅ Fetches `tax_lines` JSONB from invoice record
- ✅ Parses stored `tax_lines` and passes to component (preferred over recalculating)
- ✅ Fetches `address_country` from business for fallback

---

#### 5. `app/api/recurring-invoices/generate/route.ts`
**Changes:**
- ✅ Removed: Import from `lib/ghanaTaxEngine`
- ✅ Added: Import shared tax engine functions
- ✅ Uses current date (`issueDate`) as effective date
- ✅ Stores generic tax columns and derives legacy columns
- ✅ Uses `sent_at` date as effective date when auto-sending

---

### Invoice UI Pages

#### 6. `app/invoices/new/page.tsx`
**Changes:**
- ✅ Removed: `calculateGhanaTaxesFromLineItems`, `calculateBaseFromTotalIncludingTaxes`
- ✅ Added: `calculateTaxes`, `getLegacyTaxAmounts` from shared engine
- ✅ Loads `business.address_country` for tax calculation
- ✅ Uses `issue_date` as effective date (will use `sent_at` when sent via API)
- ✅ Updated UI to use `legacyTaxAmounts` instead of `taxBreakdown`
- ✅ Conditionally displays COVID tax (only if amount > 0)

---

#### 7. `app/invoices/[id]/edit/page.tsx`
**Changes:**
- ✅ Removed: Direct imports from `lib/ghanaTaxEngine`
- ✅ Added: Shared tax engine imports
- ✅ Loads `business.address_country`
- ✅ Uses `issue_date` as effective date (API uses `sent_at` when sent)
- ✅ Updated UI to conditionally display COVID tax

---

#### 8. `app/invoices/[id]/view/page.tsx`
**Changes:**
- ✅ Removed: `calculateBaseFromTotalIncludingTaxes`
- ✅ Added: `calculateTaxesFromAmount`, `getLegacyTaxAmounts`
- ✅ Loads `business.address_country`
- ✅ Uses `sent_at` as effective date (fallback to `issue_date` if not sent)
- ✅ Updated UI to conditionally display COVID tax

---

### POS

#### 9. `app/(dashboard)/pos/page.tsx`
**Changes:**
- ✅ Removed: Direct calls to `calculateCartTaxes()` from `lib/vat.ts`
- ✅ Added: Import `calculateTaxes` from shared tax engine
- ✅ Loads `business.address_country` (or store country if available) for jurisdiction
- ✅ Uses current date as effective date (sale will use `created_at` when saved)
- ✅ Calculates taxes in `cartTotals` useMemo using shared engine
- ✅ Removed unused `calculateCartTaxes` calls
- ✅ Extracts legacy tax amounts (`nhil`, `getfund`, `covid`, `vat`) for backend reporting

---

### Document Components

#### 10. `components/documents/FinancialDocument.ts`
**Changes:**
- ✅ Removed: Hard-coded tax labels ("NHIL (2.5%)", "GETFund (2.5%)", "COVID (1%)", "VAT (15%)")
- ✅ Added: Generic `TaxLine` type import
- ✅ Added: Optional `tax_lines` prop to accept tax lines directly
- ✅ Added: Optional `business_country` prop for fallback calculation
- ✅ **Dynamic Tax Rendering:**
  - Uses `taxLine.name` for label (e.g., "NHIL", "GETFund", "COVID", "VAT")
  - Formats `taxLine.rate * 100` as percentage dynamically (e.g., "2.5%", "15.0%")
  - Only displays tax lines with `amount > 0` (handles conditional COVID)
- ✅ Priority: Uses provided `tax_lines` prop if available, otherwise calculates on-the-fly
- ✅ Updated `DocumentTotals` interface to include optional `tax_lines` field

---

## 🗑️ DEPRECATED/REMOVED

### Files Still Present (But No Longer Used as Primary Source):
- `lib/ghanaTaxEngine.ts`: Still exists but should not be imported directly
- `lib/vat.ts`: Still exists but POS no longer calls `calculateCartTaxes()` directly

**Note:** These files may still be referenced by other parts of the codebase (estimates, bills, credit notes, etc.) that haven't been migrated yet.

---

## 📊 DATABASE SCHEMA CHANGES

### New Columns Added (Migration 083):

**Invoices Table:**
- `tax_lines JSONB` - Generic tax line items array (source of truth)
- `tax_engine_code TEXT` - Engine identifier
- `tax_engine_effective_from DATE` - Effective date for tax calculation
- `tax_jurisdiction TEXT` - Country/jurisdiction code

**Sales Table:**
- Same columns (with `tax_engine_effective_from` as TIMESTAMP)

### Legacy Columns (Still Present, Now Derived):
- `nhil`, `getfund`, `covid`, `vat` - Derived from `tax_lines` for backward compatibility

---

## 🎯 KEY IMPROVEMENTS

### 1. **Multi-Jurisdiction Support**
- System can now support multiple countries (Ghana is first)
- Jurisdiction selected by `business.address_country`
- Easy to add new tax engines for other countries

### 2. **Versioned Tax Rates**
- Tax rates versioned by effective date
- Ghana has two versions (with/without COVID tax)
- Automatically selects correct version based on transaction date

### 3. **Dynamic Calculations**
- Eliminated hard-coded multiplier `1.219`
- Multiplier calculated dynamically from current tax rates
- Supports future rate changes without code modifications

### 4. **Generic Tax Storage**
- `tax_lines` JSONB stores any tax structure (not just Ghana)
- Legacy columns derived for backward compatibility
- Future-proof for different tax jurisdictions

### 5. **Consistent Discount Handling**
- Discounts reduce taxable base before tax calculation
- Applied consistently across POS and Invoicing
- Works for both tax-inclusive and tax-exclusive pricing

### 6. **Dynamic UI Rendering**
- Tax labels and rates rendered dynamically from data
- No hard-coded tax names or percentages
- Conditional display (e.g., COVID only when applicable)

### 7. **Proper Effective Dates**
- **Invoices:** Use `sent_at` when sent, `issue_date` for drafts
- **POS/Sales:** Use `created_at` date
- Ensures correct tax version is applied

---

## 🔄 MIGRATION PATH

### Current State:
- ✅ Invoices use new shared tax engine
- ✅ POS frontend uses shared tax engine
- ✅ Generic tax columns stored in database
- ✅ Legacy columns still populated (derived from `tax_lines`)
- ✅ FinancialDocument renders taxes dynamically

### Future Work:
- ⏳ Sales route backend needs update (TODO #5)
- ⏳ Estimates, Bills, Credit Notes still use old tax engine
- ⏳ Can eventually remove legacy columns once all code migrated
- ⏳ Can remove `lib/ghanaTaxEngine.ts` and `lib/vat.ts` after full migration

---

## 📝 BREAKING CHANGES

### None (Backward Compatible)
- Legacy columns (`nhil`, `getfund`, `covid`, `vat`) still populated
- Existing reports/queries continue to work
- Old files not deleted (still used by other features)

---

## 🧪 TESTING

See `SANITY_TEST_CHECKLIST.md` for comprehensive test scenarios including:
- Version A vs Version B (COVID tax inclusion/exclusion)
- Effective date handling (sent_at vs issue_date)
- Discount handling
- Tax-inclusive reconciliation
- Dynamic multiplier verification

---

## 📦 FILE COUNT SUMMARY

**New Files:** 6
- `lib/taxEngine/types.ts`
- `lib/taxEngine/index.ts`
- `lib/taxEngine/jurisdictions/ghana.ts`
- `lib/taxEngine/helpers.ts`
- `supabase/migrations/083_add_generic_tax_columns.sql`
- `SANITY_TEST_CHECKLIST.md`

**Modified Files:** 10
- 5 Invoice API routes
- 3 Invoice UI pages
- 1 POS page
- 1 Document component

**Total Changes:** 16 files







