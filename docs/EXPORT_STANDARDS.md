# Export Standards for Finza

This document outlines the standardized export functionality implemented across all Finza modules (Service mode).

## Overview

All exports follow consistent rules to ensure accountant-ready, reliable, and reconcilable exports that match on-screen data.

## Global Export Rules

1. **Filter Respect**: All exports respect ALL active filters:
   - Date ranges
   - Status filters
   - Customer/Supplier filters
   - Search queries
   - Category filters

2. **Data Accuracy**: Exported data exactly matches on-screen results

3. **Format Standards**:
   - **CSV**: UTF-8 encoding, comma-separated, raw numbers (no currency symbols)
   - **Excel**: .xlsx format with proper numeric and date cell types

4. **UI Consistency**: Export buttons clearly labeled (CSV / Excel) and visible when data is available

## Implementation

### Standardized Export Library

Location: `lib/exportUtils.ts`

Key functions:
- `exportToCSV<T>(data, columns, filename)` - Export to CSV format
- `exportToExcel<T>(data, columns, filename)` - Export to Excel format
- Helper formatters: `formatCurrencyRaw()`, `formatDate()`, `formatYesNo()`

### Module Exports

#### A. Invoices Export
**Location**: `app/invoices/page.tsx`

**Columns**:
- Invoice Number
- Invoice Date
- Due Date
- Customer
- Status
- Subtotal
- VAT
- Total
- Amount Paid (calculated from payments)
- Outstanding (calculated: Total - Amount Paid)

**Features**:
- Fetches payment totals to calculate amount paid and outstanding
- Respects all filters: status, customer, date range, search query

#### B. Payments Export
**Location**: `app/payments/page.tsx`

**Columns**:
- Payment Date
- Customer
- Invoice Reference
- Amount
- Payment Method

**Features**:
- Respects date range filters (this month, last month, custom)

#### C. Expenses Export
**Location**: `app/expenses/page.tsx`

**Columns**:
- Expense Date
- Category
- Description
- Supplier
- Amount
- VAT (if applicable)
- Receipt Attached (Yes/No)

**Features**:
- Respects category and date range filters
- Includes search query filter

#### D. VAT Returns Export
**Location**: `app/vat-returns/[id]/page.tsx`

**Columns** (detailed transaction export):
- Type (Invoice, Credit Note, Expense, Bill)
- Date
- Number
- Description
- Taxable Amount
- NHIL
- GETFund
- COVID
- VAT
- Total Tax

**Features**:
- Exports all source transactions for a VAT return period
- Supports both CSV and Excel formats

#### E. Trial Balance Export
**Location**: `app/trial-balance/page.tsx`

**Columns**:
- Account Code
- Account Name
- Debit
- Credit
- Balance

**Features**:
- Respects the "as of date" filter
- Exports all accounts with their balances

#### F. General Ledger Export
**Location**: `app/ledger/page.tsx`

**Columns**:
- Date
- Account (Code - Name)
- Description
- Debit
- Credit
- Reference

**Features**:
- Flattens journal entries (each line becomes a row)
- Respects date range, account, and reference type filters

## Technical Details

### CSV Format
- UTF-8 encoding with BOM for Excel compatibility
- Comma-separated values
- Proper escaping of quotes and commas
- Raw numeric values (no currency symbols or formatting)
- Date format: DD/MM/YYYY

### Excel Format
- Uses `xlsx` library (installed as dependency)
- Proper cell types:
  - Numbers: Numeric cells for calculations
  - Dates: Date cells for proper Excel date handling
  - Text: String cells for labels and descriptions
- Column widths automatically set for readability

### Error Handling
- All export functions include try-catch blocks
- User-friendly error messages via toast notifications
- No silent failures

## Usage Example

```typescript
import { exportToCSV, exportToExcel, ExportColumn, formatCurrencyRaw, formatDate } from "@/lib/exportUtils"

// Define columns
const columns: ExportColumn<MyDataType>[] = [
  { header: "Name", accessor: (item) => item.name, width: 30 },
  {
    header: "Amount",
    accessor: (item) => item.amount,
    formatter: formatCurrencyRaw,
    excelType: "number",
    width: 15,
  },
  {
    header: "Date",
    accessor: (item) => item.date,
    formatter: (val) => val ? formatDate(val) : "",
    excelType: "date",
    width: 15,
  },
]

// Export to CSV
exportToCSV(data, columns, "my-export")

// Export to Excel
await exportToExcel(data, columns, "my-export")
```

## Dependencies

- `xlsx`: Required for Excel export functionality
  - Installed via: `npm install xlsx`

## Future Enhancements

- Add PDF export option for formatted reports
- Add export templates for specific accounting software
- Add batch export functionality for multiple date ranges
- Add export scheduling/automation













