# Ghana Tax Engine - Updated TaxLine Structure Examples

## Updated TaxLine Interface

The `TaxLine` interface now includes ledger posting metadata:

```typescript
export interface TaxLine {
  code: string                    // Tax code (e.g., 'VAT', 'NHIL', 'GETFUND', 'COVID')
  name: string                    // Tax name
  rate: number                    // Decimal rate (e.g., 0.15 for 15%)
  base: number                    // Taxable base amount
  amount: number                  // Calculated tax amount
  ledger_account_code?: string    // Ledger account code for posting (e.g., '2100', '2110')
  is_creditable_input?: boolean   // Whether input tax is creditable (can offset output tax)
}
```

## Ledger Account Mapping

| Tax Code | Ledger Account Code | Account Name |
|----------|---------------------|--------------|
| VAT | 2100 | VAT Payable |
| NHIL | 2110 | NHIL Payable |
| GETFUND | 2120 | GETFund Payable |
| COVID | 2130 | COVID Payable |

## Creditable Input Status

| Tax Code | Pre-2026 (before 2026-01-01) | Post-2026 (>= 2026-01-01) |
|----------|------------------------------|---------------------------|
| VAT | ✅ Always creditable | ✅ Always creditable |
| NHIL | ❌ Not creditable | ✅ Creditable |
| GETFUND | ❌ Not creditable | ✅ Creditable |
| COVID | ❌ Not creditable | ❌ Not creditable (removed) |

## Example 1: Pre-Reform (2025-12-31)

**Input:**
- Taxable Amount: GHS 100.00
- Effective Date: 2025-12-31

**Calculation:**
- NHIL: 100.00 × 2.5% = GHS 2.50
- GETFund: 100.00 × 2.5% = GHS 2.50
- COVID: 100.00 × 1% = GHS 1.00
- VAT Base: 100.00 + 2.50 + 2.50 + 1.00 = GHS 106.00
- VAT: 106.00 × 15% = GHS 15.90
- Total Tax: 2.50 + 2.50 + 1.00 + 15.90 = GHS 21.90

**tax_lines JSON:**
```json
[
  {
    "code": "NHIL",
    "name": "NHIL",
    "rate": 0.025,
    "base": 100.00,
    "amount": 2.50,
    "ledger_account_code": "2110",
    "is_creditable_input": false
  },
  {
    "code": "GETFUND",
    "name": "GETFund",
    "rate": 0.025,
    "base": 100.00,
    "amount": 2.50,
    "ledger_account_code": "2120",
    "is_creditable_input": false
  },
  {
    "code": "COVID",
    "name": "COVID",
    "rate": 0.01,
    "base": 100.00,
    "amount": 1.00,
    "ledger_account_code": "2130",
    "is_creditable_input": false
  },
  {
    "code": "VAT",
    "name": "VAT",
    "rate": 0.15,
    "base": 106.00,
    "amount": 15.90,
    "ledger_account_code": "2100",
    "is_creditable_input": true
  }
]
```

## Example 2: Post-Reform (2026-01-01)

**Input:**
- Taxable Amount: GHS 100.00
- Effective Date: 2026-01-01

**Calculation:**
- NHIL: 100.00 × 2.5% = GHS 2.50
- GETFund: 100.00 × 2.5% = GHS 2.50
- COVID: 100.00 × 0% = GHS 0.00 (removed)
- VAT Base: 100.00 + 2.50 + 2.50 = GHS 105.00
- VAT: 105.00 × 15% = GHS 15.75
- Total Tax: 2.50 + 2.50 + 0.00 + 15.75 = GHS 20.75

**tax_lines JSON:**
```json
[
  {
    "code": "NHIL",
    "name": "NHIL",
    "rate": 0.025,
    "base": 100.00,
    "amount": 2.50,
    "ledger_account_code": "2110",
    "is_creditable_input": true
  },
  {
    "code": "GETFUND",
    "name": "GETFund",
    "rate": 0.025,
    "base": 100.00,
    "amount": 2.50,
    "ledger_account_code": "2120",
    "is_creditable_input": true
  },
  {
    "code": "VAT",
    "name": "VAT",
    "rate": 0.15,
    "base": 105.00,
    "amount": 15.75,
    "ledger_account_code": "2100",
    "is_creditable_input": true
  }
]
```

**Note:** COVID tax line is not included in post-reform calculations (rate is 0%).

## Key Changes Summary

1. **Ledger Account Codes**: Each tax line now includes `ledger_account_code` for automated ledger posting
   - VAT → 2100
   - NHIL → 2110
   - GETFund → 2120
   - COVID → 2130

2. **Creditable Input Flag**: Each tax line includes `is_creditable_input` to indicate if input tax can offset output tax
   - VAT: Always `true`
   - NHIL/GETFund: `false` before 2026-01-01, `true` from 2026-01-01
   - COVID: Always `false`

3. **Historical Behavior Preserved**: Pre-2026 calculations remain unchanged; only metadata is added

4. **2026 Reform Impact**: 
   - COVID tax removed (not included in tax_lines)
   - NHIL and GETFund become creditable inputs
   - VAT calculation base changes (excludes COVID)





