# Country Engine Plugin Architecture Audit
**Read-only analysis of country-specific logic gaps and Ghana fallback risks**

## 1. Currency Module

### Areas Requiring Country Enforcement (Currently Missing)

#### 1.1 Database Migrations
**Location**: `supabase/migrations/090_final_hard_constraints.sql:303`
- **Issue**: `COALESCE(default_currency, 'GHS')` hardcoded fallback
- **Protection Level**: (c) No protection - silent Ghana fallback
- **Risk**: Functions/triggers default to GHS if currency missing

#### 1.2 Legacy Migration Defaults
**Locations**: Multiple migrations (034, 035, 036, 037, 051)
- **Issue**: `DEFAULT 'GHS'` in column definitions (removed in 126, but existing data may have GHS)
- **Protection Level**: (b) Implicit Ghana-first assumption in schema
- **Risk**: Existing businesses may have GHS from old defaults

#### 1.3 API Routes - Hardcoded Currency Symbols
**Locations**:
- `app/api/invoices/[id]/send/route.ts:119`: `currency_symbol || "₵"`
- `app/api/reminders/process-automated/route.ts:345`: `"₵"` hardcoded
- `app/api/reminders/overdue/route.ts:165`: `"GHS"` hardcoded in message
- `app/api/recurring-invoices/generate/route.ts:253`: `"GHS"` hardcoded in message
- `app/api/orders/[id]/convert-to-invoice/route.ts:225-226`: `"GHS"` and `"₵"` hardcoded
- `app/api/bills/[id]/payments/route.ts:174`: `₵` hardcoded in error message

**Protection Level**: (b) Implicit Ghana-first assumption
**Risk**: Messages/notifications show Ghana currency for non-GH businesses

#### 1.4 Currency Symbol Mapping
**Location**: `lib/currency.ts`
- **Status**: No country gate - symbol map is currency-code based
- **Protection Level**: (a) Explicit - currency code determines symbol (no country needed)
- **Risk**: Low - works correctly if currency code is set

### New Country Plugin Impact
- **Currency Isolation**: ❌ NOT automatic
  - Hardcoded `₵` and `GHS` in API routes will leak
  - Database functions with GHS fallback will leak
  - Migration defaults (if any remain) will leak

### Missing Guardrails
- No validation that currency matches country (e.g., KE business with GHS currency)
- No country-to-currency mapping enforcement
- No check that currency symbol matches country context

### Silent Ghana Fallbacks
- Database function: `COALESCE(default_currency, 'GHS')` in migration 090
- API routes: `currency_symbol || "₵"` fallbacks
- Message templates: Hardcoded "GHS" and "₵" strings

---

## 2. Tax Module

### Areas Requiring Country Enforcement (Currently Missing)

#### 2.1 Tax Engine Selection
**Location**: `lib/taxEngine/index.ts`
- **Status**: ✅ Has explicit country gate via `normalizeJurisdiction()`
- **Protection Level**: (a) Explicit country gate
- **Behavior**: Throws error if country missing; uses fallback engine (zero taxes) for unsupported countries
- **Risk**: Low - properly isolated

#### 2.2 Legacy Tax Functions (Direct Ghana Calls)
**Locations**:
- `lib/ghanaTaxEngine.ts`: Direct Ghana tax calculation
- `lib/vat.ts`: `calculateGhanaVAT()` function
- `app/api/bills/create/route.ts:73`: Comment says "Calculate totals using Ghana Tax Engine"
- `app/api/estimates/create/route.ts:62`: Comment says "Calculate Ghana taxes"

**Protection Level**: (b) Implicit Ghana-first assumption
**Risk**: These functions may be called without country check

#### 2.3 VAT Report Calculations
**Location**: `app/reports/vat/page.tsx`
- **Issue**: Directly queries `nhil, getfund, covid, vat` columns
- **Protection Level**: (c) No protection - assumes Ghana tax structure
- **Risk**: Report will show Ghana tax breakdown for non-GH businesses

#### 2.4 VAT Returns API
**Location**: `app/api/vat-returns/calculate/route.ts`
- **Issue**: Queries `nhil, getfund, covid, vat` columns directly
- **Protection Level**: (c) No protection - assumes Ghana tax structure
- **Risk**: VAT return calculation uses Ghana structure for all countries

#### 2.5 Tax Line Derivation
**Location**: `lib/taxEngine/helpers.ts:12` - `deriveLegacyGhanaTaxAmounts()`
- **Issue**: Function name implies Ghana, but used generically
- **Protection Level**: (b) Implicit Ghana-first assumption
- **Risk**: May extract wrong tax codes for non-GH countries

#### 2.6 Invoice/Bill Creation
**Location**: `app/api/invoices/create/route.ts:231-233`
- **Issue**: Derives legacy Ghana taxes from tax_lines for all countries
- **Protection Level**: (b) Implicit Ghana-first assumption
- **Risk**: Stores nhil/getfund/covid even for non-GH invoices

### New Country Plugin Impact
- **Tax Logic Isolation**: ⚠️ PARTIAL
  - Tax engine selection is isolated ✅
  - VAT reports are NOT isolated ❌ (hardcoded Ghana columns)
  - VAT returns API is NOT isolated ❌ (hardcoded Ghana columns)
  - Legacy tax derivation assumes Ghana structure ❌

### Missing Guardrails
- No validation that tax_engine_code matches business country
- No check that tax_lines structure matches country requirements
- No guard against calling Ghana-specific functions for non-GH businesses
- VAT report has no country check before displaying Ghana tax breakdown

### Silent Ghana Fallbacks
- `deriveLegacyGhanaTaxAmounts()` extracts NHIL/GETFund/COVID/VAT for all countries
- VAT report queries Ghana columns without country check
- VAT returns API calculates using Ghana structure for all countries

---

## 3. Analytics Module

### Areas Requiring Country Enforcement (Currently Missing)

#### 3.1 VAT Report
**Location**: `app/reports/vat/page.tsx`
- **Issue**: Displays NHIL, GETFund, COVID labels and calculations
- **Protection Level**: (c) No protection - assumes Ghana tax structure
- **Risk**: Shows Ghana-specific tax labels for all countries

#### 3.2 Cash Office Report
**Location**: `app/reports/cash-office/page.tsx`, `app/api/reports/cash-office/route.ts`
- **Issue**: Tracks `hubtel_total` as payment method
- **Protection Level**: (b) Implicit Ghana-first assumption
- **Risk**: Hubtel is Ghana-specific provider, but tracked for all countries

#### 3.3 Register Reports
**Location**: `app/reports/registers/page.tsx:137`
- **Issue**: Tracks `hubtel_total` in register stats
- **Protection Level**: (b) Implicit Ghana-first assumption
- **Risk**: Hubtel tracking assumes Ghana context

#### 3.4 Dashboard Analytics
**Location**: `app/admin/retail/analytics/page.tsx`
- **Status**: Unknown - needs verification
- **Protection Level**: Unknown
- **Risk**: May aggregate Ghana-specific metrics

### New Country Plugin Impact
- **Analytics Isolation**: ❌ NOT automatic
  - VAT report structure is Ghana-specific
  - Payment method analytics include Ghana providers
  - No country-based filtering in analytics queries

### Missing Guardrails
- No country check before displaying tax breakdown in reports
- No filtering of country-specific payment methods in analytics
- No validation that report structure matches country tax system

### Silent Ghana Fallbacks
- VAT report displays Ghana tax labels regardless of country
- Analytics aggregate Hubtel payments for all countries
- No country-based report template selection

---

## 4. Registers Module

### Areas Requiring Country Enforcement (Currently Missing)

#### 4.1 Register Reports
**Location**: `app/reports/registers/page.tsx:137`
- **Issue**: Tracks `hubtel_total` in register statistics
- **Protection Level**: (b) Implicit Ghana-first assumption
- **Risk**: Hubtel is Ghana-only provider, but tracked globally

#### 4.2 Cash Office Reports
**Location**: `app/api/reports/cash-office/route.ts:269,414-415`
- **Issue**: Aggregates `hubtel` payment method for all registers
- **Protection Level**: (b) Implicit Ghana-first assumption
- **Risk**: Hubtel totals calculated for non-GH businesses

#### 4.3 Register Session Calculations
**Location**: `lib/db/actions/register.ts`
- **Status**: No country-specific logic found
- **Protection Level**: (a) Explicit - currency-agnostic calculations
- **Risk**: Low - calculations are currency-neutral

### New Country Plugin Impact
- **Register Isolation**: ⚠️ PARTIAL
  - Core register logic is isolated ✅
  - Payment method tracking includes Ghana providers ❌
  - Reports aggregate Ghana-specific methods ❌

### Missing Guardrails
- No country check before aggregating payment methods
- No filtering of country-specific providers in register reports
- No validation that payment methods match country eligibility

### Silent Ghana Fallbacks
- Register reports include Hubtel totals for all countries
- Cash office reports aggregate Hubtel for all countries
- No country-based payment method filtering

---

## 5. Reports Module

### Areas Requiring Country Enforcement (Currently Missing)

#### 5.1 VAT Report
**Location**: `app/reports/vat/page.tsx`
- **Issue**: Hardcoded Ghana tax structure (NHIL, GETFund, COVID, VAT)
- **Protection Level**: (c) No protection
- **Risk**: Displays Ghana tax breakdown for all countries

#### 5.2 VAT Diagnostic Report
**Location**: `app/reports/vat/diagnostic/page.tsx`
- **Issue**: Queries and displays Ghana tax columns
- **Protection Level**: (c) No protection
- **Risk**: Diagnostic tool assumes Ghana structure

#### 5.3 Balance Sheet
**Location**: `app/reports/balance-sheet/page.tsx`
- **Status**: Unknown - needs verification
- **Protection Level**: Unknown
- **Risk**: May assume Ghana currency/formatting

#### 5.4 Cash Office Report
**Location**: `app/reports/cash-office/page.tsx`
- **Issue**: Displays Hubtel as payment method
- **Protection Level**: (b) Implicit Ghana-first assumption
- **Risk**: Shows Ghana provider for all countries

### New Country Plugin Impact
- **Reports Isolation**: ❌ NOT automatic
  - VAT reports are Ghana-specific
  - Payment method reports include Ghana providers
  - No country-based report template selection

### Missing Guardrails
- No country check before rendering report structure
- No country-based report template selection
- No validation that report columns match country tax system
- No filtering of country-specific payment methods

### Silent Ghana Fallbacks
- VAT report structure assumes Ghana for all countries
- Payment method reports include Ghana providers
- No country-based report customization

---

## 6. Summary: New Country Plugin Risks

### Automatic Isolation Status

| Module | Currency | Tax Logic | Analytics | Reports |
|--------|----------|-----------|-----------|---------|
| **KE/NG/ZA Plugin** | ❌ Leaks | ⚠️ Partial | ❌ Leaks | ❌ Leaks |

### What WOULD Automatically Isolate
- ✅ Tax engine selection (via `lib/taxEngine/index.ts`)
- ✅ Payment method eligibility (via `lib/payments/eligibility.ts`)
- ✅ Currency symbol mapping (via `lib/currency.ts` - currency-code based)

### What WOULD NOT Automatically Isolate
- ❌ VAT report structure (hardcoded Ghana columns)
- ❌ VAT returns API (hardcoded Ghana calculations)
- ❌ Analytics payment method tracking (includes Hubtel)
- ❌ Register reports (includes Hubtel)
- ❌ API route currency fallbacks (hardcoded `₵` and `GHS`)
- ❌ Message templates (hardcoded Ghana currency)
- ❌ Database functions (GHS fallback in migration 090)

---

## 7. Missing Guardrails (Pre-Plugin Requirements)

### Required Interfaces
1. **Country Engine Interface**: No defined interface for country-specific engines
2. **Tax Report Interface**: No interface for country-specific report structures
3. **Currency Validation**: No country-to-currency mapping validation
4. **Payment Provider Interface**: No interface for country-specific providers

### Default Fallbacks
1. **Tax Engine**: ✅ Has fallback (zero-tax engine for unsupported countries)
2. **Currency**: ❌ Missing - hardcoded GHS fallbacks exist
3. **Payment Methods**: ✅ Has fallback (cash+card for unknown countries)
4. **Reports**: ❌ Missing - no fallback report structure

### Explicit "Unsupported Country" Behavior
1. **Tax Calculation**: ✅ Explicit (zero-tax fallback with warning)
2. **Currency**: ❌ Missing (silent GHS fallback)
3. **Payment Methods**: ✅ Explicit (cash+card only)
4. **Reports**: ❌ Missing (shows Ghana structure)
5. **Analytics**: ❌ Missing (includes Ghana providers)

---

## 8. Silent Ghana Fallback Locations

### High Risk (Data Corruption)
1. **Database Function**: `COALESCE(default_currency, 'GHS')` in migration 090
2. **VAT Report**: Queries Ghana columns without country check
3. **VAT Returns API**: Calculates using Ghana structure for all countries
4. **Tax Derivation**: `deriveLegacyGhanaTaxAmounts()` used for all countries

### Medium Risk (UI/UX Issues)
1. **API Routes**: `currency_symbol || "₵"` fallbacks (7 locations)
2. **Message Templates**: Hardcoded "GHS" and "₵" (4 locations)
3. **Analytics**: Hubtel tracking for all countries
4. **Register Reports**: Hubtel totals for all countries

### Low Risk (Naming Only)
1. **Function Names**: `calculateGhanaTaxes()`, `calculateGhanaVAT()` (may be called incorrectly)
2. **Comments**: References to "Ghana Tax Engine" in code comments

---

## 9. Risk Matrix by Module

| Module | Explicit Gate | Implicit Ghana | No Protection | Silent Fallback |
|--------|---------------|----------------|---------------|-----------------|
| **Currency** | ✅ Symbol mapping | ⚠️ API fallbacks | ❌ DB functions | ⚠️ 7 API routes |
| **Tax** | ✅ Engine selection | ⚠️ Legacy functions | ❌ VAT reports | ⚠️ Tax derivation |
| **Analytics** | ❌ None | ⚠️ Hubtel tracking | ❌ VAT reports | ⚠️ Report structure |
| **Registers** | ✅ Core logic | ⚠️ Payment methods | ❌ Reports | ⚠️ Hubtel totals |
| **Reports** | ❌ None | ⚠️ Payment methods | ❌ VAT structure | ⚠️ Ghana columns |

**Legend**:
- ✅ = Protected
- ⚠️ = Partial protection / implicit assumption
- ❌ = No protection

---

## 10. Critical Gaps for Country Plugin Support

### Must Fix Before Plugin Support
1. **VAT Report Structure**: Country-based report template selection
2. **VAT Returns API**: Country-based calculation logic
3. **Currency Fallbacks**: Remove all hardcoded GHS/₵ fallbacks
4. **Analytics Filtering**: Country-based payment method filtering
5. **Database Functions**: Remove GHS fallback from migration 090

### Should Fix Before Plugin Support
1. **Message Templates**: Dynamic currency in notifications
2. **Report Labels**: Country-based tax label selection
3. **Legacy Tax Functions**: Deprecate or gate Ghana-specific functions
4. **Tax Derivation**: Country-aware tax line extraction

### Nice to Have
1. **Country Engine Interface**: Formal plugin architecture
2. **Report Templates**: Country-specific report structures
3. **Currency Validation**: Country-to-currency mapping enforcement



