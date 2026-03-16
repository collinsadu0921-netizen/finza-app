# Multi-Country Support Guardrails Specification
**Architecture rules and invariants for country engine plugins**

## 1. Country Invariants

### 1.1 Required Truths (MUST be true when country is set)

**INV-1.1**: Business country code MUST be normalized to ISO 3166-1 alpha-2 format (e.g., "GH", "KE", "NG")
- **Enforcement**: Database constraint or application-level normalization
- **Violation Impact**: Country matching fails, tax engine selection fails, payment eligibility fails

**INV-1.2**: Country code MUST be non-null and non-empty before any country-dependent operation
- **Enforcement**: API route validation, UI component guards
- **Violation Impact**: Tax calculation fails, payment methods unavailable, currency undefined

**INV-1.3**: Country code MUST map to exactly one tax engine OR explicitly use zero-tax fallback
- **Enforcement**: Tax engine registry lookup with explicit fallback
- **Violation Impact**: Tax calculation undefined, invoice creation fails

**INV-1.4**: Country code MUST determine payment method eligibility (via eligibility system)
- **Enforcement**: Payment eligibility module before any payment operation
- **Violation Impact**: Payment methods leak across countries, provider APIs accessible incorrectly

**INV-1.5**: Country code MUST determine currency validation rules
- **Enforcement**: Country-to-currency mapping validation
- **Violation Impact**: Invalid currency-country combinations allowed

### 1.2 Forbidden Behaviors (MUST NOT happen)

**FORB-1.1**: MUST NOT silently default country to "Ghana" or "GH"
- **Violation Impact**: Non-GH businesses receive Ghana tax calculations, Ghana payment methods
- **Detection**: Any code path that sets country to "Ghana" without explicit user input

**FORB-1.2**: MUST NOT assume country is Ghana when country is null/undefined
- **Violation Impact**: Missing country data treated as Ghana, incorrect tax/payment logic
- **Detection**: Any conditional that treats null country as Ghana

**FORB-1.3**: MUST NOT use country-agnostic logic when country-specific logic exists
- **Violation Impact**: Generic calculations applied to country-specific requirements
- **Detection**: Tax/report logic that doesn't check country before applying rules

**FORB-1.4**: MUST NOT allow country changes without revalidating dependent data
- **Violation Impact**: Existing invoices/sales have wrong tax structure, currency mismatches
- **Detection**: Country update operations that don't trigger validation

### 1.3 Explicitly Forbidden Silent Fallbacks

**FORB-CURRENCY-1**: MUST NOT default currency to "GHS" when currency is missing
- **Required Behavior**: Return null/error, block currency-dependent operations
- **Violation Locations**: Database functions, API routes, UI components

**FORB-CURRENCY-2**: MUST NOT default currency symbol to "₵" when symbol is missing
- **Required Behavior**: Return null/error, show placeholder
- **Violation Locations**: API routes, message templates, export functions

**FORB-TAX-1**: MUST NOT use Ghana tax structure (NHIL/GETFund/COVID/VAT) for non-GH countries
- **Required Behavior**: Use country-specific tax engine OR zero-tax fallback
- **Violation Locations**: VAT reports, VAT returns API, tax derivation functions

**FORB-TAX-2**: MUST NOT query Ghana tax columns (nhil, getfund, covid) without country check
- **Required Behavior**: Country-aware column selection OR country-specific report structure
- **Violation Locations**: VAT report queries, analytics aggregations

**FORB-REPORT-1**: MUST NOT render Ghana tax labels (NHIL, GETFund, COVID) for non-GH countries
- **Required Behavior**: Country-based label selection OR generic tax line rendering
- **Violation Locations**: VAT report UI, invoice tax breakdowns, analytics displays

**FORB-REPORT-2**: MUST NOT assume Ghana report structure for all countries
- **Required Behavior**: Country-based report template selection OR explicit "unsupported" state
- **Violation Locations**: VAT report rendering, tax breakdown displays

---

## 2. Currency Guardrails

### 2.1 Single Source of Truth

**CURR-1**: Business currency MUST come from `businesses.default_currency` column only
- **No Alternatives**: No environment variables, no hardcoded defaults, no session storage
- **Enforcement**: All currency reads must query business record
- **Violation Impact**: Currency inconsistencies, wrong formatting, incorrect calculations

**CURR-2**: Currency code MUST be stored as ISO 4217 code (e.g., "GHS", "KES", "USD")
- **Normalization**: Uppercase, trimmed, validated against ISO 4217 list
- **Enforcement**: Database constraint or application validation
- **Violation Impact**: Currency symbol lookup fails, formatting errors

**CURR-3**: Currency symbol MUST be derived from currency code via `getCurrencySymbol()` only
- **No Hardcoding**: No direct symbol storage, no country-based symbol lookup
- **Enforcement**: All symbol access must go through currency utility
- **Violation Impact**: Symbol mismatches, wrong currency display

### 2.2 Missing Currency Behavior

**CURR-4**: If currency is null/undefined, currency-dependent operations MUST fail explicitly
- **Required Behavior**: 
  - API routes: Return 400 error with message "Currency must be set in Business Profile"
  - UI components: Display blocking message with link to Business Profile
  - Database operations: Reject or return null (no silent fallback)
- **Violation Impact**: Operations proceed with wrong currency, data corruption

**CURR-5**: Currency formatting functions MUST return placeholder ("—") when currency is null
- **Required Behavior**: `formatMoney(null, null)` → "—"
- **Enforcement**: All formatting functions must check currency before formatting
- **Violation Impact**: Empty strings or errors displayed to users

**CURR-6**: Currency-dependent calculations MUST be blocked when currency is missing
- **Required Behavior**: Invoice creation fails, sale creation fails, report generation fails
- **Enforcement**: Pre-operation validation in API routes
- **Violation Impact**: Calculations with undefined currency, incorrect totals

### 2.3 Currency-Country Mismatch Behavior

**CURR-7**: Currency MUST be validated against country's supported currencies
- **Required Behavior**: 
  - GH → GHS only
  - KE → KES only
  - NG → NGN only
  - etc.
- **Enforcement**: Business profile update validation, currency change validation
- **Violation Impact**: Invalid currency-country combinations, incorrect tax calculations

**CURR-8**: Currency mismatch MUST be detected and rejected at business profile update
- **Required Behavior**: Return 400 error: "Currency [X] is not valid for country [Y]"
- **Enforcement**: API route validation before database update
- **Violation Impact**: Invalid data stored, downstream errors

**CURR-9**: Currency mismatch MUST be detected and warned at invoice/sale creation
- **Required Behavior**: 
  - If business currency doesn't match country: Block operation OR show warning
  - If invoice currency doesn't match business currency: Block operation
- **Enforcement**: Pre-creation validation
- **Violation Impact**: Multi-currency confusion, incorrect reporting

### 2.4 Unsupported Currency Rule

**CURR-10**: Unsupported currency codes MUST be rejected, not defaulted
- **Required Behavior**: 
  - Unknown currency code → Validation error
  - No symbol mapping → Validation error
  - No silent fallback to GHS or USD
- **Enforcement**: Currency validation against known currency list
- **Violation Impact**: Wrong currency display, formatting errors

**CURR-11**: Currency operations MUST fail fast when currency is unsupported
- **Required Behavior**: 
  - Formatting: Return placeholder
  - Calculations: Return error
  - Exports: Skip currency formatting or error
- **Enforcement**: Currency utility functions
- **Violation Impact**: Broken UI, incorrect exports

---

## 3. Tax Engine Guardrails

### 3.1 Required Interface

**TAX-1**: All tax engines MUST implement the `TaxEngine` interface
- **Required Methods**:
  - `calculateFromLineItems(lineItems, config): TaxCalculationResult`
  - `calculateFromAmount(amount, config): TaxCalculationResult`
  - `reverseCalculate(totalInclusive, config): TaxCalculationResult`
- **Enforcement**: TypeScript interface compliance, runtime validation
- **Violation Impact**: Tax engine registration fails, tax calculation undefined

**TAX-2**: Tax engine config MUST include `jurisdiction`, `effectiveDate`, `taxInclusive`
- **Required Fields**: All three fields mandatory
- **Enforcement**: Type checking, runtime validation
- **Violation Impact**: Incorrect tax calculations, date-based rule failures

**TAX-3**: Tax engines MUST be registered in tax engine registry before use
- **Required Behavior**: Engine must exist in `TAX_ENGINES` registry
- **Enforcement**: Registry lookup before engine selection
- **Violation Impact**: Engine not found, fallback used incorrectly

### 3.2 Required Data Structures

**TAX-4**: Tax engines MUST return `TaxCalculationResult` with required fields
- **Required Structure**:
  ```typescript
  {
    taxLines: TaxLine[]  // Array of tax components
    subtotal_excl_tax: number
    tax_total: number
    total_incl_tax: number
  }
  ```
- **Enforcement**: Return type validation, runtime structure check
- **Violation Impact**: Tax data cannot be stored, reports fail

**TAX-5**: Tax lines MUST include `code`, `name`, `rate`, `base`, `amount`
- **Required Fields**: All five fields mandatory for each tax line
- **Enforcement**: Tax line validation before storage
- **Violation Impact**: Incomplete tax breakdown, report generation fails

**TAX-6**: Tax engine code MUST be stored with tax calculation result
- **Required Behavior**: `tax_engine_code` field in invoices/sales/bills
- **Enforcement**: Database constraint, application-level storage
- **Violation Impact**: Cannot determine which engine calculated taxes, cannot regenerate

### 3.3 Missing Tax Engine Behavior

**TAX-7**: If no tax engine exists for country, zero-tax fallback MUST be used
- **Required Behavior**: 
  - Return `TaxCalculationResult` with empty `taxLines`, `tax_total: 0`
  - Log warning: "No tax engine for country [X], using zero-tax fallback"
  - Do NOT throw error (allows system to function)
- **Enforcement**: Tax engine registry lookup with explicit fallback
- **Violation Impact**: Tax calculation fails, invoice creation blocked

**TAX-8**: Zero-tax fallback MUST be explicit, not silent
- **Required Behavior**: 
  - Warning logged to console
  - `tax_engine_code` set to "unsupported" or null
  - UI may show "Tax calculation not available for this country"
- **Enforcement**: Fallback engine implementation, logging
- **Violation Impact**: Users unaware taxes aren't calculated, compliance issues

**TAX-9**: Missing tax engine MUST NOT prevent invoice/sale creation
- **Required Behavior**: 
  - Invoice/sale created with zero taxes
  - User warned that tax calculation unavailable
  - Business can still operate
- **Enforcement**: Fallback engine returns valid result
- **Violation Impact**: System unusable in unsupported countries

### 3.4 Explicit Ban on Ghana-Specific Logic

**TAX-10**: Ghana-specific tax functions MUST NOT be called for non-GH countries
- **Forbidden Functions**:
  - `calculateGhanaTaxes()` - MUST NOT be called for non-GH
  - `calculateGhanaVAT()` - MUST NOT be called for non-GH
  - `deriveLegacyGhanaTaxAmounts()` - MUST NOT be called for non-GH
- **Enforcement**: Country check before function call, function-level guards
- **Violation Impact**: Wrong tax structure applied, incorrect calculations

**TAX-11**: Ghana tax columns (nhil, getfund, covid) MUST NOT be queried without country check
- **Required Behavior**: 
  - If country != GH: Do not query these columns OR query returns null
  - If country == GH: Query allowed
- **Enforcement**: Query builder country-aware column selection
- **Violation Impact**: Non-GH businesses see Ghana tax breakdown, data confusion

**TAX-12**: Ghana tax structure MUST NOT be assumed in generic tax functions
- **Required Behavior**: 
  - Tax derivation functions must check `tax_engine_code` before extracting
  - Generic tax functions must use tax engine, not hardcoded structure
- **Enforcement**: Code review, static analysis
- **Violation Impact**: Wrong tax extraction for non-GH countries

---

## 4. Analytics & Reports Guardrails

### 4.1 Tax Breakdown Rendering Rules

**ANALYTICS-1**: Tax breakdown labels MUST be country-specific
- **Required Behavior**:
  - GH: "NHIL", "GETFund", "COVID", "VAT"
  - KE: Country-specific labels (TBD)
  - Generic: Use tax line `name` field from tax engine
- **Enforcement**: Label selection based on country or tax_engine_code
- **Violation Impact**: Wrong labels displayed, user confusion

**ANALYTICS-2**: Tax breakdown structure MUST match country's tax system
- **Required Behavior**:
  - GH: 4-component breakdown (NHIL, GETFund, COVID, VAT)
  - Other countries: Use tax_lines from tax engine
  - Unsupported: Show generic "Tax" or "Tax calculation not available"
- **Enforcement**: Country-aware report template selection
- **Violation Impact**: Incorrect tax display, compliance issues

**ANALYTICS-3**: Tax breakdown MUST NOT render Ghana structure for non-GH countries
- **Required Behavior**:
  - If country != GH: Do not query/show nhil, getfund, covid columns
  - If country == GH: Show Ghana structure
  - If country unsupported: Show generic tax total only
- **Enforcement**: Country check before rendering, column filtering
- **Violation Impact**: Non-GH businesses see Ghana taxes, incorrect reporting

### 4.2 Payment Method Analytics Rules

**ANALYTICS-4**: Payment method analytics MUST filter by country eligibility
- **Required Behavior**:
  - Hubtel: Only aggregate for GH businesses
  - MTN MoMo: Only aggregate for GH businesses
  - Generic mobile_money: Aggregate for all countries with mobile_money enabled
- **Enforcement**: Country check before aggregation, payment eligibility check
- **Violation Impact**: Ghana providers shown for non-GH businesses, incorrect analytics

**ANALYTICS-5**: Payment method labels MUST be country-specific
- **Required Behavior**:
  - GH: "MoMo" for mobile_money
  - Other countries: "Mobile Money" for mobile_money
  - Provider names: Only show if provider is eligible for country
- **Enforcement**: Label selection based on country, eligibility check
- **Violation Impact**: Wrong labels, provider names shown incorrectly

**ANALYTICS-6**: Payment method totals MUST exclude ineligible methods
- **Required Behavior**:
  - If method not allowed for country: Total = 0, do not query
  - If provider not allowed for country: Total = 0, do not aggregate
- **Enforcement**: Pre-query filtering, eligibility check
- **Violation Impact**: Incorrect payment totals, provider leakage

### 4.3 Unsupported Report Structure Behavior

**ANALYTICS-7**: If report structure is unsupported for country, MUST show explicit message
- **Required Behavior**:
  - Display: "This report is not available for [Country]. Tax structure not yet supported."
  - Do NOT: Show empty report, show wrong structure, silently fail
- **Enforcement**: Country support check before report rendering
- **Violation Impact**: Users see incorrect reports, compliance issues

**ANALYTICS-8**: Unsupported reports MUST NOT render partial data
- **Required Behavior**:
  - If country unsupported: Show blocking message, no data rendered
  - If country supported: Render full report
  - No middle ground: Partial rendering forbidden
- **Enforcement**: Report template selection, country support matrix
- **Violation Impact**: Incomplete data shown, user confusion

**ANALYTICS-9**: Report generation MUST validate country support before execution
- **Required Behavior**:
  - Pre-check: Is country supported for this report type?
  - If no: Return error immediately, do not query data
  - If yes: Proceed with country-specific queries
- **Enforcement**: API route validation, report service checks
- **Violation Impact**: Wasted queries, incorrect data aggregation

### 4.4 Explicit "Do Not Render" Conditions

**ANALYTICS-10**: MUST NOT render tax breakdown if country is null/unsupported
- **Required Behavior**: Show placeholder: "Tax breakdown not available"
- **Enforcement**: Country check before tax breakdown rendering
- **Violation Impact**: Empty or incorrect tax display

**ANALYTICS-11**: MUST NOT render payment provider analytics if provider not eligible
- **Required Behavior**: Hide provider section or show "Not available for your country"
- **Enforcement**: Provider eligibility check before rendering
- **Violation Impact**: Ghana providers shown for non-GH businesses

**ANALYTICS-12**: MUST NOT render country-specific report sections for wrong country
- **Required Behavior**: 
  - GH-specific sections: Only render if country == GH
  - Generic sections: Render for all countries
  - Unsupported sections: Do not render
- **Enforcement**: Country-aware section rendering logic
- **Violation Impact**: Wrong report structure displayed

---

## 5. Register & Payment Guardrails

### 5.1 Country-Agnostic Register Data

**REGISTER-1**: Register core data MUST be country-agnostic
- **Country-Agnostic Fields**:
  - Register ID, name, store_id
  - Opening/closing cash amounts
  - Session timestamps
  - Cashier assignments
- **Enforcement**: No country checks for core register operations
- **Violation Impact**: Over-engineering, unnecessary complexity

**REGISTER-2**: Register calculations MUST be currency-agnostic
- **Country-Agnostic Operations**:
  - Cash reconciliation (opening + sales - drops - change)
  - Variance calculations (expected vs actual)
  - Session totals (sum of amounts)
- **Enforcement**: Calculations use numeric values only, no currency assumptions
- **Violation Impact**: Calculations fail for non-GHS currencies

**REGISTER-3**: Register status tracking MUST be country-agnostic
- **Country-Agnostic States**:
  - Open/closed status
  - Session active/inactive
  - Cashier assignments
- **Enforcement**: No country logic in status management
- **Violation Impact**: Register operations blocked incorrectly

### 5.2 Country-Filtered Payment Data

**REGISTER-4**: Payment method aggregation MUST filter by country eligibility
- **Required Behavior**:
  - Query payment_method column
  - Filter results by `getAllowedMethods(countryCode)`
  - Aggregate only eligible methods
- **Enforcement**: Payment eligibility check before aggregation
- **Violation Impact**: Ineligible methods included in totals, provider leakage

**REGISTER-5**: Payment provider totals MUST be country-filtered
- **Required Behavior**:
  - Hubtel: Only aggregate if country == GH
  - MTN MoMo: Only aggregate if country == GH
  - Generic providers: Aggregate if eligible for country
- **Enforcement**: Provider eligibility check before aggregation
- **Violation Impact**: Ghana providers shown for non-GH businesses

**REGISTER-6**: Payment method labels in reports MUST be country-specific
- **Required Behavior**:
  - GH: "MoMo" for mobile_money
  - Other: "Mobile Money" for mobile_money
  - Provider names: Only show if eligible
- **Enforcement**: Label selection based on country
- **Violation Impact**: Wrong labels, provider names shown incorrectly

### 5.3 Provider Leakage Prevention

**REGISTER-7**: Hubtel MUST NOT appear in analytics/reports for non-GH businesses
- **Required Behavior**:
  - If country != GH: Hubtel total = 0, do not query, do not display
  - If country == GH: Hubtel aggregated and displayed normally
- **Enforcement**: Country check before Hubtel queries/display
- **Violation Impact**: Ghana provider visible for non-GH businesses

**REGISTER-8**: MTN MoMo provider MUST NOT appear for non-GH businesses
- **Required Behavior**:
  - If country != GH: MTN MoMo total = 0, do not query, do not display
  - If country == GH: MTN MoMo aggregated and displayed normally
- **Enforcement**: Country check before MTN MoMo queries/display
- **Violation Impact**: Ghana provider visible for non-GH businesses

**REGISTER-9**: Payment provider buttons MUST NOT render if provider not eligible
- **Required Behavior**:
  - UI: Hide provider button if not in `getAllowedProviders(countryCode)`
  - API: Return 403 if provider not eligible
  - Reports: Do not show provider section if not eligible
- **Enforcement**: Provider eligibility check at UI, API, and report layers
- **Violation Impact**: Users can attempt to use ineligible providers

**REGISTER-10**: Payment method selection MUST filter by country eligibility
- **Required Behavior**:
  - UI: Only show methods from `getAllowedMethods(countryCode)`
  - API: Validate method eligibility before processing
  - Reports: Only aggregate eligible methods
- **Enforcement**: Payment eligibility check at all layers
- **Violation Impact**: Ineligible methods available, provider leakage

---

## 6. Enforcement Points

### 6.1 Database Layer Guards

**ENF-DB-1**: Database functions MUST NOT have currency defaults
- **Required Behavior**: Functions return null if currency missing, no COALESCE to GHS
- **Enforcement**: Database function review, migration validation
- **Violation Impact**: Silent GHS fallback, data corruption

**ENF-DB-2**: Database constraints MUST validate country-currency combinations
- **Required Behavior**: Check constraint or trigger validating currency against country
- **Enforcement**: Database schema validation
- **Violation Impact**: Invalid currency-country combinations stored

**ENF-DB-3**: Database queries MUST filter by country when querying country-specific columns
- **Required Behavior**: 
  - Ghana tax columns: Only query if country == GH
  - Country-specific providers: Only query if country matches
- **Enforcement**: Query builder country-aware column selection
- **Violation Impact**: Wrong data queried, incorrect aggregations

### 6.2 API Layer Guards

**ENF-API-1**: API routes MUST validate country before country-dependent operations
- **Required Behavior**: 
  - Load business country
  - Validate country is set
  - Check country support for operation
  - Return 400 if country missing/unsupported
- **Enforcement**: Pre-operation validation in all country-dependent routes
- **Violation Impact**: Operations proceed with wrong country logic

**ENF-API-2**: API routes MUST NOT have hardcoded currency fallbacks
- **Required Behavior**: 
  - Load currency from business
  - Return 400 if currency missing
  - No `|| "GHS"` or `|| "₵"` fallbacks
- **Enforcement**: Code review, static analysis
- **Violation Impact**: Wrong currency used, Ghana currency shown for non-GH

**ENF-API-3**: API routes MUST validate payment method/provider eligibility
- **Required Behavior**: 
  - Check `assertMethodAllowed(countryCode, method)` before processing
  - Check `assertProviderAllowed(countryCode, provider)` before provider calls
  - Return 403 if not allowed
- **Enforcement**: Payment eligibility checks in payment routes
- **Violation Impact**: Ineligible methods/providers accessible

**ENF-API-4**: API routes MUST use tax engine, not direct Ghana functions
- **Required Behavior**: 
  - Call `calculateTaxes()` with country parameter
  - Do NOT call `calculateGhanaTaxes()` directly
  - Do NOT assume Ghana tax structure
- **Enforcement**: Code review, function call analysis
- **Violation Impact**: Wrong tax structure applied, Ghana logic for non-GH

### 6.3 UI Layer Guards

**ENF-UI-1**: UI components MUST check country before rendering country-specific content
- **Required Behavior**: 
  - Load business country
  - Check country support for feature
  - Show blocking message if country missing/unsupported
  - Hide country-specific sections if country doesn't match
- **Enforcement**: Component-level country checks
- **Violation Impact**: Wrong UI shown, Ghana features visible for non-GH

**ENF-UI-2**: UI components MUST filter payment methods by country eligibility
- **Required Behavior**: 
  - Get allowed methods from `getAllowedMethods(countryCode)`
  - Only render eligible methods
  - Show banner if no methods allowed
- **Enforcement**: Payment eligibility check in payment UI components
- **Violation Impact**: Ineligible methods shown, provider buttons visible incorrectly

**ENF-UI-3**: UI components MUST use country-specific labels
- **Required Behavior**: 
  - GH: "MoMo" for mobile_money
  - Other: "Mobile Money" for mobile_money
  - Use `getMobileMoneyLabel(countryCode)`
- **Enforcement**: Label selection based on country
- **Violation Impact**: Wrong labels displayed

**ENF-UI-4**: UI components MUST show blocking message if country missing
- **Required Behavior**: 
  - If country null: Show "Please set country in Business Profile" with link
  - Block country-dependent operations
  - Do NOT proceed with default/fallback
- **Enforcement**: Country check before rendering country-dependent features
- **Violation Impact**: Operations proceed with wrong country, user confusion

### 6.4 Fail-Fast vs Warning Rules

**ENF-FAIL-1**: Database operations MUST fail fast (reject) when country/currency missing
- **Required Behavior**: 
  - Database constraints reject invalid data
  - Functions return error if required fields missing
  - No silent defaults
- **Enforcement**: Database schema, function implementation
- **Violation Impact**: Invalid data stored, data corruption

**ENF-FAIL-2**: API routes MUST fail fast (return 400/403) when country-dependent validation fails
- **Required Behavior**: 
  - Country missing: 400 "Country must be set"
  - Currency missing: 400 "Currency must be set"
  - Method/provider not allowed: 403 "Not available for your country"
  - No silent fallbacks or warnings
- **Enforcement**: API route validation
- **Violation Impact**: Operations proceed incorrectly, security issues

**ENF-FAIL-3**: Tax calculation MUST fail fast (throw error) when country missing
- **Required Behavior**: 
  - `normalizeJurisdiction()` throws if country null
  - Tax engine selection fails if country invalid
  - No silent zero-tax fallback when country missing (only when country unsupported)
- **Enforcement**: Tax engine entry point validation
- **Violation Impact**: Wrong tax calculations, data corruption

**ENF-WARN-1**: UI components MAY show warnings (not block) when country unsupported
- **Required Behavior**: 
  - If country unsupported: Show "Tax calculation not available for [Country]"
  - Allow invoice/sale creation with zero taxes
  - Do NOT block business operations
- **Enforcement**: UI component logic
- **Violation Impact**: Users blocked from using system

**ENF-WARN-2**: Reports MAY show warnings when report structure unsupported
- **Required Behavior**: 
  - If report unsupported: Show "This report is not available for [Country]"
  - Do NOT render partial/wrong data
  - Allow user to understand limitation
- **Enforcement**: Report rendering logic
- **Violation Impact**: Users see incorrect reports

**ENF-WARN-3**: Tax engine fallback MAY log warning when country unsupported
- **Required Behavior**: 
  - Log: "No tax engine for country [X], using zero-tax fallback"
  - Continue with zero taxes
  - Do NOT throw error
- **Enforcement**: Tax engine registry fallback
- **Violation Impact**: System unusable in unsupported countries

---

## 7. Violation Matrix

### 7.1 Critical Violations (Data Corruption Risk)

| Violation | Impact | Detection | Severity |
|-----------|--------|----------|----------|
| Currency default to GHS | Wrong currency stored, incorrect calculations | Database function review | CRITICAL |
| Ghana tax structure for non-GH | Wrong tax calculations, compliance issues | Tax engine selection check | CRITICAL |
| Country default to Ghana | Wrong tax/payment logic applied | Country normalization check | CRITICAL |
| Missing country validation | Operations proceed with undefined country | API route validation check | CRITICAL |

### 7.2 High Violations (User Experience Risk)

| Violation | Impact | Detection | Severity |
|-----------|--------|----------|----------|
| Hardcoded currency symbols | Wrong currency displayed | Code search for "₵", "GHS" | HIGH |
| Ghana tax labels for non-GH | User confusion, wrong reporting | Report rendering check | HIGH |
| Provider leakage (Hubtel/MTN) | Ineligible providers visible | Payment eligibility check | HIGH |
| Missing payment method filtering | Ineligible methods available | UI component check | HIGH |

### 7.3 Medium Violations (Functionality Risk)

| Violation | Impact | Detection | Severity |
|-----------|--------|----------|----------|
| Unsupported country silent fallback | Users unaware of limitations | Fallback engine check | MEDIUM |
| Missing report structure validation | Incorrect reports shown | Report rendering check | MEDIUM |
| Currency-country mismatch allowed | Invalid combinations stored | Validation check | MEDIUM |
| Tax derivation assumes Ghana | Wrong tax extraction | Tax derivation function check | MEDIUM |

---

## 8. Pre-Plugin Enablement Checklist

### 8.1 Country Infrastructure

- [ ] Country normalization function exists and validates ISO codes
- [ ] Country validation occurs before all country-dependent operations
- [ ] No silent country defaults to "Ghana" anywhere in codebase
- [ ] Country change triggers revalidation of dependent data
- [ ] Country support matrix documented (which countries supported for which features)

### 8.2 Currency Infrastructure

- [ ] All currency reads come from `businesses.default_currency` only
- [ ] No hardcoded currency defaults (GHS, ₵) in API routes
- [ ] Currency validation rejects invalid codes
- [ ] Currency-country mapping validation exists
- [ ] Currency formatting functions handle null currency correctly (return "—")
- [ ] Database functions have no currency defaults

### 8.3 Tax Engine Infrastructure

- [ ] Tax engine interface defined and enforced
- [ ] Tax engine registry exists with explicit fallback
- [ ] All tax calculations go through tax engine (no direct Ghana calls)
- [ ] Tax engine code stored with tax calculations
- [ ] Tax derivation functions are country-aware
- [ ] VAT reports use country-aware structure
- [ ] VAT returns API uses country-aware calculations

### 8.4 Payment Infrastructure

- [ ] Payment eligibility system exists and is used
- [ ] Payment method filtering occurs at UI, API, and report layers
- [ ] Payment provider eligibility checked before provider calls
- [ ] Payment method labels are country-specific
- [ ] No Ghana provider buttons visible for non-GH businesses
- [ ] Payment analytics filter by country eligibility

### 8.5 Analytics & Reports Infrastructure

- [ ] Report templates are country-aware
- [ ] Tax breakdown labels are country-specific
- [ ] Payment method analytics filter by country
- [ ] Unsupported reports show explicit "not available" message
- [ ] No Ghana tax structure rendered for non-GH countries
- [ ] Report generation validates country support before execution

### 8.6 Enforcement Infrastructure

- [ ] Database layer has no currency/country defaults
- [ ] API routes validate country before country-dependent operations
- [ ] API routes validate currency before currency-dependent operations
- [ ] API routes validate payment eligibility before payment operations
- [ ] UI components check country before rendering country-specific content
- [ ] UI components filter payment methods by eligibility
- [ ] Fail-fast rules enforced for critical validations
- [ ] Warning rules enforced for unsupported country scenarios

### 8.7 Testing Infrastructure

- [ ] Tests exist for country normalization
- [ ] Tests exist for currency validation
- [ ] Tests exist for tax engine selection
- [ ] Tests exist for payment eligibility
- [ ] Tests exist for report country filtering
- [ ] Tests verify no Ghana fallbacks for non-GH countries
- [ ] Tests verify provider leakage prevention
- [ ] Tests verify currency-country mismatch rejection

---

## 9. Architecture Principles Summary

### 9.1 Core Principles

1. **Explicit Over Implicit**: All country-dependent logic must explicitly check country
2. **Fail Fast Over Silent**: Critical validations must fail immediately, not silently default
3. **Single Source of Truth**: Currency from business record only, country from business record only
4. **No Silent Fallbacks**: Missing data must error, not default to Ghana values
5. **Country Isolation**: Country-specific logic must not leak to other countries

### 9.2 Design Rules

1. **Country-First Design**: All country-dependent features must be designed with country as primary dimension
2. **Plugin Architecture**: Tax engines, report templates, payment providers must be pluggable by country
3. **Validation at Boundaries**: Country/currency validation at API boundaries, not deep in business logic
4. **Explicit Unsupported States**: Unsupported countries must have explicit "not available" states, not silent failures
5. **Layered Enforcement**: Guards at database, API, and UI layers for defense in depth

### 9.3 Forbidden Patterns

1. ❌ `country || "Ghana"` - Silent country default
2. ❌ `currency || "GHS"` - Silent currency default
3. ❌ `currency_symbol || "₵"` - Silent symbol default
4. ❌ Direct calls to `calculateGhanaTaxes()` without country check
5. ❌ Querying `nhil, getfund, covid` columns without country check
6. ❌ Rendering Ghana tax labels for non-GH countries
7. ❌ Aggregating Hubtel/MTN MoMo for non-GH businesses
8. ❌ Assuming Ghana structure in generic functions

---

**Document Status**: Architecture specification only. No implementation changes.



