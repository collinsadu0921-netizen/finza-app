# Tier 2 Tax Plugins Implementation

## Summary

Implemented minimal VAT-only tax plugins for all Tier 2 countries (NG, KE, UG, TZ, RW, ZM) using the existing tax engine contract. All plugins are now registered in the tax engine registry and no longer throw `UnsupportedCountryError`.

## Implementation

### Plugin Files Created

1. **Nigeria (NG) - 7.5% VAT**
   - File: `lib/taxEngine/jurisdictions/nigeria.ts`
   - Rate: 7.5%
   - Single VAT tax line

2. **Kenya (KE) - 16% VAT**
   - File: `lib/taxEngine/jurisdictions/kenya.ts`
   - Rate: 16%
   - Single VAT tax line

3. **Zambia (ZM) - 16% VAT**
   - File: `lib/taxEngine/jurisdictions/zambia.ts`
   - Rate: 16%
   - Single VAT tax line

4. **East Africa (UG, TZ, RW) - 18% VAT**
   - File: `lib/taxEngine/jurisdictions/east-africa.ts`
   - Rate: 18%
   - Shared implementation for Uganda, Tanzania, and Rwanda
   - Single VAT tax line

### Registry Updates

**File**: `lib/taxEngine/index.ts`

All Tier 2 countries are now registered:
```typescript
const TAX_ENGINES: Record<string, TaxEngine> = {
  'GH': ghanaTaxEngine,    // Ghana - Tier 1 (compound VAT)
  'NG': nigeriaTaxEngine,  // Nigeria - Tier 2 (7.5% VAT)
  'KE': kenyaTaxEngine,    // Kenya - Tier 2 (16% VAT)
  'UG': eastAfricaTaxEngine, // Uganda - Tier 2 (18% VAT)
  'TZ': eastAfricaTaxEngine, // Tanzania - Tier 2 (18% VAT)
  'RW': eastAfricaTaxEngine, // Rwanda - Tier 2 (18% VAT)
  'ZM': zambiaTaxEngine,   // Zambia - Tier 2 (16% VAT)
}
```

### Tax Calculation Logic

**All Tier 2 plugins implement:**
- **Exclusive calculation**: `tax = baseAmount * rate`
- **Tax-inclusive reverse calculation**: `base = total / (1 + rate)`
- **Single VAT tax line**: `code: "VAT"`, `name: "VAT"`
- **No tax-on-tax**: Simple flat rate calculation
- **No multiple components**: Single tax line only

### Tax Rates

| Country | Code | VAT Rate | Plugin File |
|---------|------|----------|-------------|
| Nigeria | NG | 7.5% | `nigeria.ts` |
| Kenya | KE | 16% | `kenya.ts` |
| Uganda | UG | 18% | `east-africa.ts` |
| Tanzania | TZ | 18% | `east-africa.ts` |
| Rwanda | RW | 18% | `east-africa.ts` |
| Zambia | ZM | 16% | `zambia.ts` |

## Test Coverage

**File**: `lib/__tests__/taxEngine.test.ts`

### Tests Added:

1. **Exclusive Calculation Tests**
   - ✅ NG: `baseAmount=100` → `tax=7.5`, `total=107.5`
   - ✅ KE: `baseAmount=100` → `tax=16`, `total=116`
   - ✅ ZM: `baseAmount=100` → `tax=16`, `total=116`
   - ✅ UG: `baseAmount=100` → `tax=18`, `total=118`
   - ✅ TZ: `baseAmount=100` → `tax=18`, `total=118`
   - ✅ RW: `baseAmount=100` → `tax=18`, `total=118`

2. **Tax-Inclusive Reverse Calculation Tests**
   - ✅ NG: `total=107.5` → `base≈100`, `tax≈7.5`
   - ✅ KE: `total=116` → `base≈100`, `tax≈16`
   - ✅ UG: `total=118` → `base≈100`, `tax≈18`
   - ✅ ZM: `total=116` → `base≈100`, `tax≈16`

3. **Normalization Tests**
   - ✅ All Tier 2 countries normalize correctly via `normalizeCountry()`
   - ✅ Various input formats work (country names, codes, case variations)

4. **Registry Tests**
   - ✅ Tier 2 countries no longer throw `UnsupportedCountryError`
   - ✅ All Tier 2 countries resolve to correct engines

## Behavior Changes

### Before Implementation:
- Tier 2 countries (NG, KE, UG, TZ, RW, ZM) threw `UnsupportedCountryError`
- No tax calculation available for Tier 2 countries

### After Implementation:
- ✅ Tier 2 countries calculate VAT correctly
- ✅ All Tier 2 countries supported via tax engine registry
- ✅ No `UnsupportedCountryError` for Tier 2 countries
- ✅ Tax-inclusive and tax-exclusive modes work

## Files Modified

### New Files:
- `lib/taxEngine/jurisdictions/nigeria.ts`
- `lib/taxEngine/jurisdictions/kenya.ts`
- `lib/taxEngine/jurisdictions/zambia.ts`
- `lib/taxEngine/jurisdictions/east-africa.ts`

### Modified Files:
- `lib/taxEngine/index.ts` - Registry updated with all Tier 2 engines
- `lib/__tests__/taxEngine.test.ts` - Tests added for all Tier 2 countries

### Unchanged Files:
- ✅ `lib/taxEngine/jurisdictions/ghana.ts` - Ghana logic untouched
- ✅ `lib/vat.ts` - Retail VAT logic untouched
- ✅ All API routes - No changes needed
- ✅ All UI components - No changes needed

## Constraints Respected

✅ **NO Retail VAT logic changes** - `lib/vat.ts` untouched  
✅ **NO Ghana logic changes** - Ghana engine unchanged  
✅ **NO UI changes** - All UI components untouched  
✅ **NO Retail migration** - Retail storage unchanged  
✅ **NO reporting logic** - No report changes  
✅ **NO enforcement/compliance checks** - Minimal implementation only

## Tax Line Structure

All Tier 2 plugins return a single tax line with:
```typescript
{
  code: 'VAT',
  name: 'VAT',
  rate: 0.075 | 0.16 | 0.18, // Depending on country
  base: number, // Taxable base amount
  amount: number, // Calculated tax (base * rate)
  ledger_account_code: '2100', // Standard VAT control account
  ledger_side: 'credit' | 'debit', // Credit for sales, debit for purchases
  is_creditable_input: boolean, // True for purchases
  absorbed_to_cost: false // VAT is never absorbed
}
```

## Example Calculations

### Nigeria (7.5% VAT)
- Base: 100
- VAT: 7.5
- Total: 107.5

### Kenya/Zambia (16% VAT)
- Base: 100
- VAT: 16
- Total: 116

### Uganda/Tanzania/Rwanda (18% VAT)
- Base: 100
- VAT: 18
- Total: 118

## Verification

Run tests with:
```bash
npm test lib/__tests__/taxEngine.test.ts
```

**Expected Results:**
- ✅ All tests pass
- ✅ NG calculates 7.5% VAT correctly
- ✅ KE/ZM calculate 16% VAT correctly
- ✅ UG/TZ/RW calculate 18% VAT correctly
- ✅ Tax-inclusive reverse calculation works for all
- ✅ No `UnsupportedCountryError` for Tier 2 countries

## Next Steps (Out of Scope)

These are NOT part of this implementation:
- ❌ Tax rate updates or versioning
- ❌ Multiple tax components (keeping VAT-only)
- ❌ Reporting logic for Tier 2 countries
- ❌ Retail storage migration
- ❌ UI changes
- ❌ Enforcement or compliance checks
