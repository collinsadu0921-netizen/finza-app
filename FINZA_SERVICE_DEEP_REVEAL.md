# Finza Service Architecture: Deep Reveal Report
## Technical Audit Summary - "Unwritten Rules" of Finza

**Date**: 2025-01-XX  
**Purpose**: Comprehensive technical audit revealing hidden business logic, hardcoded restrictions, validation guardrails, integration dependencies, state modifications, and technical debt.

---

## 1. CORE BUSINESS LOGIC: Transaction Flow Analysis

### 1.1 Service Invoice Transaction Flow (Primary Service Transaction)

**Complete Flow**: Invoice Creation → Payment → Ledger Posting → Status Updates

#### Step 1: Invoice Creation (`app/api/invoices/create/route.ts`)

**Hidden Transformations:**

1. **Invoice Number Generation** (Lines 66-88)
   - **System-Controlled**: Invoice numbers are ONLY generated when `status === "sent"`
   - **Draft Invoices**: Have `invoice_number = null` until sent
   - **Generation Method**: Uses `generate_invoice_number_with_settings()` RPC function
   - **Rejection**: Manually provided `invoice_number` is ignored with warning

2. **Tax Calculation - Reverse Engineering** (Lines 203-241)
   - **Tax-Inclusive Mode**: All prices are treated as tax-inclusive (default)
   - **Hidden Calculation**: System reverse-calculates base amount from tax-inclusive total
   - **Formula**: `baseSubtotal = reverseCalculate(totalInclusive)` → then applies taxes forward
   - **Effective Date Logic**: 
     - Drafts: Uses `issue_date` for tax calculation
     - Sent invoices: Uses `sent_at` date (current date when sent)
   - **Versioned Tax Rates**: Ghana taxes change on 2026-01-01 (COVID removed)

3. **Currency Validation Chain** (Lines 90-150)
   - **No Silent Fallbacks**: System BLOCKS invoice creation if:
     - `business.address_country` is missing → 400 error
     - `business.default_currency` is missing → 400 error
     - Currency doesn't match country → 400 error (via `assertCountryCurrency()`)
   - **Currency Resolution**: `currency_code` → `business.default_currency` → error if none

4. **Rounding Precision** (Lines 322-336)
   - **All Money Values**: Rounded to 2 decimals using `Math.round(value * 100) / 100`
   - **Applied To**: `subtotal`, `total_tax`, `total`, `nhil`, `getfund`, `covid`, `vat`
   - **Critical**: This rounding happens BEFORE database storage

5. **Legacy Tax Column Population** (Lines 256-350)
   - **Dual Storage**: Both `tax_lines` (JSONB) and legacy columns (`nhil`, `getfund`, `covid`, `vat`)
   - **Ghana-Only Logic**: Legacy columns only populated if `countryCode === "GH"`
   - **Non-Ghana Businesses**: Legacy columns set to 0 (except `vat` which may exist for other countries)

#### Step 2: Payment Processing (`app/api/payments/create/route.ts`)

**Hidden Validations & Corrections:**

1. **Invoice Total Auto-Correction** (Lines 141-167)
   - **CRITICAL FIX**: System automatically corrects invoice totals if mismatch detected
   - **Trigger**: `diff > 0.01` between stored total and calculated total
   - **Formula Check**: `expectedTotal = subtotal + nhil + getfund + covid + vat`
   - **Action**: Updates `invoice.total` in database BEFORE payment processing
   - **Reason**: Ensures journal entries balance correctly

2. **Payment Amount Validation** (Lines 169-190)
   - **Balance Check**: Payment cannot exceed `remainingBalance = invoiceTotal - totalPaid`
   - **Calculation**: Includes all payments + credit notes
   - **Tolerance**: Uses `Math.abs()` for comparison (no explicit tolerance mentioned)

3. **E-Levy Calculation** (Lines 192-197)
   - **Hidden Fee**: 1.5% E-Levy calculated for mobile money payments
   - **Informational Only**: Stored in `e_levy_amount` but not deducted from payment
   - **Formula**: `eLevyAmount = amount * 0.015`
   - **Only Applied**: When `method === "momo"`

4. **Invoice Status Update** (Lines 232-251)
   - **Dual Update**: Both database trigger AND manual update
   - **Trigger**: `trigger_update_invoice_status` automatically fires
   - **Manual Override**: Code also updates status explicitly
   - **Status Logic**:
     - `paid`: `totalPaid >= invoiceTotal`
     - `partially_paid`: `totalPaid > 0 && totalPaid < invoiceTotal`
     - `sent`: `totalPaid === 0`

#### Step 3: Automatic Ledger Posting (Database Triggers)

**Hidden Side Effects:**

1. **Auto-Posting Trigger** (`supabase/migrations/043_accounting_core.sql`)
   - **Trigger**: `trigger_auto_post_invoice` fires AFTER invoice INSERT
   - **Function**: `post_invoice_to_ledger(p_invoice_id)`
   - **Creates**: Journal entries in `general_ledger` automatically
   - **Accounts Used**:
     - AR (Accounts Receivable): `1100` - Debit
     - Revenue: `4000` - Credit
     - Tax Control Accounts: Based on `tax_lines` JSONB

2. **Payment Posting** (`trigger_auto_post_payment`)
   - **Trigger**: Fires AFTER payment INSERT
   - **Function**: `post_payment_to_ledger(p_payment_id)`
   - **Creates**: Journal entries for payment settlement
   - **Accounts**: AR (credit), Cash/Bank/MoMo (debit)

### 1.2 Non-Obvious Transformation Steps

1. **Tax-Inclusive Reverse Calculation**
   - User enters: `100.00` (tax-inclusive)
   - System calculates: Base = ~85.47, Taxes = ~14.53, Total = 100.00
   - **Hidden**: The base amount is derived, not stored directly

2. **Multi-Currency Handling**
   - **No FX Conversion**: Foreign currency fields removed from sales (line 57 in `sales/create/route.ts`)
   - **Comment**: "Foreign currency fields removed - FX not fully supported end-to-end"
   - **Impact**: Multi-currency support is incomplete

3. **Order → Invoice Conversion** (`app/api/orders/[id]/convert-to-invoice/route.ts`)
   - **Tax Recalculation**: Order taxes are reverse-calculated then recalculated for invoice
   - **Validation Fallback**: If reverse calculation fails, falls back to item subtotals
   - **Token Generation**: Public token generated with retry logic (max 5 attempts)

---

## 2. HARDCODED RESTRICTIONS & "MAGIC NUMBERS"

### 2.1 Payment & Transaction Limits

| Location | Value | Purpose | Impact |
|----------|-------|---------|--------|
| `app/api/payments/create/route.ts:149` | `0.01` | Invoice total mismatch tolerance | Payments blocked if difference > 0.01 |
| `app/api/sales/create/route.ts:83` | `0.01` | Payment total vs sale amount tolerance | Sale rejected if difference > 0.01 |
| `app/api/payments/create/route.ts:196` | `0.015` | E-Levy rate (1.5%) | Hardcoded for mobile money |
| `app/api/orders/[id]/convert-to-invoice/route.ts:297` | `5` | Max token generation attempts | Prevents infinite loops |

### 2.2 Tax Rates (Ghana - Hardcoded)

| Component | Pre-2026 Rate | Post-2026 Rate | Location |
|-----------|---------------|----------------|----------|
| NHIL | 2.5% | 2.5% | `lib/taxEngine/jurisdictions/ghana.ts` |
| GETFund | 2.5% | 2.5% | `lib/taxEngine/jurisdictions/ghana.ts` |
| COVID | 1% | 0% (removed) | `lib/taxEngine/jurisdictions/ghana.ts` |
| VAT | 15% | 15% | `lib/taxEngine/jurisdictions/ghana.ts` |
| **Cutoff Date** | **2026-01-01** | **Version B** | `lib/taxEngine/jurisdictions/ghana-shared.ts` |

### 2.3 Rounding & Precision

| Location | Method | Precision |
|----------|--------|-----------|
| All money calculations | `Math.round(value * 100) / 100` | 2 decimals |
| Payroll calculations | `roundPayroll(value)` | 2 decimals |
| Tax calculations | `roundGhanaTax(value)` | 2 decimals |

### 2.4 Business Logic Thresholds

| Location | Threshold | Purpose |
|----------|-----------|---------|
| `app/api/invoices/create/route.ts:244` | `isNaN()` or `< 0` | Invalid calculation rejection |
| `app/api/payments/create/route.ts:181` | `amountNum > remainingBalance` | Payment overpayment prevention |
| `app/(dashboard)/pos/page.tsx:630` | `stock > 0` | Product visibility filter |
| `app/api/sales/create/route.ts:636` | `track_stock !== false` | Stock deduction condition |

### 2.5 Currency Defaults

| Location | Default | Override |
|----------|---------|----------|
| `supabase/migrations/051_fix_all_table_structures.sql:178` | `'GHS'` | Can be changed in business profile |
| `supabase/migrations/037_business_profile_invoice_settings.sql:20` | `'GHS'` | Migration default |

### 2.6 Register & Session Limits

| Location | Restriction | Impact |
|----------|-------------|--------|
| `app/api/sales/create/route.ts:69` | `register_id` required | All sales must have register |
| `app/onboarding/retail/register.tsx:260` | Auto-creates "Main Register" | If no registers exist |
| `supabase/migrations/127_register_default_enforcement.sql` | Single default per store | Enforced via trigger |

---

## 3. VALIDATION & GUARDRAILS

### 3.1 Fail-Fast Conditions

#### Invoice Creation Failures

1. **Missing Business Country** (`app/api/invoices/create/route.ts:99`)
   - **Error**: 400 - "Business country is required"
   - **Action**: Blocks invoice creation
   - **Fix**: Set country in Business Profile

2. **Missing Currency** (`app/api/invoices/create/route.ts:113`)
   - **Error**: 400 - "Business currency is required"
   - **Action**: Blocks invoice creation
   - **Fix**: Set currency in Business Profile

3. **Currency-Country Mismatch** (`app/api/invoices/create/route.ts:127`)
   - **Error**: 400 - "Currency does not match business country"
   - **Action**: Blocks invoice creation
   - **Validation**: `assertCountryCurrency(countryCode, currencyCode)`

4. **Invalid Line Items** (`app/api/invoices/create/route.ts:178`)
   - **Error**: 400 - "Invalid line items"
   - **Checks**: `quantity < 0`, `unit_price < 0`, `discount_amount < 0`, `isNaN()`
   - **Action**: Rejects entire invoice

5. **Invalid Tax Calculation** (`app/api/invoices/create/route.ts:244`)
   - **Error**: 400 - "Invalid tax calculation"
   - **Checks**: `isNaN(baseSubtotal)`, `baseSubtotal < 0`, `isNaN(invoiceTotal)`, `invoiceTotal < 0`
   - **Action**: Rejects invoice

#### Payment Failures

1. **Payment Method Validation** (`app/api/payments/create/route.ts:31`)
   - **Valid Methods**: `["cash", "bank", "momo", "card", "cheque", "other"]`
   - **Error**: 400 - "Invalid payment method"
   - **Country Restrictions**: Payment method eligibility checked by country

2. **Payment Amount Exceeds Balance** (`app/api/payments/create/route.ts:181`)
   - **Error**: 400 - "Payment amount exceeds remaining balance"
   - **Calculation**: `remainingBalance = invoiceTotal - totalPaid`
   - **Action**: Payment rejected

3. **Invoice Not Found** (`app/api/payments/create/route.ts:130`)
   - **Error**: 404 - "Invoice not found"
   - **Check**: Invoice exists and belongs to business

#### Sale Creation Failures

1. **Missing Register** (`app/api/sales/create/route.ts:69`)
   - **Error**: 400 - "Register is required. Please open a register session first."
   - **Action**: Sale rejected

2. **Payment Total Mismatch** (`app/api/sales/create/route.ts:83`)
   - **Error**: 400 - "Payment total does not match sale amount"
   - **Tolerance**: `Math.abs(difference) > 0.01`
   - **Action**: Sale rejected

3. **Stock Update Failure** (`app/api/sales/create/route.ts:617, 795`)
   - **Error**: Silent failure (logged but doesn't fail sale)
   - **Impact**: Sale completes but stock not reduced
   - **Known Issue**: Documented in `STOCK_UPDATE_FAILURE_AUDIT.md`

### 3.2 Business Logic Guardrails

1. **Invoice Number System Control**
   - **Rule**: Invoice numbers are system-generated only
   - **Enforcement**: Manual `invoice_number` ignored with warning
   - **Generation**: Only when `status === "sent"`

2. **Tax Calculation Authority**
   - **Rule**: Tax engine is authoritative source
   - **Enforcement**: Country validation before tax calculation
   - **Fallback**: Unsupported countries get zero-tax (not error)

3. **Stock Deduction Conditions**
   - **Rule**: Stock only deducted if `track_stock !== false`
   - **Exception**: Variants always deduct stock (no `track_stock` check)
   - **Location**: `app/api/sales/create/route.ts:636`

4. **Accounting Period Guards**
   - **Rule**: Ledger entries only allowed in open periods
   - **Enforcement**: `validate_period_open_for_entry()` function
   - **Trigger**: `trigger_enforce_period_state_on_entry`
   - **Location**: `supabase/migrations/088_hard_db_constraints_ledger.sql`

5. **Double-Entry Balance Enforcement**
   - **Rule**: Journal entries must balance (debits = credits)
   - **Enforcement**: `enforce_double_entry_balance()` function
   - **Trigger**: `trigger_enforce_double_entry_balance`
   - **Location**: `supabase/migrations/088_hard_db_constraints_ledger.sql`

---

## 4. INTEGRATION DEPENDENCIES

### 4.1 External Services

#### WhatsApp Integration (Meta Cloud API)
- **Status**: Implemented but incomplete
- **Location**: `app/api/whatsapp/`
- **Dependencies**:
  - Meta Business Account
  - WhatsApp Business Phone Number
  - OAuth 2.0 flow
- **Security Issue**: Access tokens stored as plain text (TODO: Encrypt)
- **Location**: `app/api/whatsapp/callback/route.ts:158`

#### Mobile Money Payment Providers
- **Status**: Placeholder implementations
- **Providers**: MTN, Vodafone, AirtelTigo
- **Location**: `app/api/payments/momo/initiate/route.ts`
- **TODOs**:
  - Line 218: "TODO: Implement actual MTN MoMo API integration"
  - Line 255: "TODO: Implement Vodafone Cash API integration"
  - Line 262: "TODO: Implement AirtelTigo Money API integration"

#### Email Service
- **Status**: Not implemented
- **Location**: `app/api/reminders/process-automated/route.ts:307`
- **TODO**: "TODO: Integrate with actual email service when available"
- **Location**: `app/api/invoices/[id]/send/route.ts:216`
- **TODO**: "TODO: Implement email sending with PDF attachment"

### 4.2 Internal Module Dependencies

#### Tax Engine Dependencies
- **Primary**: `lib/taxEngine/index.ts` (authoritative)
- **Legacy**: `lib/ghanaTaxEngine.ts` (backward compatibility)
- **Shared Logic**: `lib/taxEngine/jurisdictions/ghana-shared.ts`
- **Dependency Chain**:
  1. Country normalization → `lib/payments/eligibility.normalizeCountry()`
  2. Tax engine selection → `TAX_ENGINES` registry
  3. Tax calculation → Jurisdiction-specific engine
  4. Legacy format → `getLegacyTaxAmounts()` helper

#### Accounting System Dependencies
- **Ledger Posting**: Database functions (`post_*_to_ledger()`)
- **Account Resolution**: `get_account_by_code()` → `get_account_by_control_key()`
- **Period Validation**: `validate_period_open_for_entry()`
- **Balance Enforcement**: `enforce_double_entry_balance()`

#### Currency System Dependencies
- **Currency Resolution**: `business.default_currency` → `getCurrencySymbol()`
- **Country Validation**: `assertCountryCurrency()` → `lib/countryCurrency.ts`
- **Payment Eligibility**: `assertMethodAllowed()` → `lib/payments/eligibility.ts`

### 4.3 Points of Failure

1. **Tax Engine Missing Country**
   - **Failure Point**: `lib/taxEngine/index.ts:71`
   - **Error**: `MissingCountryError` thrown
   - **Impact**: Invoice creation blocked

2. **Tax Engine Unsupported Country**
   - **Failure Point**: `lib/taxEngine/index.ts:155`
   - **Error**: `UnsupportedCountryError` thrown (if in supported set)
   - **Fallback**: Zero-tax engine (if not in supported set)

3. **Database Function Missing**
   - **Failure Point**: `app/api/invoices/create/route.ts:78`
   - **Function**: `generate_invoice_number_with_settings()`
   - **Fallback**: Returns error if RPC fails

4. **Service Role Key Missing**
   - **Failure Point**: `app/api/sales/create/route.ts:27`
   - **Error**: 500 - "Service role key required for stock movements"
   - **Impact**: Stock movements cannot be created

5. **Account Resolution Failure**
   - **Failure Point**: `post_invoice_to_ledger()` → `get_account_by_code()`
   - **Error**: Exception if account code not found
   - **Impact**: Ledger posting fails

---

## 5. STATE & SIDE EFFECTS

### 5.1 Automatic Database Modifications

#### Invoice Status Updates (Triggers)

1. **Payment Trigger** (`supabase/migrations/035_enhance_invoice_system_ghana.sql:203`)
   - **Trigger**: `trigger_update_invoice_status`
   - **Fires**: AFTER INSERT OR UPDATE on `payments`
   - **Function**: `update_invoice_status_with_credits()`
   - **Modifies**: `invoices.status`, `invoices.paid_at`
   - **Logic**: Calculates balance from payments + credit notes

2. **Credit Note Trigger** (`supabase/migrations/040_credit_notes.sql:234`)
   - **Trigger**: `trigger_update_invoice_on_credit_note`
   - **Fires**: AFTER UPDATE OF `status` on `credit_notes`
   - **Function**: `update_invoice_status_on_credit_note()`
   - **Modifies**: `invoices.status`, `invoices.paid_at`
   - **Condition**: Only when `status = 'applied'`

3. **Overdue Check** (`supabase/migrations/035_enhance_invoice_system_ghana.sql:212`)
   - **Function**: `check_overdue_invoices()`
   - **Modifies**: `invoices.status = 'overdue'`
   - **Condition**: `due_date < CURRENT_DATE` AND `status != 'paid'`

#### Automatic Ledger Posting (Triggers)

1. **Invoice Posting** (`supabase/migrations/043_accounting_core.sql:949`)
   - **Trigger**: `trigger_auto_post_invoice`
   - **Fires**: AFTER INSERT on `invoices` WHERE `status = 'sent'`
   - **Function**: `post_invoice_to_ledger()`
   - **Creates**: Journal entries in `general_ledger`
   - **Side Effect**: Creates `journal_entries` record

2. **Payment Posting** (`supabase/migrations/043_accounting_core.sql:973`)
   - **Trigger**: `trigger_auto_post_payment`
   - **Fires**: AFTER INSERT on `payments`
   - **Function**: `post_payment_to_ledger()`
   - **Creates**: Journal entries for payment settlement

3. **Credit Note Posting** (`supabase/migrations/043_accounting_core.sql:1005`)
   - **Trigger**: `trigger_auto_post_credit_note`
   - **Fires**: AFTER INSERT on `credit_notes`
   - **Function**: `post_credit_note_to_ledger()`
   - **Creates**: Reversing journal entries

#### Audit Logging (Triggers)

1. **Invoice Audit** (`supabase/migrations/044_audit_logging.sql:185`)
   - **Trigger**: `trigger_audit_invoice`
   - **Fires**: AFTER INSERT OR UPDATE OR DELETE on `invoices`
   - **Function**: `audit_invoice_changes()`
   - **Creates**: `audit_logs` record
   - **Captures**: Old/new values, action type, user ID

2. **Account Audit** (`supabase/migrations/044_audit_logging.sql:634`)
   - **Trigger**: `trigger_audit_account`
   - **Fires**: AFTER INSERT OR UPDATE OR DELETE on `accounts`
   - **Function**: `audit_account_changes()`
   - **Creates**: `audit_logs` record

### 5.2 Implicit State Changes

1. **Invoice Total Auto-Correction**
   - **Location**: `app/api/payments/create/route.ts:141-167`
   - **Trigger**: Payment creation
   - **Action**: Updates `invoices.total` if mismatch detected
   - **Reason**: Ensures journal entries balance

2. **Stock Movement Creation**
   - **Location**: `app/api/sales/create/route.ts:597, 787`
   - **Trigger**: Sale creation
   - **Action**: Creates `stock_movements` record
   - **Side Effect**: Audit trail of stock changes

3. **Product Stock Update**
   - **Location**: `app/api/sales/create/route.ts:535, 723`
   - **Trigger**: Sale creation
   - **Action**: Updates `products_stock.stock` (decrements)
   - **Side Effect**: Real-time inventory tracking

4. **Public Token Generation**
   - **Location**: Multiple (invoices, payments, receipts)
   - **Trigger**: Entity creation
   - **Action**: Generates unique `public_token`
   - **Side Effect**: Enables public access URLs

### 5.3 Hidden State Dependencies

1. **Invoice Status Derivation**
   - **Not Stored**: Status is derived from payments + credit notes
   - **Calculation**: `balance = total - totalPaid - totalCredits`
   - **Status Logic**: Based on balance (paid/partially_paid/sent/overdue)
   - **Location**: `supabase/migrations/040_credit_notes.sql:156`

2. **Accounting Period State**
   - **Enforcement**: Ledger entries only allowed in open periods
   - **Validation**: `validate_period_open_for_entry()`
   - **Impact**: Transactions blocked if period closed
   - **Location**: `supabase/migrations/088_hard_db_constraints_ledger.sql:235`

3. **Register Default Enforcement**
   - **Rule**: Single default register per store
   - **Enforcement**: `enforce_single_default_register()` trigger
   - **Action**: Automatically un-sets other defaults when one is set
   - **Location**: `supabase/migrations/127_register_default_enforcement.sql:137`

---

## 6. TECHNICAL DEBT & "TODOs"

### 6.1 Critical TODOs (Incomplete Features)

#### Payment Integrations
- **Location**: `app/api/payments/momo/initiate/route.ts:218, 255, 262`
- **Status**: Placeholder implementations
- **Impact**: Mobile money payments not functional
- **TODOs**:
  - "TODO: Implement actual MTN MoMo API integration"
  - "TODO: Implement Vodafone Cash API integration"
  - "TODO: Implement AirtelTigo Money API integration"

#### Email Service
- **Location**: `app/api/reminders/process-automated/route.ts:307`
- **Status**: Not implemented
- **Impact**: Automated reminders cannot send emails
- **TODO**: "TODO: Integrate with actual email service when available"
- **Location**: `app/api/invoices/[id]/send/route.ts:216`
- **TODO**: "TODO: Implement email sending with PDF attachment"

#### WhatsApp Security
- **Location**: `app/api/whatsapp/callback/route.ts:158`
- **Status**: Tokens stored as plain text
- **Impact**: Security vulnerability
- **TODO**: "TODO: Encrypt access token before storing"

#### PDF Generation
- **Location**: `app/api/invoices/[id]/pdf-preview/route.ts:155`
- **Status**: Returns HTML, not PDF
- **Impact**: No actual PDF download
- **TODO**: "TODO: In the future, this should generate actual PDF"

### 6.2 Deprecated Code Paths

#### Legacy Tax Engine
- **Location**: `lib/ghanaTaxEngine.ts`
- **Status**: Deprecated but still used
- **Comment**: "NOTE: This is a legacy engine maintained for backward compatibility"
- **Migration**: New code should use `lib/taxEngine/jurisdictions/ghana.ts`
- **Usage**: Still used in 19 files (bills, expenses, credit notes)

#### Legacy Tax Columns
- **Location**: Multiple (invoices, sales, etc.)
- **Status**: Deprecated but populated for backward compatibility
- **Columns**: `nhil`, `getfund`, `covid`, `vat`
- **Source of Truth**: `tax_lines` JSONB column
- **Migration Status**: In progress (9 files migrated, 19 remaining)

#### Deprecated Route Guards
- **Location**: `lib/useRouteGuard.ts`, `lib/storeContextGuard.ts`
- **Status**: DEPRECATED
- **Comment**: "DEPRECATED: Route guards are now centralized in ProtectedLayout"
- **Replacement**: `ProtectedLayout` via `resolveAccess()`

### 6.3 Known Bugs & Issues

#### Stock Restoration Bug
- **Location**: `app/api/override/refund-sale/route.ts:192`
- **Issue**: Updates `products` table instead of `products_stock`
- **Status**: Known bug (documented in `REFUND_STOCK_INVESTIGATION.md`)
- **Impact**: Refunds don't restore stock correctly in multi-store setup

#### Void Stock Restoration Missing
- **Location**: `app/api/override/void-sale/route.ts`
- **Issue**: No stock restoration logic
- **Status**: Known bug
- **Impact**: Voided sales don't restore stock

#### Stock Update Silent Failure
- **Location**: `app/api/sales/create/route.ts:617, 795`
- **Issue**: Stock update errors are logged but don't fail sale
- **Status**: Known issue (documented in `STOCK_UPDATE_FAILURE_AUDIT.md`)
- **Impact**: Sales complete successfully even if stock update fails

#### Auth Disabled Pattern
- **Location**: 189 instances across codebase
- **Pattern**: `// AUTH DISABLED FOR DEVELOPMENT`
- **Status**: Development-only (documented in `AUTH_DISABLED_PATTERN.md`)
- **Impact**: No authorization checks in development
- **Action Required**: Re-enable before production

### 6.4 Incomplete Migrations

#### Tax Engine Migration
- **Status**: Partial (9 files migrated, 19 remaining)
- **New System**: `lib/taxEngine/` (pluggable)
- **Legacy System**: `lib/ghanaTaxEngine.ts`, `lib/vat.ts`
- **Impact**: Inconsistent tax calculations across features

#### Sales Route Tax Storage
- **Location**: `app/api/sales/create/route.ts`
- **Issue**: Still uses legacy tax columns (`nhil`, `getfund`, `covid`, `vat`)
- **Status**: TODO #5 (tracked in `SANITY_TEST_CHECKLIST.md`)
- **Impact**: POS sales don't store `tax_lines` JSONB

### 6.5 Architectural Weaknesses

#### No Database Transactions
- **Location**: `app/api/sales/create/route.ts`
- **Issue**: Each operation commits independently
- **Impact**: Partial failures leave inconsistent state
- **Example**: Sale created but stock update fails (sale still committed)

#### Foreign Currency Support Incomplete
- **Location**: `app/api/sales/create/route.ts:57`
- **Comment**: "Foreign currency fields removed - FX not fully supported end-to-end"
- **Impact**: Multi-currency sales not supported

#### Hardcoded Country Assumptions
- **Location**: Multiple (currency defaults, tax calculations)
- **Issue**: System assumes Ghana-first, with multi-country added later
- **Evidence**: GHS defaults, Ghana tax rates hardcoded in legacy code
- **Impact**: Some features may not work correctly for non-Ghana businesses

---

## 7. SUMMARY: "UNWRITTEN RULES" OF FINZA

### 7.1 Core Principles

1. **Tax-Inclusive by Default**: All prices are tax-inclusive; system reverse-calculates base
2. **System-Controlled Numbers**: Invoice numbers generated only when sent, not for drafts
3. **Currency-Country Coupling**: Currency must match country; no silent fallbacks
4. **Automatic Ledger Posting**: Transactions auto-post to ledger via database triggers
5. **Status Derivation**: Invoice status derived from payments, not stored directly

### 7.2 Hidden Validations

1. **Invoice Total Correction**: System auto-corrects invoice totals before payment
2. **Payment Overpayment Prevention**: Payments cannot exceed remaining balance
3. **Stock Deduction Conditions**: Only if `track_stock !== false` (variants always deduct)
4. **Register Requirement**: All sales require active register session
5. **Period State Enforcement**: Ledger entries only allowed in open accounting periods

### 7.3 Critical Dependencies

1. **Tax Engine Registry**: Country → Tax engine selection (7 jurisdictions supported)
2. **Account Resolution**: Chart of accounts codes → Account IDs (hardcoded: 1000, 1100, 4000, etc.)
3. **Database Functions**: RPC functions for invoice numbers, tokens, ledger posting
4. **Service Role Key**: Required for stock movements (bypasses RLS)

### 7.4 Known Limitations

1. **Multi-Currency**: Foreign currency support incomplete (FX not supported)
2. **Payment Integrations**: Mobile money APIs are placeholders
3. **Email Service**: Not implemented (reminders, invoice sending)
4. **PDF Generation**: Returns HTML, not actual PDF
5. **Auth Disabled**: 189 instances of disabled authorization (development only)

### 7.5 Technical Debt Priorities

1. **HIGH**: Complete tax engine migration (19 files remaining)
2. **HIGH**: Fix stock restoration bugs (refunds, voids)
3. **MEDIUM**: Implement payment integrations (mobile money)
4. **MEDIUM**: Implement email service
5. **LOW**: Migrate to actual PDF generation
6. **CRITICAL**: Re-enable authorization before production

---

**End of Deep Reveal Report**

**Next Steps**: 
- Review and prioritize technical debt items
- Complete tax engine migration
- Fix known bugs (stock restoration, void handling)
- Implement missing integrations (payments, email)
- Re-enable authorization checks before production launch
