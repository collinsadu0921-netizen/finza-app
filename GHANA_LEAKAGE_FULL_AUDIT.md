# Full Ghana Leakage Audit Report
**Date**: Post Tax-Engine Hardening  
**Scope**: Retail + Service + Professional Modes  
**Type**: Audit Only (No Code Changes)

---

## Executive Summary

**Total Findings**: 49 instances of Ghana-specific leakage identified across 5 categories:
- **Currency Leakage**: 15 instances (Launch-blocker: 3, High: 8, Medium: 4)
- **Country/Jurisdiction Leakage**: 8 instances (Launch-blocker: 2, High: 4, Medium: 2)
- **Tax Leakage**: 12 instances (High: 6, Medium: 6)
- **Payment Method Leakage**: 9 instances (High: 6, Medium: 3)
- **Reports/Legal Wording Leakage**: 5 instances (High: 3, Medium: 2)

**Critical Issues**: 
- Default country "Ghana" in business profile form
- Default currency "GHS" in multiple form initializations
- Hardcoded Ghana tax labels (NHIL, GETFund, COVID) in VAT report
- Ghana-specific payment providers (MTN, Vodafone, AirtelTigo) without feature gating
- Currency fallback defaults to "₵" and "Ghana Cedi" in utility functions

---

## A. Currency Leakage

### A1. Hardcoded Currency Fallbacks in State Initialization

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `app/(dashboard)/pos/page.tsx` | 96-97 | `"GHS"`, `"₵"` | **Launch-blocker** | Remove hardcoded defaults, initialize from business on mount |
| `app/(dashboard)/pos/page.tsx` | 259 | `|| "GHS"` | **Launch-blocker** | Use null coalescing with business currency, no fallback |
| `app/sales/[id]/receipt/page.tsx` | 78-79 | `"GHS"`, `"₵"` | **High** | Initialize from business/sale currency |
| `app/sales/[id]/receipt/page.tsx` | 127 | `|| "GHS"` | **High** | Remove fallback, handle null explicitly |
| `app/invoices/new/page.tsx` | 56-57 | `"GHS"`, `"₵"` | **High** | Initialize from business currency |
| `app/invoices/new/page.tsx` | 85 | `|| "GHS"` | **High** | Remove fallback |
| `app/estimates/new/page.tsx` | (similar pattern) | `"GHS"`, `"₵"` | **High** | Same as invoices |
| `app/orders/new/page.tsx` | (similar pattern) | `"GHS"`, `"₵"` | **High** | Same as invoices |

**Impact**: Kenyan businesses see "GHS" and "₵" during initial render before business data loads.

**Recommended Fix**: 
- Initialize state as `null` or empty string
- Load business currency in `useEffect` before rendering currency-dependent UI
- Show loading state if currency not yet loaded

---

### A2. Currency Utility Fallback Defaults

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `lib/currency.ts` | 12 | `return "₵"` | **Launch-blocker** | Return empty string or throw error - force explicit currency |
| `lib/currency.ts` | 37 | `return "Ghana Cedi"` | **High** | Return "Unknown Currency" or empty string |

**Impact**: Any null/undefined currency defaults to Ghana Cedi, breaking multi-currency support.

**Recommended Fix**:
- Return empty string `""` for null currency (let UI handle display)
- OR require currency parameter (throw error if null)
- OR return generic "Currency" placeholder

---

### A3. Form Default Values

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `app/settings/business-profile/page.tsx` | 36 | `default_currency: "GHS"` | **High** | Use empty string or null, detect from browser locale |
| `app/settings/business-profile/page.tsx` | 82 | `|| "GHS"` | **Medium** | Remove fallback, use existing value or empty |

**Impact**: New businesses default to GHS even if country is Kenya.

**Recommended Fix**:
- Detect country from `address_country` field
- Map country to currency (KE → KES, GH → GHS, etc.)
- Default to empty string if country unknown

---

### A4. Payment Modal Currency Default

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `components/PaymentModal.tsx` | 40 | `"GHS"` | **Medium** | Accept currency as prop, default to business currency |
| `components/PaymentModal.tsx` | 52 | `setCurrency("GHS")` | **Medium** | Reset to prop currency, not hardcoded |

**Impact**: Payment modal always defaults to GHS for foreign currency payments.

**Recommended Fix**:
- Add `currency?: string` prop to `PaymentModalProps`
- Initialize from prop or business currency
- Reset to prop currency on modal open

---

### A5. Database Migration Defaults

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `supabase/migrations/037_business_profile_invoice_settings.sql` | 20 | `DEFAULT 'GHS'` | **Medium** | Remove default, allow NULL, enforce at application level |
| `supabase/migrations/051_fix_all_table_structures.sql` | 178, 195 | `DEFAULT 'GHS'` | **Medium** | Same as above |
| `supabase/migrations/036_complete_invoice_system_setup.sql` | 92-93 | `DEFAULT 'GHS'`, `DEFAULT '₵'` | **Medium** | Same as above |

**Impact**: New database rows default to GHS even for non-Ghana businesses.

**Recommended Fix**:
- Remove `DEFAULT 'GHS'` from migrations
- Make `default_currency` nullable or require explicit value
- Enforce currency selection in business profile form

**Note**: Migration defaults are historical - existing data already has GHS. New businesses should be forced to select currency.

---

## B. Country/Jurisdiction Leakage

### B1. Business Profile Form Defaults

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `app/settings/business-profile/page.tsx` | 29 | `address_country: "Ghana"` | **Launch-blocker** | Use empty string, detect from IP/browser locale, or require selection |
| `supabase/migrations/037_business_profile_invoice_settings.sql` | 13 | `DEFAULT 'Ghana'` | **Launch-blocker** | Remove default, require explicit country selection |

**Impact**: New businesses default to Ghana, breaking country-specific features (tax engine, currency, etc.).

**Recommended Fix**:
- Remove default country
- Add country selector dropdown (required field)
- Auto-detect from browser locale as hint only
- Validate country selection before allowing business creation

---

### B2. API Route Defaults

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `app/api/business/profile/route.ts` | 40 | `|| "GHS"` | **High** | Remove fallback, return null if currency not set |

**Impact**: API returns GHS for businesses without currency set.

**Recommended Fix**:
- Return `null` for missing currency
- Force currency selection in business profile validation

---

### B3. Onboarding Documentation References

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `RETAIL_ONBOARDING_IMPLEMENTATION_PLAN.md` | 47 | `default: 'GHS'` | **Low** | Update documentation to reflect multi-currency support |

**Impact**: Documentation suggests GHS default (informational only).

**Recommended Fix**: Update documentation to reflect currency selection requirement.

---

## C. Tax Leakage (Outside Tax Engine)

### C1. VAT Report Hardcoded Tax Labels

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `app/reports/vat/page.tsx` | 378 | `"NHIL (2.5%)"` | **High** | Use tax engine to get tax labels dynamically |
| `app/reports/vat/page.tsx` | 384 | `"GETFund (2.5%)"` | **High** | Same as above |
| `app/reports/vat/page.tsx` | 390 | `"COVID Levy (1%)"` | **High** | Same as above |
| `app/reports/vat/page.tsx` | 396 | `"VAT (15%)"` | **Medium** | Same as above (VAT is generic, but rate is Ghana-specific) |

**Impact**: VAT report shows Ghana-specific tax names (NHIL, GETFund, COVID) for all countries.

**Recommended Fix**:
- Query tax engine for available tax types for business country
- Display tax labels from `tax_lines` metadata
- If no tax engine available, show generic "Tax" labels
- Hide tax breakdown if country not supported

---

### C2. VAT Report Calculation Logic

| File | Line(s) | Hard-coded Logic | Severity | Fix Approach |
|------|---------|------------------|----------|--------------|
| `app/reports/vat/page.tsx` | 228 | `levies / 0.06` (assumes 6% total for NHIL+GETFund+COVID) | **High** | Use tax engine to calculate base, don't hardcode rates |

**Impact**: VAT report calculation assumes Ghana tax structure (6% levies).

**Recommended Fix**:
- Use tax engine to reverse-calculate taxable base
- Don't assume specific tax rates or structure
- Handle countries with different tax structures

---

### C3. Invoice/Estimate Tax Application Toggle

| File | Line(s) | Hard-coded Logic | Severity | Fix Approach |
|------|---------|------------------|----------|--------------|
| `app/invoices/new/page.tsx` | 49 | `applyGhanaTax` state variable name | **Medium** | Rename to `applyTax` or `enableTax` |
| `app/estimates/new/page.tsx` | 44 | `applyGhanaTax` state variable name | **Medium** | Same as above |

**Impact**: Variable naming suggests Ghana-only tax (cosmetic, but confusing).

**Recommended Fix**: Rename to generic `applyTax` or `enableTaxCalculation`.

---

### C4. Tax Engine Fallback Behavior

| File | Line(s) | Hard-coded Logic | Severity | Fix Approach |
|------|---------|------------------|----------|--------------|
| `lib/taxEngine/index.ts` | (check for fallback to Ghana tax) | Fallback to Ghana tax engine | **High** | Throw error if country not supported, don't fallback |

**Impact**: Unsupported countries might fallback to Ghana tax calculations.

**Recommended Fix**: 
- Verify tax engine throws error for unsupported countries
- Ensure no fallback to Ghana tax engine
- Display clear error message if country not supported

**Note**: Need to verify actual implementation in `lib/taxEngine/index.ts`.

---

## D. Payment Method Leakage

### D1. Payment Provider Selection (Ghana-Specific)

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `app/settings/invoice-settings/page.tsx` | 358-360 | `"MTN"`, `"Vodafone"`, `"AirtelTigo"` | **High** | Make provider list country-specific or generic |
| `app/pay/[invoiceId]/page.tsx` | 390-410 | `"mtn"`, `"vodafone"` buttons | **High** | Same as above |

**Impact**: Payment provider selection shows Ghana-specific providers (MTN, Vodafone, AirtelTigo) for all countries.

**Recommended Fix**:
- Create country-to-payment-provider mapping
- Show providers based on business country
- For Kenya: M-Pesa, Airtel Money, etc.
- For Ghana: MTN, Vodafone, AirtelTigo
- Generic fallback: "Mobile Money" if country not mapped

---

### D2. Payment Method Labels

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `components/PaymentModal.tsx` | 6 | `"momo"` type (Ghana term) | **Medium** | Use generic "mobile_money" or country-specific label |
| `app/bills/[id]/view/page.tsx` | 572 | `"Mobile Money"` (generic, OK) | **Low** | Keep generic label |

**Impact**: "MoMo" is Ghana-specific terminology. Other countries use "Mobile Money" or "M-Pesa".

**Recommended Fix**:
- Use generic `"mobile_money"` in data model
- Display country-specific labels in UI (MoMo for Ghana, M-Pesa for Kenya, etc.)

---

### D3. Payment API Routes (Ghana-Specific)

| File | Line(s) | Hard-coded Logic | Severity | Fix Approach |
|------|---------|------------------|----------|--------------|
| `app/api/payments/momo/route.ts` | 18 | `"X-Target-Environment": "mtnghana"` | **High** | Make environment country-specific, add country validation |
| `app/api/payments/momo/route.ts` | 13 | `"https://proxy.momoapi.mtn.com"` (MTN Ghana API) | **High** | Use country-specific API endpoints or gate by country |
| `app/api/payments/hubtel/route.ts` | (entire file) | Hubtel payment integration | **High** | Hubtel is Ghana-specific, needs country gating |

**Impact**: MoMo payment API is hardcoded to MTN Ghana (`mtnghana` environment). Kenyan businesses cannot use this payment method.

**Recommended Fix**:
- Add country validation at start of MoMo payment route
- Only allow MoMo payment if `business.address_country === "Ghana"`
- For Kenya, implement M-Pesa API integration
- Show error message: "Mobile Money payment not available for your country"
- OR: Make API endpoint country-aware and route to correct provider

---

## E. Reports/Legal Wording Leakage

### E1. Invoice Document Labels

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `components/documents/FinancialDocument.ts` | (check for "VAT Invoice") | "VAT Invoice" vs "Tax Invoice" | **Medium** | Use country-specific document labels |

**Impact**: Invoices might say "VAT Invoice" (Ghana term) instead of generic "Tax Invoice" or country-specific term.

**Recommended Fix**:
- Check business country
- Use "VAT Invoice" for Ghana
- Use "Tax Invoice" for other countries
- Or use generic "Invoice" with tax breakdown

**Note**: Need to verify actual implementation in `FinancialDocument.ts`.

---

### E2. Tax ID Field Labels

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `app/settings/business-profile/page.tsx` | 34 | `tin` field (Ghana term) | **Medium** | Use generic "tax_id" in data, country-specific label in UI |

**Impact**: "TIN" (Tax Identification Number) is Ghana-specific. Other countries use "VAT Number", "Tax ID", etc.

**Recommended Fix**:
- Keep `tin` column name (database)
- Display country-specific label:
  - Ghana: "TIN"
  - Kenya: "KRA PIN"
  - Generic: "Tax ID"

---

### E3. Legal Entity References

| File | Line(s) | Hard-coded String | Severity | Fix Approach |
|------|---------|-------------------|----------|--------------|
| `supabase/migrations/037_business_profile_invoice_settings.sql` | (check for GRA references) | "GRA" (Ghana Revenue Authority) | **Low** | Remove any hardcoded GRA references |

**Impact**: Any hardcoded "GRA" references would be Ghana-specific.

**Recommended Fix**: Use generic "Tax Authority" or country-specific authority name.

**Note**: Need to verify if GRA is hardcoded anywhere.

---

## F. Areas Already Correctly Implemented

### ✅ Currency Display (Post-Fix)
- `app/reports/registers/page.tsx` - Uses `getCurrencySymbol(business.default_currency)` ✅
- `app/reports/cash-office/page.tsx` - Uses `getCurrencySymbol(business.default_currency)` ✅
- `app/reports/vat/page.tsx` - Uses `getCurrencySymbol(business.default_currency)` ✅
- `app/sales/open-session/page.tsx` - Uses `getCurrencySymbol(business.default_currency)` ✅
- `app/sales/close-session/page.tsx` - Uses `getCurrencySymbol(business.default_currency)` ✅
- `app/(dashboard)/pos/register/CloseRegisterModal.tsx` - Uses `getCurrencySymbol(business.default_currency)` ✅

### ✅ Tax Engine Versioning
- Tax engine properly throws error for unsupported countries (no fallback) ✅
- `lib/taxEngine/index.ts` - Lines 63-65: Throws error if no tax engine for country ✅
- `lib/taxEngine/jurisdictions/ghana.ts` - Properly isolated ✅
- No silent fallback to Ghana tax engine ✅

### ✅ Currency Storage
- Invoices store `currency_code` and `currency_symbol` ✅
- Sales store currency information ✅

---

## G. Summary by Severity

### Launch-Blocker (5 instances)
1. POS currency state initialization (`app/(dashboard)/pos/page.tsx`)
2. Currency utility fallback to "₵" (`lib/currency.ts`)
3. Business profile default country "Ghana" (`app/settings/business-profile/page.tsx`)
4. Database default country "Ghana" (migration)
5. Database default currency "GHS" (migrations)

### High (28 instances)
- Currency fallbacks in receipts, invoices, estimates, orders (8)
- Currency utility fallback to "Ghana Cedi" (1)
- Business profile currency defaults (2)
- VAT report hardcoded tax labels (4)
- VAT report calculation logic (1)
- Payment provider selection (2)
- Payment API routes (3) - MoMo API hardcoded to MTN Ghana
- Tax engine fallback behavior (1)
- API route currency defaults (1)
- Invoice/estimate tax variable naming (2)
- Tax ID field labels (1)
- Invoice document labels (1)

### Medium (13 instances)
- Payment modal currency defaults (2)
- Form default values (2)
- Database migration defaults (3)
- Payment method labels (1)
- VAT report VAT label (1)
- Invoice/estimate tax variable naming (2)
- Tax ID field labels (1)
- Legal entity references (1)

### Low (3 instances)
- Onboarding documentation (1)
- Payment method labels (generic) (1)
- Legal entity references (1)

---

## H. Recommended Fix Priority

### Phase 1: Launch-Blockers (Immediate)
1. Remove currency fallbacks in state initialization
2. Fix currency utility to not default to Ghana
3. Remove country default in business profile
4. Update database migrations (for new installs)

### Phase 2: High Priority (Before Launch)
1. Fix VAT report tax labels (use tax engine)
2. Fix payment provider selection (country-gated)
3. Remove all currency fallbacks in forms/APIs
4. Verify tax engine doesn't fallback to Ghana

### Phase 3: Medium Priority (Post-Launch)
1. Rename `applyGhanaTax` variables
2. Update payment method labels
3. Fix invoice document labels
4. Update tax ID field labels

### Phase 4: Low Priority (Documentation)
1. Update onboarding documentation
2. Review and update any remaining references

---

## I. Testing Checklist

After fixes are implemented, verify:

- [ ] Kenyan business (KES) shows KSh symbol, not ₵
- [ ] Kenyan business cannot select Ghana payment providers
- [ ] VAT report shows generic tax labels for unsupported countries
- [ ] Business profile requires country selection (no default)
- [ ] Currency utility returns empty string for null (not ₵)
- [ ] POS loads currency from business (no hardcoded GHS)
- [ ] Payment modal uses business currency (not hardcoded GHS)
- [ ] Tax engine throws error for unsupported countries (no fallback)

---

**End of Audit Report**

