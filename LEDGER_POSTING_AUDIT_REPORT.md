# Ledger Posting SQL Functions Audit Report

**Date**: 2025-01-27  
**Migration**: `130_refactor_ledger_posting_to_use_tax_lines_canonical.sql`

## Executive Summary

✅ **ALL CHECKS PASSED**

Both ledger posting functions have been verified to:
- Read tax data exclusively from `tax_lines` JSONB column (canonical format)
- Parse tax amounts from `tax_lines->'lines'` array
- Extract ledger metadata from `line.meta` object
- **NOT** read from legacy tax columns (`vat`, `nhil`, `getfund`, `covid`)
- **NOT** contain any date-based cutoff logic

---

## Functions Audited

### 1. `post_invoice_to_ledger(p_invoice_id UUID)`

**Location**: Lines 37-204  
**Status**: ✅ COMPLIANT

#### Tax Data Source
- **SELECT Statement** (Lines 60-71):
  ```sql
  SELECT 
    i.business_id,
    i.total,
    i.subtotal,
    i.total_tax,
    i.customer_id,
    i.invoice_number,
    i.issue_date,
    i.tax_lines  -- ✅ Only tax_lines JSONB, no legacy columns
  INTO invoice_record
  FROM invoices i
  ```

#### Tax Lines Parsing (Lines 84-102)
- ✅ Reads from `tax_lines_jsonb := invoice_record.tax_lines`
- ✅ Parses canonical format: `tax_lines_jsonb->'lines'`
- ✅ Validates JSONB structure: `jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'lines'`
- ✅ Extracts individual tax line items from array
- ✅ Extracts `amount` from: `tax_line_item->>'amount'`
- ✅ Extracts `ledger_account_code` from: `line_meta->>'ledger_account_code'` (canonical) or fallback
- ✅ Extracts `ledger_side` from: `line_meta->>'ledger_side'` (canonical) or fallback

#### Tax Posting Logic (Lines 148-190)
- ✅ Iterates over `parsed_tax_lines` array
- ✅ Posts tax amounts directly from `tax_line_item->>'amount'`
- ✅ Uses `ledger_side` from metadata to determine debit/credit
- ✅ No date-based conditionals

#### Legacy Column Checks
- ✅ **NO** references to `i.vat`
- ✅ **NO** references to `i.nhil`
- ✅ **NO** references to `i.getfund`
- ✅ **NO** references to `i.covid`

#### Cutoff Date Checks
- ✅ **NO** date-based IF statements
- ✅ **NO** `CASE WHEN date >= '2026-01-01'` logic
- ✅ **NO** WHERE clauses with date comparisons

---

### 2. `post_credit_note_to_ledger(p_credit_note_id UUID)`

**Location**: Lines 209-406  
**Status**: ✅ COMPLIANT

#### Tax Data Source
- **SELECT Statement** (Lines 233-245):
  ```sql
  SELECT 
    cn.business_id,
    cn.invoice_id,
    cn.total,
    cn.subtotal,
    cn.total_tax,
    cn.credit_number,
    cn.date,
    cn.tax_lines  -- ✅ Only tax_lines JSONB, no legacy columns
  INTO cn_record
  FROM credit_notes cn
  ```

#### Tax Lines Parsing (Lines 267-285)
- ✅ Reads from `tax_lines_jsonb := cn_record.tax_lines`
- ✅ Parses canonical format: `tax_lines_jsonb->'lines'`
- ✅ Validates JSONB structure: `jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'lines'`
- ✅ Extracts individual tax line items from array
- ✅ Extracts `amount` from: `tax_line_item->>'amount'`
- ✅ Extracts `ledger_account_code` from: `line_meta->>'ledger_account_code'` (canonical) or fallback
- ✅ Extracts `ledger_side` from: `line_meta->>'ledger_side'` (canonical) or fallback

#### Tax Reversal Logic (Lines 341-392)
- ✅ Iterates over `parsed_tax_lines` array
- ✅ Posts tax amounts directly from `tax_line_item->>'amount'`
- ✅ Reverses original `ledger_side` (credit → debit, debit → credit)
- ✅ No date-based conditionals

#### Legacy Column Checks
- ✅ **NO** references to `cn.vat`
- ✅ **NO** references to `cn.nhil`
- ✅ **NO** references to `cn.getfund`
- ✅ **NO** references to `cn.covid`

#### Cutoff Date Checks
- ✅ **NO** date-based IF statements
- ✅ **NO** `CASE WHEN date >= '2026-01-01'` logic
- ✅ **NO** WHERE clauses with date comparisons

---

## Canonical Format Support

Both functions correctly handle the canonical `tax_lines` JSONB format:

```json
{
  "lines": [
    {
      "code": "VAT",
      "amount": 15.90,
      "rate": 0.15,
      "name": "VAT",
      "meta": {
        "ledger_account_code": "2100",
        "ledger_side": "credit"
      }
    }
  ],
  "meta": {
    "jurisdiction": "GH",
    "effective_date_used": "2025-12-31",
    "engine_version": "GH-2025-A"
  },
  "pricing_mode": "inclusive"
}
```

**Extraction Pattern**:
1. ✅ Read `tax_lines` JSONB column
2. ✅ Extract `tax_lines->'lines'` array
3. ✅ For each line, extract `amount` from `line->>'amount'`
4. ✅ Extract `ledger_account_code` from `line->'meta'->>'ledger_account_code'`
5. ✅ Extract `ledger_side` from `line->'meta'->>'ledger_side'`

**Fallback Support**:
- ✅ Also supports legacy format where `ledger_account_code` and `ledger_side` are directly on the line (not in `meta`)
- ✅ Ensures backward compatibility while preferring canonical format

---

## Verification Test Function

**Function**: `verify_ledger_posting_tax_lines()`  
**Location**: Lines 424-746  
**Purpose**: Automated verification of tax_lines canonical format handling

**Test Coverage**:
1. ✅ Pre-2026 invoice includes COVID tax line in ledger
2. ✅ Post-2026 invoice excludes COVID from ledger
3. ✅ Ledger tax amounts exactly match tax_lines amounts

**Note**: Test function uses date-based test data (2025-12-31 vs 2026-01-01) to verify tax engine behavior, but this is **test data only**, not business logic.

---

## Compliance Checklist

| Requirement | Status | Evidence |
|------------|--------|----------|
| `post_invoice_to_ledger` reads `tax_lines` JSONB | ✅ PASS | Lines 68, 85-102 |
| `post_credit_note_to_ledger` reads `tax_lines` JSONB | ✅ PASS | Lines 241, 268-285 |
| No legacy column reads (`vat`, `nhil`, `getfund`, `covid`) | ✅ PASS | SELECT statements only include `tax_lines` |
| No cutoff dates in business logic | ✅ PASS | No date conditionals found in functions |
| Canonical format parsing (`tax_lines->'lines'`) | ✅ PASS | Both functions parse `lines` array |
| Metadata extraction (`line.meta`) | ✅ PASS | Both functions extract from `line_meta` |

---

## Additional Notes

### Other Ledger Posting Functions

The following functions exist but **do not handle invoice/credit note taxes** and are out of scope for this audit:

- `post_invoice_payment_to_ledger` - Handles cash/AR settlement (no taxes)
- `post_bill_to_ledger` - Handles vendor bills (may have taxes, but separate concern)
- `post_sale_to_ledger` - Handles POS sales (may have taxes, but separate concern)
- `post_expense_to_ledger` - Handles expenses (no taxes)
- `post_payroll_to_ledger` - Handles payroll (separate tax logic)

### Migration History

- **Migration 130** (current): Refactored to use canonical `tax_lines` format
- **Migration 100**: Earlier version with control account resolution
- **Migration 099**: Added COA validation guards
- **Migration 094**: Added accounting period guards
- **Migration 043**: Original implementation

**Recommendation**: Migration 130 supersedes all previous versions for these two functions.

---

## Conclusion

✅ **ALL FUNCTIONS VERIFIED AND COMPLIANT**

Both `post_invoice_to_ledger` and `post_credit_note_to_ledger` have been successfully refactored to:
- Read tax data exclusively from `tax_lines` JSONB (canonical format)
- Parse tax amounts from `tax_lines->'lines'` array
- Extract ledger metadata from `line.meta` object
- Support backward compatibility with legacy format (direct properties on line)
- **NO** legacy column dependencies
- **NO** date-based cutoff logic

The functions are ready for production use with the canonical tax_lines format.

---

**Audited By**: AI Assistant  
**Audit Date**: 2025-01-27  
**Migration Version**: 130_refactor_ledger_posting_to_use_tax_lines_canonical.sql
