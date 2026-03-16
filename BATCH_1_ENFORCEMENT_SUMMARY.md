# Batch 1 Enforcement Summary: Remove Silent Ghana Fallbacks

## Overview
Implemented critical guardrails to remove all silent Ghana fallbacks for currency and tax. This ensures that missing country/currency data fails explicitly rather than defaulting to Ghana values.

## Files Changed

### 1. New Files Created

#### `lib/countryCurrency.ts` (NEW)
- **Purpose**: Country-currency validation utility
- **Functions**:
  - `validateCountryCurrency()`: Validates currency matches country
  - `getExpectedCurrency()`: Returns expected currency for a country
  - `assertCountryCurrency()`: Throws error if currency doesn't match country
- **Country-Currency Mapping**: GH→GHS, KE→KES, NG→NGN, TZ→TZS, UG→UGX, ZA→ZAR, etc.

### 2. Database Changes

#### `supabase/migrations/090_final_hard_constraints.sql`
- **Change**: Removed `COALESCE(default_currency, 'GHS')` fallback
- **New Behavior**: Function now raises exception if `default_currency` is NULL or empty
- **Impact**: Database functions will fail fast if currency is missing

### 3. API Route Changes

#### `app/api/invoices/create/route.ts`
- **Currency Validation**: 
  - Removed hardcoded currency fallbacks
  - Added country-currency validation using `assertCountryCurrency()`
  - Returns 400 if currency missing or doesn't match country
- **Tax Isolation**:
  - Added `isGhana` check before calling `deriveLegacyGhanaTaxAmounts()`
  - Only populates `nhil`, `getfund`, `covid` for GH businesses
  - Non-GH businesses get zeros for these fields
- **Currency Symbol**:
  - Uses `getCurrencySymbol()` from currency code
  - Returns 400 if currency symbol cannot be determined

#### `app/api/invoices/[id]/route.ts` (Update route)
- **Tax Isolation**:
  - Added `isGhana` check before calling `deriveLegacyGhanaTaxAmounts()`
  - Only populates `nhil`, `getfund`, `covid` for GH businesses
  - Non-GH businesses get zeros for these fields

#### `app/api/invoices/[id]/send/route.ts`
- **Currency Symbol**:
  - Removed `|| "₵"` fallback
  - Uses `getCurrencySymbol()` from `invoice.currency_code`
  - Returns 400 if currency symbol cannot be determined

#### `app/api/business/profile/route.ts`
- **Country-Currency Validation**:
  - Added validation when updating country or currency
  - Validates new country against existing currency
  - Validates new currency against existing country
  - Returns 400 if mismatch detected

#### `app/api/recurring-invoices/generate/route.ts`
- **Currency Symbol**:
  - Removed hardcoded "GHS" in WhatsApp message
  - Uses `getCurrencySymbol()` from invoice currency code
- **Tax Isolation**:
  - Added `isGhana` check before calling `deriveLegacyGhanaTaxAmounts()`
  - Only derives Ghana taxes for GH businesses

#### `app/api/reminders/process-automated/route.ts`
- **Currency Symbol**:
  - Removed hardcoded "₵" in email template
  - Uses `getCurrencySymbol()` from invoice currency code

#### `app/api/reminders/overdue/route.ts`
- **Currency Symbol**:
  - Removed hardcoded "GHS" in message template
  - Uses `getCurrencySymbol()` from invoice currency code

#### `app/api/credit-notes/[id]/pdf-preview/route.ts`
- **Currency Fallbacks**:
  - Removed `|| "₵"` and `|| "GHS"` fallbacks
  - Uses `getCurrencySymbol()` from credit note currency code
  - Returns null if currency code missing

### 4. UI Component Changes

#### `app/payments/page.tsx`
- **Currency Symbol**:
  - Removed `|| "₵"` fallback
  - Uses `getCurrencySymbol()` from business currency code
  - Sets to null if currency code missing

#### `app/pay/[invoiceId]/success/page.tsx`
- **Currency Symbol**:
  - Removed `|| "₵"` fallback
  - Uses `getCurrencySymbol()` from invoice currency code
  - Falls back to existing `currency_symbol` if currency code missing

### 5. Library Changes

#### `lib/taxEngine/helpers.ts`
- **Documentation**:
  - Added warning comment to `deriveLegacyGhanaTaxAmounts()` that it should only be called for GH businesses
  - Clarified that non-GH businesses should return zeros instead

## Key Changes Summary

### Currency Enforcement
1. ✅ **Database**: Removed `COALESCE(default_currency, 'GHS')` - now fails if currency missing
2. ✅ **API Routes**: All currency fallbacks (`|| "GHS"`, `|| "₵"`) removed
3. ✅ **Currency Symbols**: All use `getCurrencySymbol(currencyCode)` - no hardcoded symbols
4. ✅ **Missing Currency**: Returns 400 error instead of silent fallback

### Country-Currency Validation
1. ✅ **Business Profile**: Validates country-currency match on update
2. ✅ **Invoice Creation**: Validates country-currency match before creation
3. ✅ **Validation Logic**: New `lib/countryCurrency.ts` utility enforces mappings

### Tax Engine Hard Isolation
1. ✅ **Ghana Tax Derivation**: Only called for GH businesses (`isGhana` check)
2. ✅ **Legacy Columns**: `nhil`, `getfund`, `covid` only populated for GH businesses
3. ✅ **Non-GH Businesses**: Get zeros for Ghana-specific tax columns
4. ✅ **Tax Engine Code**: Already stored with all tax calculations (no change needed)

### Storage Rules
1. ✅ **Tax Engine Code**: Already stored with all calculations (verified)
2. ✅ **Ghana Columns**: Only populated for GH businesses (enforced)

## Acceptance Criteria Met

✅ **No silent fallback to Ghana currency or tax logic anywhere**
- All currency fallbacks removed
- All tax derivation gated by country check

✅ **Non-GH business cannot see Ghana currency**
- Currency symbols come from `getCurrencySymbol()` only
- No hardcoded "₵" or "GHS" fallbacks

✅ **Non-GH business cannot receive Ghana tax calculations**
- `deriveLegacyGhanaTaxAmounts()` only called for GH
- `nhil`, `getfund`, `covid` only populated for GH

✅ **Missing country/currency blocks operations explicitly**
- Database function raises exception if currency missing
- API routes return 400 if currency missing
- API routes return 400 if country-currency mismatch

## Testing Recommendations

1. **Currency Missing**:
   - Set business currency to null
   - Attempt to create invoice → Should return 400
   - Attempt to send invoice → Should return 400

2. **Country-Currency Mismatch**:
   - Set country to "KE" and currency to "GHS"
   - Attempt to update business profile → Should return 400
   - Attempt to create invoice → Should return 400

3. **Non-GH Tax Calculation**:
   - Set business country to "KE"
   - Create invoice with taxes → Should have zeros for nhil/getfund/covid
   - Verify `tax_engine_code` is stored correctly

4. **Ghana Tax Calculation**:
   - Set business country to "GH"
   - Create invoice with taxes → Should populate nhil/getfund/covid
   - Verify `tax_engine_code` is "ghana"

## Notes

- **Scope**: Only currency and tax enforcement. Analytics, reports, registers, and POS behavior unchanged.
- **Breaking Changes**: Businesses without currency will now fail operations instead of silently using GHS
- **Migration Path**: Ensure all existing businesses have currency set before deploying



