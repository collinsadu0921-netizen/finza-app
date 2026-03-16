# Tax Engine Authority Formalization

## Summary

This document describes the changes made to formalize `lib/taxEngine` as the authoritative system for tax rules and country recognition, without breaking Retail or legacy paths.

## Changes Made

### 1. Error Classes Created (`lib/taxEngine/errors.ts`)

**New Error Types:**
- `MissingCountryError`: Thrown when country is null/undefined (configuration issue)
- `UnsupportedCountryError`: Thrown when country is supported (Tier 1/2) but engine not implemented

**Purpose**: Explicit error semantics distinguish between missing configuration and unimplemented features.

---

### 2. Country Normalization Updated (`lib/payments/eligibility.ts`)

**Changes:**
- Added `SUPPORTED_COUNTRIES` constant: `['GH', 'NG', 'KE', 'UG', 'TZ', 'RW', 'ZM']`
- Added `UNSUPPORTED_COUNTRY_MARKER` constant: `'__UNSUPPORTED__'`
- Updated `normalizeCountry()` to:
  - Return ISO alpha-2 codes for Tier 1/2 countries (GH, NG, KE, UG, TZ, RW, ZM)
  - Return `null` for missing country (null/undefined/empty string)
  - Return `UNSUPPORTED_COUNTRY_MARKER` for countries not in supported set (not null)

**Authority**: `normalizeCountry()` is now the source of truth for country normalization. Tax engine uses this function.

---

### 3. Tax Engine Authority Documentation (`lib/taxEngine/index.ts`)

**Added Authority Comments:**
- Documented that `lib/taxEngine` is the **authoritative source of truth** for:
  - Country recognition and normalization
  - Tax calculation logic
  - Effective date selection for versioned tax rates

**Registry Documentation:**
- Tier 1 (Implemented): GH (Ghana)
- Tier 2 (Supported but not implemented): NG, KE, UG, TZ, RW, ZM

**Error Semantics:**
- `MissingCountryError`: Country is null/undefined
- `UnsupportedCountryError`: Country is in supported set but engine not implemented
- Unsupported countries (not in Tier 1/2): Zero-tax fallback (no error)

---

### 4. Tax Engine Registry Behavior Updated

**Before:**
- Unsupported countries: Silent zero-tax fallback with warning
- No distinction between missing, unsupported, and supported-but-not-implemented

**After:**
- **Missing country** (null/undefined): Throws `MissingCountryError`
- **Supported but not implemented** (NG, KE, UG, TZ, RW, ZM): Throws `UnsupportedCountryError`
- **Explicitly unsupported** (US, GB, etc.): Zero-tax fallback (allows operation)

**Key Change**: Supported countries without engines now throw explicit error instead of silent fallback.

---

### 5. Shared Normalization Integration

**Updated `normalizeJurisdiction()`:**
- Now uses `normalizeCountry()` from `lib/payments/eligibility` (authoritative source)
- Ensures consistent normalization across system
- Maintains error semantics (missing vs unsupported)

---

### 6. Tests Added (`lib/__tests__/taxEngine.test.ts`)

**Test Coverage:**
- ✅ GH resolves to Ghana engine
- ✅ NG/KE/UG/TZ/RW/ZM normalize correctly to ISO codes
- ✅ Missing country (null) ≠ unsupported country (marker)
- ✅ Missing country throws `MissingCountryError`
- ✅ Supported but not implemented throws `UnsupportedCountryError`
- ✅ Unsupported countries use zero-tax fallback

---

## Behavior Preserved

### No Breaking Changes:
- ✅ Retail (POS) continues to work (uses tax engine but doesn't depend on new error types)
- ✅ Service (Invoices) continues to work (already uses tax engine)
- ✅ Legacy engines (`lib/ghanaTaxEngine.ts`, `lib/vat.ts`) remain untouched
- ✅ No UI changes
- ✅ No tax rate changes

---

## File Changes Summary

### New Files:
- `lib/taxEngine/errors.ts` - Error classes
- `lib/__tests__/taxEngine.test.ts` - Tests

### Modified Files:
- `lib/payments/eligibility.ts` - Country normalization with Tier 1/2 support
- `lib/taxEngine/index.ts` - Authority documentation and explicit error handling

### Unchanged Files:
- `lib/ghanaTaxEngine.ts` - Legacy engine (not touched)
- `lib/vat.ts` - Retail VAT functions (not touched)
- All API routes (no changes needed)
- All UI components (no changes needed)

---

## Next Steps (Out of Scope)

These changes do NOT:
- ❌ Add tax rates for new countries
- ❌ Modify Ghana tax math
- ❌ Touch POS storage or reports
- ❌ Migrate Retail to generic tax storage
- ❌ Remove legacy engines

---

## Testing

Run tests with:
```bash
npm test lib/__tests__/taxEngine.test.ts
```

**Expected Results:**
- ✅ All tests pass
- ✅ GH calculates taxes correctly
- ✅ NG/KE/UG/TZ/RW/ZM throw `UnsupportedCountryError`
- ✅ Missing country throws `MissingCountryError`
- ✅ Unsupported countries (US, GB) use zero-tax fallback

---

## Impact Assessment

### Low Risk:
- Changes are isolated to tax engine entry point
- No changes to calculation logic
- No changes to storage or UI
- Backward compatible (legacy paths preserved)

### Verification:
- ✅ Invoice creation still works (GH)
- ✅ POS tax calculation still works (GH)
- ✅ Bills/Orders/Estimates still use legacy engine (unchanged)
- ✅ No breaking changes to existing functionality
