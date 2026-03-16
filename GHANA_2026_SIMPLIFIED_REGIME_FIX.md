# Ghana 2026+ Simplified VAT Regime Fix

## Summary

Corrected the Ghana 2026+ tax computation to use a **1.20 multiplier** (not 1.2075) and ensure VAT, NHIL, and GETFund are calculated on the **SAME base** in line with GRA's simplified VAT regime.

## Problem

The previous implementation treated VAT as being charged on (base + NHIL + GETFund), producing a compound calculation and a **1.2075 multiplier**. This was incorrect for the 2026+ simplified regime.

**Previous (Incorrect) Calculation for 2026+:**
- NHIL = base * 0.025 = 100 * 0.025 = 2.5
- GETFund = base * 0.025 = 100 * 0.025 = 2.5
- COVID = 0 (removed)
- VAT = (base + NHIL + GETFund) * 0.15 = (100 + 2.5 + 2.5) * 0.15 = 15.75
- Total Tax = 2.5 + 2.5 + 0 + 15.75 = 20.75
- Grand Total = 100 + 20.75 = **120.75**
- Multiplier = 1.2075

## Solution

**Correct (2026+ Simplified Regime) Calculation:**
- NHIL = base * 0.025 = 100 * 0.025 = 2.5
- GETFund = base * 0.025 = 100 * 0.025 = 2.5
- COVID = 0 (removed)
- VAT = base * 0.15 = 100 * 0.15 = **15** (on same base, not compound)
- Total Tax = 2.5 + 2.5 + 0 + 15 = **20**
- Grand Total = 100 + 20 = **120**
- Multiplier = **1.20**

## Changes Made

### 1. Shared Versioning Logic (`lib/taxEngine/jurisdictions/ghana-shared.ts`)

**Added:**
- `isSimplifiedRegime(effectiveDate)`: Detects if date is >= 2026-01-01

**Updated:**
- `getGhanaTaxMultiplier(rates, effectiveDate)`: Now requires `effectiveDate` parameter
  - **Pre-2026 (Compound)**: Returns `(1 + nhil + getfund + covid) * (1 + vat)` = 1.219
  - **Post-2026 (Simplified)**: Returns `1 + (vat + nhil + getfund)` = 1.20

### 2. New Ghana Engine (`lib/taxEngine/jurisdictions/ghana.ts`)

**Updated `calculateFromAmount()`:**
- Checks if simplified regime using `isSimplifiedRegime()`
- **Pre-2026**: VAT on (base + NHIL + GETFund + COVID) - compound calculation
- **Post-2026**: VAT on same base as NHIL and GETFund - simplified calculation

**Updated `reverseCalculate()`:**
- Passes `effectiveDate` to `getGhanaTaxMultiplier()` to get correct multiplier

### 3. Legacy Ghana Engine (`lib/ghanaTaxEngine.ts`)

**Updated `calculateGhanaTaxes()`:**
- Checks if simplified regime
- **Pre-2026**: VAT on (base + NHIL + GETFund + COVID) - compound
- **Post-2026**: VAT on same base - simplified

**Updated `calculateBaseFromTotalIncludingTaxes()`:**
- Passes `effectiveDate` to `getGhanaTaxMultiplier()` to get correct multiplier (1.20 for 2026+)

### 4. Retail VAT Helpers (`lib/vat.ts`)

**Updated `calculateGhanaVAT()`:**
- Checks if simplified regime
- **Pre-2026**: VAT on (base + NHIL + GETFund + COVID) - compound
- **Post-2026**: VAT on same base - simplified

**Updated `extractTaxFromInclusivePrice()`:**
- Passes `effectiveDate` to `getGhanaTaxMultiplier()` to get correct multiplier (1.20 for 2026+)

**Updated `calculateCartTaxes()` (VAT-exclusive mode):**
- Checks if simplified regime
- Uses simplified calculation for 2026+

### 5. Tests Updated (`lib/__tests__/ghana-tax-consistency.test.ts`)

**Added Tests:**
- ✅ Post-2026 uses simplified calculation (base=100 → total=120, VAT=15)
- ✅ Post-2026 multiplier is exactly 1.20
- ✅ No path returns 120.75 for base=100 on or after 2026-01-01
- ✅ Reverse calculation works correctly (total=120 → base=100)
- ✅ VAT base equals taxable amount in simplified regime

**Updated Tests:**
- ✅ Post-2026 tax calculation expects total=120 (not 120.75)
- ✅ Post-2026 VAT expects 15 (not 15.75)
- ✅ Post-2026 reverse calculation uses total=120 (not 120.75)

## Numerical Results

### Pre-2026 (Compound Regime) - Unchanged:
- **Base**: 100
- **NHIL**: 2.5 (2.5% of base)
- **GETFund**: 2.5 (2.5% of base)
- **COVID**: 1.0 (1% of base)
- **VAT**: 15.9 (15% of base + levies = 15% of 106 = 15.9)
- **Total Tax**: 21.9
- **Grand Total**: 121.9
- **Multiplier**: 1.219

### Post-2026 (Simplified Regime) - Corrected:
- **Base**: 100
- **NHIL**: 2.5 (2.5% of base)
- **GETFund**: 2.5 (2.5% of base)
- **COVID**: 0 (removed)
- **VAT**: 15 (15% of base - **same base**, not compound)
- **Total Tax**: 20
- **Grand Total**: 120
- **Multiplier**: 1.20

## Key Differences

| Aspect | Pre-2026 (Compound) | Post-2026 (Simplified) |
|--------|---------------------|------------------------|
| VAT Calculation | On (base + NHIL + GETFund + COVID) | On same base |
| COVID Rate | 1% | 0% (removed) |
| Multiplier | 1.219 | 1.20 |
| Base=100 → Total | 121.9 | 120 |
| Base=100 → VAT | 15.9 | 15 |

## Verification

Run tests with:
```bash
npm test lib/__tests__/ghana-tax-consistency.test.ts
```

**Expected Results:**
- ✅ All tests pass
- ✅ Pre-2026 remains unchanged (multiplier 1.219, compound calculation)
- ✅ Post-2026 uses multiplier 1.20 (simplified calculation)
- ✅ Base=100 → Total=120 for 2026+
- ✅ Total=120 → Base=100 for 2026+
- ✅ VAT=15, NHIL=2.5, GETFund=2.5 for 2026+
- ✅ No path returns 120.75 for base=100 on or after 2026-01-01

## Constraints Respected

✅ **NO UI changes** - All UI components untouched  
✅ **NO storage changes** - Storage schemas untouched  
✅ **NO Retail migration** - Retail logic unchanged (only calculation corrected)  
✅ **NO Tier 1/2 VAT-only plugins touched** - Only Ghana logic updated  
✅ **NO effective-date boundaries changed** - Still 2026-01-01  
✅ **NO legacy code deleted** - All legacy code preserved, only corrected  

## Impact

### Numerical Correctness:
- ✅ All three paths now produce identical results for 2026+ dates
- ✅ Multiplier is correctly 1.20 (not 1.2075) for 2026+
- ✅ VAT, NHIL, GETFund all calculated on same base for 2026+

### Backward Compatibility:
- ✅ Pre-2026 calculations unchanged (still compound, multiplier 1.219)
- ✅ All existing code continues to work
- ✅ Default behavior unchanged (uses current date)

### Risk Level:
- **Low**: Changes are isolated to 2026+ tax calculation logic
- **Tested**: Comprehensive tests prove correctness
- **Backward Compatible**: Pre-2026 logic unchanged

## Files Modified

### Modified Files:
- `lib/taxEngine/jurisdictions/ghana-shared.ts` - Added simplified regime detection, updated multiplier calculation
- `lib/taxEngine/jurisdictions/ghana.ts` - Updated to use simplified calculation for 2026+
- `lib/ghanaTaxEngine.ts` - Updated to use simplified calculation for 2026+
- `lib/vat.ts` - Updated to use simplified calculation for 2026+
- `lib/__tests__/ghana-tax-consistency.test.ts` - Updated tests for simplified regime

### Unchanged Files:
- ✅ All API routes (no changes needed - backward compatible)
- ✅ All UI components (no changes needed)
- ✅ Storage schemas (no changes)
- ✅ Tier 1/2 VAT-only plugins (untouched)
