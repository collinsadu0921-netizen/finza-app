# Country & Currency Verification Audit

**Date:** 2025-01-XX  
**Scope:** Verify country and currency selection works correctly in practice  
**Status:** ⚠️ **CRITICAL ISSUES FOUND**

---

## 1️⃣ Country Selection During Onboarding

### ✅ **Field Exists**

**Location:** `app/settings/business-profile/page.tsx`

**Field:** `address_country` (Lines 378-389)

**Implementation:**
- ✅ Country field exists in business profile form
- ✅ Field is editable (text input)
- ❌ **NOT a dropdown** - users type free-text (e.g., "Ghana", "Kenya", "Ghana, West Africa")
- ❌ **Hard-coded default:** `"Ghana"` (Line 29 in formData initial state)
- ❌ **Database default:** `TEXT DEFAULT 'Ghana'` (Migration `037_business_profile_invoice_settings.sql`, Line 13)

**Issues Found:**
1. **Free-text input** - No validation, users can type anything
2. **Hard-coded default** - Form initializes with "Ghana" (Line 29)
3. **Database default** - Database defaults to "Ghana" if not provided (Migration 037, Line 13)
4. **No blocking** - Onboarding does not require country selection (field is optional)

**Impact:**
- ⚠️ Users may skip country selection, defaulting to "Ghana"
- ⚠️ Free-text input allows typos (e.g., "Ghana", "ghana", "Ghana, West Africa")
- ⚠️ Tax engine normalization may fail for non-standard country names

---

## 2️⃣ Country → Tax Engine (Runtime Check)

### ⚠️ **PARTIALLY CORRECT** (Fallback to Ghana)

**Location:** `app/api/invoices/create/route.ts` (Lines 150-156)

**Code:**
```typescript
const jurisdiction = business?.address_country || 'GH'
const taxEngineCode = getTaxEngineCode(jurisdiction)

if (apply_taxes) {
  taxCalculationResult = calculateTaxes(
    lineItems,
    business?.address_country,  // ✅ Reads from business
    effectiveDate,
    true
  )
}
```

**Tax Engine Resolution:** `lib/taxEngine/index.ts` (Lines 34-46)

**Code:**
```typescript
function normalizeJurisdiction(country: string | null | undefined): string {
  if (!country) return DEFAULT_JURISDICTION  // ⚠️ Falls back to 'GH'
  
  const normalized = country.toUpperCase().trim()
  const countryMap: Record<string, string> = {
    'GHANA': 'GH',
    'GHA': 'GH',
  }
  
  return countryMap[normalized] || normalized.slice(0, 2) || DEFAULT_JURISDICTION  // ⚠️ Falls back to 'GH'
}
```

**Issues Found:**
1. ✅ **Correct:** Invoice creation reads `business.address_country`
2. ⚠️ **Silent fallback:** If country is missing/null, defaults to `'GH'` (Ghana)
3. ⚠️ **No validation:** No error if country is invalid
4. ⚠️ **Fallback in tax engine:** `normalizeJurisdiction()` defaults to `DEFAULT_JURISDICTION = 'GH'` (Line 29)

**Impact:**
- ⚠️ Kenya business with missing/null country → Gets Ghana tax engine (WRONG)
- ⚠️ Non-Ghana businesses may silently get Ghana taxes if country field is empty

**Test Cases:**
- ✅ Ghana business → Ghana tax engine (WORKS)
- ⚠️ Kenya business with `address_country = "Kenya"` → Should use fallback/default (currently gets Ghana engine if no Kenya engine exists)
- ❌ Kenya business with `address_country = null` → Gets Ghana tax engine (FAILS)

---

## 3️⃣ Currency Handling (CRITICAL ISSUES)

### ❌ **HARD-CODED CURRENCY IN MULTIPLE PLACES**

#### **A. Invoice Creation API (CRITICAL)**

**Location:** `app/api/invoices/create/route.ts` (Lines 32-33)

**Code:**
```typescript
currency_code = "GHS",
currency_symbol = "₵",
```

**Issue:** ❌ **Hard-coded defaults** - Does NOT read from business `default_currency`

**Impact:** 
- Kenya business creating invoice → Gets "GHS" and "₵" (WRONG)
- Invoice currency is hard-coded, not derived from business settings

**Expected Behavior:**
- Should read `business.default_currency` 
- Should map currency code to symbol (e.g., USD → $, KES → KSh)
- Only fallback to GHS if business currency is missing

---

#### **B. Invoice Preview API**

**Location:** `app/api/invoices/preview/route.ts` (Lines 20-21)

**Code:**
```typescript
currency_symbol = "₵",
currency_code = "GHS",
```

**Issue:** ❌ **Hard-coded defaults** in preview endpoint

---

#### **C. Receipt Page (CRITICAL)**

**Location:** `app/sales/[id]/receipt/page.tsx`

**Hard-coded "GHS" in 20+ places:**
- Line 471: `GHS ${p.amount.toFixed(2)}`
- Line 749: `GHS {item.price.toFixed(2)}`
- Line 787: `GHS {grandTotal.toFixed(2)}`
- Line 823-848: `GHS {(sale.getfund || 0).toFixed(2)}` (tax breakdown)
- Line 863: `GHS {Number(payment.amount.toFixed(2))}`
- Line 869: `GHS {(sale.amount || grandTotal).toFixed(2)}`
- ... and many more

**Issue:** ❌ **Receipt page shows "GHS" hard-coded** - Does NOT use sale/business currency

**Impact:**
- Kenya business sale receipt → Shows "GHS" everywhere (WRONG)
- Receipts always show Cedi, regardless of business currency

---

#### **D. POS Page**

**Location:** `app/(dashboard)/pos/page.tsx`

**Hard-coded "GHS":**
- Lines 1320, 1490: `GHS {Number(product.price.toFixed(2))}`
- Line 1606: `GHS {Number(cartTotals.subtotal.toFixed(2))}`
- Line 1612: `GHS {Number(cartTotals.total.toFixed(2))}`
- Line 2122: `GHS {Number(item.product.price.toFixed(2))} each`
- Line 2167: `GHS {Number(lineTotal.toFixed(2))}`

**Issue:** ❌ **POS displays "GHS" hard-coded**

---

#### **E. Business Profile (CORRECT)**

**Location:** `app/settings/business-profile/page.tsx` (Lines 469-477)

**Implementation:**
- ✅ **Currency IS selectable** - Dropdown with GHS, USD, EUR options
- ✅ Currency is stored in `business.default_currency`
- ⚠️ **Default is "GHS"** (Line 36, 82)
- ⚠️ **Limited options** - Only GHS, USD, EUR (no KES for Kenya)

**Correct Pattern:**
```typescript
<select value={formData.default_currency} onChange={...}>
  <option value="GHS">GHS - Ghana Cedi (₵)</option>
  <option value="USD">USD - US Dollar ($)</option>
  <option value="EUR">EUR - Euro (€)</option>
</select>
```

**Issue:** Currency selection exists, but:
- Default is "GHS"
- Limited options (no KES, NGN, etc.)
- Selected currency is NOT used in invoice creation (see above)

---

#### **F. Database Defaults**

**Location:** `supabase/migrations/037_business_profile_invoice_settings.sql` (Line 20)

**Code:**
```sql
ADD COLUMN IF NOT EXISTS default_currency TEXT DEFAULT 'GHS';
```

**Location:** `supabase/migrations/035_enhance_invoice_system_ghana.sql` (Lines 22-23)

**Code:**
```sql
ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'GHS',
ADD COLUMN IF NOT EXISTS currency_symbol TEXT DEFAULT '₵',
```

**Issue:** ❌ **Database defaults to Ghana currency**

---

#### **G. Currency Symbol Mapping**

**Search Result:** ❌ **NO currency symbol mapping found**

**Issue:** 
- No function to map currency code → symbol (e.g., USD → $, KES → KSh, EUR → €)
- Currency symbols are hard-coded to "₵" (Cedi)

**Expected:** Currency symbol should be derived from currency code

---

## 4️⃣ Invoice & Receipt Rendering

### ❌ **HARD-CODED CURRENCY IN DISPLAY**

**Invoice View:**
- ✅ **Correct:** `app/invoices/[id]/view/page.tsx` uses `invoice.currency_symbol` and `invoice.currency_code`
- ⚠️ **Issue:** Invoice currency is hard-coded at creation time (see Section 3A)

**Receipt View:**
- ❌ **CRITICAL:** `app/sales/[id]/receipt/page.tsx` shows "GHS" hard-coded everywhere
- Receipt does NOT read from sale/business currency

**POS Page:**
- ❌ **CRITICAL:** `app/(dashboard)/pos/page.tsx` shows "GHS" hard-coded
- POS does NOT read from business currency

**Public Invoice:**
- ✅ **Correct:** `app/invoice-public/[token]/page.tsx` uses `invoice.currency_symbol` and `invoice.currency_code`

---

## 📋 Summary Table

| Component | Country Selection | Currency Selection | Currency Display | Status |
|-----------|------------------|-------------------|------------------|--------|
| Business Profile | ✅ Text input (editable) | ✅ Dropdown (GHS/USD/EUR) | N/A | ⚠️ Defaults to Ghana |
| Invoice Creation API | ✅ Reads business country | ❌ **Hard-coded GHS/₵** | N/A | ❌ **CRITICAL** |
| Invoice View | N/A | ✅ Uses invoice currency | ✅ Uses invoice currency | ✅ Correct |
| Receipt Page | N/A | ❌ **Hard-coded GHS** | ❌ **Hard-coded GHS** | ❌ **CRITICAL** |
| POS Page | N/A | ❌ **Hard-coded GHS** | ❌ **Hard-coded GHS** | ❌ **CRITICAL** |
| Tax Engine | ⚠️ Falls back to GH | N/A | N/A | ⚠️ Silent fallback |
| Database Defaults | ❌ Default 'Ghana' | ❌ Default 'GHS' | N/A | ❌ Hard-coded |

---

## 🎯 Critical Issues Found

### ❌ **Issue #1: Invoice Creation Hard-codes Currency**

**Location:** `app/api/invoices/create/route.ts` (Lines 32-33)

**Impact:** Kenya business creates invoice → Gets "GHS" and "₵" instead of business currency

**Fix Required:**
- Read `business.default_currency` 
- Map currency code to symbol
- Only fallback to GHS if business currency is missing

---

### ❌ **Issue #2: Receipt Page Hard-codes "GHS"**

**Location:** `app/sales/[id]/receipt/page.tsx` (20+ occurrences)

**Impact:** Kenya business sale receipt → Shows "GHS" everywhere

**Fix Required:**
- Read currency from sale or business
- Replace all "GHS" with dynamic currency
- Use currency symbol for display

---

### ❌ **Issue #3: POS Page Hard-codes "GHS"**

**Location:** `app/(dashboard)/pos/page.tsx` (Multiple occurrences)

**Impact:** Kenya business POS → Shows "GHS" in all prices

**Fix Required:**
- Read currency from business settings
- Replace all "GHS" with dynamic currency
- Use currency symbol for display

---

### ⚠️ **Issue #4: Tax Engine Silent Fallback**

**Location:** `lib/taxEngine/index.ts` (Line 35)

**Impact:** Kenya business with missing country → Gets Ghana tax engine

**Fix Required:**
- Warn/error if country is missing for tax calculation
- Do not silently fallback to Ghana
- Or: Make country required for invoice creation

---

### ⚠️ **Issue #5: Country Field is Free-text**

**Location:** `app/settings/business-profile/page.tsx` (Line 382-388)

**Impact:** Users can type anything, leading to inconsistent country values

**Fix Required (Future):**
- Make country a dropdown/select
- Validate country input
- Map country names to codes

---

### ⚠️ **Issue #6: Database Defaults to Ghana**

**Location:** Multiple migrations

**Impact:** New businesses default to Ghana if fields are not set

**Fix Required:**
- Remove defaults or make them NULL
- Require explicit country/currency selection

---

### ❌ **Issue #7: No Currency Symbol Mapping**

**Impact:** Cannot display correct symbol for USD ($), EUR (€), KES (KSh), etc.

**Fix Required:**
- Create currency code → symbol mapping function
- Use mapping when displaying currency

---

## 🔧 Minimal Fixes Required (Priority Order)

### **Priority 1 (Launch-Blocking):**

1. **Invoice Creation API** - Read currency from business settings
2. **Receipt Page** - Use dynamic currency (not hard-coded "GHS")
3. **POS Page** - Use dynamic currency (not hard-coded "GHS")

### **Priority 2 (User Trust):**

4. **Currency Symbol Mapping** - Map currency codes to symbols
5. **Tax Engine Fallback** - Warn/error instead of silent fallback to Ghana

### **Priority 3 (UX Improvement):**

6. **Country Dropdown** - Make country selectable (not free-text)
7. **Currency Options** - Add more currencies (KES, NGN, etc.)
8. **Remove Database Defaults** - Make country/currency required, not defaulted

---

## ✅ What is Correct

1. ✅ Business profile has currency dropdown (GHS/USD/EUR)
2. ✅ Invoice view uses stored invoice currency
3. ✅ Public invoice uses stored invoice currency
4. ✅ Invoice creation reads business country for tax engine
5. ✅ Tax engine selects based on country (when country is provided)

---

## 🎯 Conclusion

**Critical Finding:** Currency is **hard-coded to Ghana (GHS/₵)** in multiple places, making the system feel "Ghana-only" and breaking for non-Ghana businesses.

**Impact:**
- ❌ Kenya business will see "GHS" and "₵" everywhere
- ❌ User trust will be lost immediately
- ❌ This is a **launch-blocking bug** for multi-country expansion

**Recommendation:**
Fix Priority 1 issues (Invoice Creation, Receipt Page, POS Page) before multi-country launch. These are the most visible and user-facing currency displays.




