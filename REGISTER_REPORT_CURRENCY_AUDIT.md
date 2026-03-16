# Register & Report Currency Source Audit
**Date**: Post Tax-Engine Hardening  
**Context**: POS correctly throws error for unsupported country "KE", but register/report screens still display GHS

---

## Executive Summary

**Finding**: Register opening/closing screens and reports hardcode "GHS" currency labels instead of reading from `business.default_currency`. This causes currency leakage for non-Ghana businesses (e.g., Kenya "KE").

**Root Cause**: 
- Register/session tables do NOT store currency information
- UI components hardcode "GHS" string literals
- Reports hardcode "GHS" string literals
- No currency lookup from `business.default_currency` in register/report flows

**Impact**: 
- Kenyan businesses see "GHS" labels despite having `default_currency = "KES"`
- Inconsistent with POS which correctly validates country/currency
- Violates multi-currency support architecture

---

## 1. Register Session Schema Analysis

### Database Tables

**`cashier_sessions` table** (from `supabase/migrations/013_multi_register.sql`):
```sql
CREATE TABLE cashier_sessions (
  id uuid PRIMARY KEY,
  register_id uuid REFERENCES registers(id),
  user_id uuid REFERENCES users(id),
  business_id uuid REFERENCES businesses(id),
  opening_float numeric NOT NULL,
  closing_amount numeric,
  status text CHECK (status IN ('open', 'closed')),
  started_at timestamp DEFAULT now(),
  ended_at timestamp
);
```

**Findings**:
- ❌ **NO `currency_code` column**
- ❌ **NO `currency_symbol` column**
- ✅ Stores `business_id` (can be used to lookup currency)
- ✅ Stores `opening_float` and `closing_amount` (numeric values only)

**`registers` table**:
```sql
CREATE TABLE registers (
  id uuid PRIMARY KEY,
  business_id uuid REFERENCES businesses(id),
  name text NOT NULL,
  created_at timestamp DEFAULT now()
);
```

**Findings**:
- ❌ **NO `currency_code` column**
- ❌ **NO `currency_symbol` column**
- ✅ Stores `business_id` (can be used to lookup currency)

**`businesses` table** (from `supabase/migrations/051_fix_all_table_structures.sql`):
```sql
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS default_currency TEXT DEFAULT 'GHS';
```

**Findings**:
- ✅ **HAS `default_currency` column** (defaults to 'GHS')
- ⚠️ Default value is 'GHS' (Ghana-specific)

---

## 2. Register Creation Logic Analysis

### Opening Register Session

**File**: `app/sales/open-session/page.tsx`

**Code Flow** (lines 104-309):
1. User selects register and enters `opening_float`
2. Creates `cashier_sessions` row with:
   - `register_id`
   - `user_id`
   - `business_id`
   - `opening_float` (numeric)
   - `status = "open"`
   - **NO currency information stored**

**Findings**:
- ❌ **Does NOT read `business.default_currency`**
- ❌ **Does NOT store currency in session**
- ❌ **Assumes currency is GHS** (hardcoded in UI labels)

**File**: `app/onboarding/retail/register.tsx`

**Code Flow** (lines 81-152):
1. Similar flow - creates session without currency lookup
2. **NO currency information stored**

**Findings**:
- ❌ **Does NOT read `business.default_currency`**
- ❌ **Does NOT store currency in session**

---

## 3. Register UI Rendering Analysis

### Opening Float Screen

**File**: `app/sales/open-session/page.tsx`

**Line 383**:
```tsx
<label className="block text-sm font-medium mb-2">
  Opening Float (GHS) <span className="text-red-600">*</span>
</label>
```

**Finding**: ❌ **Hardcoded "GHS" in label**

**File**: `app/onboarding/retail/register.tsx`

**Line 195**:
```tsx
<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
  Opening Float (GHS) *
</label>
```

**Finding**: ❌ **Hardcoded "GHS" in label**

### Closing Session Screen

**File**: `app/sales/close-session/page.tsx`

**Line 292**:
```tsx
<span className="font-medium">GHS {Number(session.opening_float).toFixed(2)}</span>
```

**Line 307**:
```tsx
<label className="block text-sm font-medium mb-2">
  Expected Cash (GHS)
</label>
```

**Line 310**:
```tsx
GHS {Number(expectedCash.toFixed(2))}
```

**Line 319**:
```tsx
<label className="block text-sm font-medium mb-2">
  Counted Cash (GHS) <span className="text-red-600">*</span>
</label>
```

**Line 337**:
```tsx
<label className="block text-sm font-medium mb-2">Variance (GHS)</label>
```

**Line 346**:
```tsx
{variance > 0 ? "+" : ""}GHS {Number(variance.toFixed(2))}
```

**Findings**: ❌ **6 instances of hardcoded "GHS"**

### Close Register Modal (POS)

**File**: `app/(dashboard)/pos/register/CloseRegisterModal.tsx`

**Line 244**:
```tsx
<label className="block text-sm font-medium mb-2">
  Expected Cash (GHS)
</label>
```

**Line 258**:
```tsx
<label className="block text-sm font-medium mb-2">
  Counted Cash (GHS) *
</label>
```

**Line 276**:
```tsx
<label className="block text-sm font-medium mb-2">
  Variance (GHS)
</label>
```

**Findings**: ❌ **3 instances of hardcoded "GHS"**

---

## 4. Reports Using Register Context

### Register Report

**File**: `app/reports/registers/page.tsx`

**Lines 208, 220, 224, 228, 232, 236**:
```tsx
<div className="text-2xl font-bold">GHS {register.total_sales.toFixed(2)}</div>
<div className="font-semibold">GHS {register.cash_total.toFixed(2)}</div>
<div className="font-semibold">GHS {register.momo_total.toFixed(2)}</div>
<div className="font-semibold">GHS {register.hubtel_total.toFixed(2)}</div>
<div className="font-semibold">GHS {register.card_total.toFixed(2)}</div>
<div className="font-semibold">GHS {register.bank_total.toFixed(2)}</div>
```

**Findings**: 
- ❌ **6 instances of hardcoded "GHS"**
- ❌ **Does NOT read `business.default_currency`**
- ❌ **Does NOT use `getCurrencySymbol()` utility**

### Cash Office Report

**File**: `app/reports/cash-office/page.tsx`

**Lines 576, 577, 579, 595, 611, 661, 667, 671, 675, 679, 683**:
```tsx
<td className="border px-4 py-2 text-right">GHS {reg.total_opening_cash.toFixed(2)}</td>
<td className="border px-4 py-2 text-right">GHS {reg.total_closing_cash.toFixed(2)}</td>
GHS {reg.net_cash_movement.toFixed(2)}
<div className="text-2xl font-bold">GHS {(reportData.cash_drops_summary?.total_drops || 0).toFixed(2)}</div>
GHS {Math.abs(reportData.variances_summary?.total_variance || 0).toFixed(2)}
<div className="text-3xl font-bold">GHS {(reportData.sales_summary?.total_sales || 0).toFixed(2)}</div>
<div className="text-xl font-semibold">GHS {(reportData.sales_summary?.cash_total || 0).toFixed(2)}</div>
<div className="text-xl font-semibold">GHS {(reportData.sales_summary?.momo_total || 0).toFixed(2)}</div>
<div className="text-xl font-semibold">GHS {(reportData.sales_summary?.card_total || 0).toFixed(2)}</div>
<div className="text-xl font-semibold">GHS {(reportData.sales_summary?.bank_total || 0).toFixed(2)}</div>
<div className="text-xl font-semibold">GHS {(reportData.sales_summary?.hubtel_total || 0).toFixed(2)}</div>
```

**Findings**: 
- ❌ **11 instances of hardcoded "GHS"**
- ❌ **Does NOT read `business.default_currency`**
- ❌ **Does NOT use `getCurrencySymbol()` utility**

### VAT Report

**File**: `app/reports/vat/page.tsx`

**Lines 346, 352, 358, 371, 377, 383, 389, 395, 401**:
```tsx
GHS {reportData.standard_rated_sales.toFixed(2)}
GHS {reportData.zero_rated_sales.toFixed(2)}
GHS {reportData.exempt_sales.toFixed(2)}
GHS {(reportData.taxable_base ?? ...).toFixed(2)}
GHS {reportData.nhil_total.toFixed(2)}
GHS {reportData.getfund_total.toFixed(2)}
GHS {reportData.covid_total.toFixed(2)}
GHS {reportData.vat_total.toFixed(2)}
GHS {reportData.total_tax.toFixed(2)}
```

**Findings**: 
- ❌ **9 instances of hardcoded "GHS"**
- ❌ **Does NOT read `business.default_currency`**
- ❌ **Does NOT use `getCurrencySymbol()` utility**

---

## 5. Currency Utility Available But Not Used

**File**: `lib/currency.ts`

**Available Functions**:
```typescript
export function getCurrencySymbol(currencyCode: string | null | undefined): string
export function getCurrencyName(currencyCode: string | null | undefined): string
```

**Supported Currencies**:
- GHS → ₵
- USD → $
- EUR → €
- GBP → £
- KES → KSh
- NGN → ₦
- ZAR → R
- UGX → USh
- TZS → TSh

**Findings**:
- ✅ **Utility exists and supports KES (Kenya)**
- ❌ **NOT used in register screens**
- ❌ **NOT used in reports**
- ✅ **Used in `app/retail/dashboard/page.tsx`** (line 195) - **CORRECT IMPLEMENTATION**

**Example of Correct Usage** (from `app/retail/dashboard/page.tsx`):
```tsx
const formatCurrency = (amount: number) => {
  const symbol = getCurrencySymbol(business?.default_currency)
  return `${symbol}${amount.toFixed(2)}`
}
```

---

## 6. Confirmation of Ghana Default Leakage

### Evidence

1. **Database Default**: `businesses.default_currency` defaults to `'GHS'` in migration
2. **UI Hardcoding**: 29+ instances of hardcoded "GHS" in register/report screens
3. **No Currency Lookup**: Register creation does NOT read `business.default_currency`
4. **No Currency Storage**: Session table does NOT store currency information

### Impact on Kenya (KE) Businesses

**Scenario**:
- Business has `default_currency = "KES"`
- User opens register session
- UI shows: "Opening Float (GHS)" ❌
- User closes register session
- UI shows: "Expected Cash (GHS)", "Counted Cash (GHS)" ❌
- Reports show: "GHS 1,234.56" ❌

**Expected**:
- UI should show: "Opening Float (KES)" or "Opening Float (KSh)"
- Reports should show: "KES 1,234.56" or "KSh 1,234.56"

---

## 7. Summary of Findings

### Register Session Schema
- ❌ **NO `currency_code` or `currency_symbol` columns**
- ✅ Stores `business_id` (can lookup currency)
- ✅ Stores numeric amounts only

### Register Creation Logic
- ❌ **Does NOT read `business.default_currency`**
- ❌ **Does NOT store currency in session**
- ❌ **Assumes GHS by default**

### Register UI Rendering
- ❌ **9 instances of hardcoded "GHS"** across 4 files:
  - `app/sales/open-session/page.tsx`: 1 instance
  - `app/sales/close-session/page.tsx`: 6 instances
  - `app/(dashboard)/pos/register/CloseRegisterModal.tsx`: 3 instances
  - `app/onboarding/retail/register.tsx`: 1 instance

### Reports
- ❌ **26 instances of hardcoded "GHS"** across 3 files:
  - `app/reports/registers/page.tsx`: 6 instances
  - `app/reports/cash-office/page.tsx`: 11 instances
  - `app/reports/vat/page.tsx`: 9 instances

### Currency Utility
- ✅ **`lib/currency.ts` exists and supports KES**
- ❌ **NOT used in register/report screens**
- ✅ **Used correctly in retail dashboard** (reference implementation)

---

## 8. Recommended Fixes (For Future Implementation)

### Option A: Lookup Currency from Business (No Schema Change)
1. Load `business.default_currency` when rendering register/report screens
2. Use `getCurrencySymbol(business.default_currency)` for all currency labels
3. Replace all hardcoded "GHS" strings

**Files to Update**:
- `app/sales/open-session/page.tsx`
- `app/sales/close-session/page.tsx`
- `app/(dashboard)/pos/register/CloseRegisterModal.tsx`
- `app/onboarding/retail/register.tsx`
- `app/reports/registers/page.tsx`
- `app/reports/cash-office/page.tsx`
- `app/reports/vat/page.tsx`

### Option B: Store Currency in Session (Schema Change)
1. Add `currency_code` column to `cashier_sessions` table
2. Store `business.default_currency` when creating session
3. Use stored currency when rendering (allows currency changes mid-session)

**Migration Required**:
```sql
ALTER TABLE cashier_sessions
  ADD COLUMN currency_code TEXT;

-- Backfill from business
UPDATE cashier_sessions cs
SET currency_code = b.default_currency
FROM businesses b
WHERE cs.business_id = b.id;
```

---

## 9. Conclusion

**Confirmed**: Register and report currency labels are sourced from **hardcoded "GHS" strings**, not from `business.default_currency`.

**Ghana Default Leakage**: ✅ **CONFIRMED**
- 35+ instances of hardcoded "GHS" across 7 files
- No currency lookup from business profile
- No currency storage in session/register tables

**Impact**: Kenyan businesses (and other non-Ghana businesses) see incorrect currency labels in register and report screens, despite POS correctly validating country/currency.

**Priority**: **HIGH** - Violates multi-currency architecture and causes user confusion for non-Ghana businesses.

---

**End of Audit Report**


