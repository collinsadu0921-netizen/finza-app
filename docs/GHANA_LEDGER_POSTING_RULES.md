# Ghana Tax Line Ledger Posting Rules

## Overview
This document defines the ledger account posting rules for Ghana tax lines (VAT, NHIL, GETFund, COVID) for sales (output tax) and purchases/expenses (input tax).

## Account Structure

### Existing Ledger Accounts
- **2100 - VAT Payable**: Liability account for VAT output tax minus input tax
- **2200 - Other Tax Liabilities**: Liability account for other tax obligations (NHIL, GETFund, COVID)

## Ledger Posting Rules Table

| TaxLine Code | Transaction Type | Ledger Account | Debit/Credit | Creditable | Effective Date | Notes |
|-------------|-----------------|----------------|--------------|------------|----------------|-------|
| **VAT** | Sales (Output Tax) | 2100 - VAT Payable | Credit | N/A | All dates | Increases VAT liability |
| **VAT** | Purchases/Expenses (Input Tax) | 2100 - VAT Payable | Debit | Yes | All dates | Reduces VAT liability (creditable) |
| **NHIL** | Sales (Output Tax) | 2200 - Other Tax Liabilities | Credit | N/A | All dates | Increases NHIL liability |
| **NHIL** | Purchases/Expenses (Input Tax) | 2200 - Other Tax Liabilities | Debit | **No** (pre-2026) | Before 2026-01-01 | Reduces NHIL liability (non-creditable before 2026) |
| **NHIL** | Purchases/Expenses (Input Tax) | 2200 - Other Tax Liabilities | Debit | **Yes** (post-2026) | >= 2026-01-01 | Reduces NHIL liability (creditable after 2026 reform) |
| **GETFUND** | Sales (Output Tax) | 2200 - Other Tax Liabilities | Credit | N/A | All dates | Increases GETFund liability |
| **GETFUND** | Purchases/Expenses (Input Tax) | 2200 - Other Tax Liabilities | Debit | **No** (pre-2026) | Before 2026-01-01 | Reduces GETFund liability (non-creditable before 2026) |
| **GETFUND** | Purchases/Expenses (Input Tax) | 2200 - Other Tax Liabilities | Debit | **Yes** (post-2026) | >= 2026-01-01 | Reduces GETFund liability (creditable after 2026 reform) |
| **COVID** | Sales (Output Tax) | 2200 - Other Tax Liabilities | Credit | N/A | Before 2026-01-01 | Increases COVID liability (removed post-2026) |
| **COVID** | Purchases/Expenses (Input Tax) | 2200 - Other Tax Liabilities | Debit | **No** | Before 2026-01-01 | Reduces COVID liability (non-creditable, removed post-2026) |

## Detailed Explanation

### VAT (Value Added Tax)
- **Account**: 2100 - VAT Payable
- **Sales (Output Tax)**:
  - Debit/Credit: **Credit**
  - Effect: Increases VAT liability
  - Creditable: N/A (output tax is not creditable)
  
- **Purchases/Expenses (Input Tax)**:
  - Debit/Credit: **Debit**
  - Effect: Reduces VAT liability
  - Creditable: **Yes** (always creditable)
  - Date Dependency: None (creditable at all times)

### NHIL (National Health Insurance Levy)
- **Account**: 2200 - Other Tax Liabilities
- **Sales (Output Tax)**:
  - Debit/Credit: **Credit**
  - Effect: Increases NHIL liability
  - Creditable: N/A (output tax is not creditable)
  
- **Purchases/Expenses (Input Tax)**:
  - Debit/Credit: **Debit**
  - Effect: Reduces NHIL liability
  - Creditable:
    - **Before 2026-01-01**: **No** (non-creditable input tax)
    - **>= 2026-01-01**: **Yes** (becomes creditable after 2026 reform)

### GETFund (Ghana Education Trust Fund Levy)
- **Account**: 2200 - Other Tax Liabilities
- **Sales (Output Tax)**:
  - Debit/Credit: **Credit**
  - Effect: Increases GETFund liability
  - Creditable: N/A (output tax is not creditable)
  
- **Purchases/Expenses (Input Tax)**:
  - Debit/Credit: **Debit**
  - Effect: Reduces GETFund liability
  - Creditable:
    - **Before 2026-01-01**: **No** (non-creditable input tax)
    - **>= 2026-01-01**: **Yes** (becomes creditable after 2026 reform)

### COVID (COVID-19 Health Recovery Levy)
- **Account**: 2200 - Other Tax Liabilities
- **Sales (Output Tax)**:
  - Debit/Credit: **Credit**
  - Effect: Increases COVID liability
  - Creditable: N/A (output tax is not creditable)
  - Date Dependency: Only exists before 2026-01-01 (removed in 2026 reform)
  
- **Purchases/Expenses (Input Tax)**:
  - Debit/Credit: **Debit**
  - Effect: Reduces COVID liability
  - Creditable: **No** (always non-creditable)
  - Date Dependency: Only exists before 2026-01-01 (removed in 2026 reform)

## Double-Entry Accounting Examples

### Example 1: Sales Invoice (Pre-2026)
**Invoice**: GHS 100 taxable amount
- NHIL: GHS 2.50
- GETFund: GHS 2.50
- COVID: GHS 1.00
- VAT: GHS 15.90
- Total: GHS 121.90

**Journal Entry**:
```
Dr. Accounts Receivable (1100)         121.90
    Cr. Service Revenue (4000)                 100.00
    Cr. VAT Payable (2100)                      15.90
    Cr. Other Tax Liabilities (2200)             6.00
```

### Example 2: Supplier Bill (Pre-2026)
**Bill**: GHS 100 taxable amount
- NHIL: GHS 2.50
- GETFund: GHS 2.50
- COVID: GHS 1.00
- VAT: GHS 15.90
- Total: GHS 121.90

**Journal Entry**:
```
Dr. Supplier Bills Expense (5200)      100.00
Dr. VAT Payable (2100)                  15.90  (creditable input)
Dr. Other Tax Liabilities (2200)         6.00  (non-creditable input)
    Cr. Accounts Payable (2000)                 121.90
```

### Example 3: Supplier Bill (Post-2026)
**Bill**: GHS 100 taxable amount (COVID removed)
- NHIL: GHS 2.50
- GETFund: GHS 2.50
- VAT: GHS 15.75
- Total: GHS 120.75

**Journal Entry**:
```
Dr. Supplier Bills Expense (5200)      100.00
Dr. VAT Payable (2100)                  15.75  (creditable input)
Dr. Other Tax Liabilities (2200)         5.00  (creditable input - NHIL + GETFund)
    Cr. Accounts Payable (2000)                 120.75
```

## Implementation Notes

1. **Creditable vs Non-Creditable Input Tax**:
   - Creditable input tax: Reduces the liability account (debit to liability)
   - Non-creditable input tax: Also reduces the liability account (debit to liability), but cannot be used to offset output tax for tax return purposes
   - The "creditable" flag is for tax return/reporting purposes, not for ledger posting structure

2. **2026 Reform Impact**:
   - COVID tax is removed (rate becomes 0%)
   - NHIL and GETFund input taxes become creditable (can offset output tax in VAT returns)
   - VAT calculation changes: VAT base = taxable + NHIL + GETFund (COVID removed)

3. **Account Usage**:
   - Account 2100 is used exclusively for VAT
   - Account 2200 is used for NHIL, GETFund, and COVID (aggregated)
   - Consider separate sub-accounts if detailed tracking is needed per tax type

4. **Date Dependency**:
   - Determine effective date from transaction date (invoice `issue_date`, bill `issue_date`, expense `date`)
   - Use `effectiveDate` from `TaxEngineConfig` to determine which version of rules apply

## Related Files
- `lib/taxEngine/jurisdictions/ghana.ts` - Tax calculation logic
- `lib/taxEngine/types.ts` - TaxLine type definition
- `supabase/migrations/043_accounting_core.sql` - Chart of accounts and posting functions

