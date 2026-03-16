# Retail v1 Freeze Declaration

**Date:** 2026-01-24  
**Status:** FROZEN (Bugfix-Only)  
**Version:** v1.0

---

## Scope Definition

**Retail v1** is defined as: "a shop can sell correctly, post correctly, and not leak into other workspaces."

### Core Functionality (Frozen)
- ✅ POS sale creation with customer attachment
- ✅ Discount application (line + cart) with validation
- ✅ Tax calculation and posting (canonical tax_lines format)
- ✅ Inventory decrement on sale
- ✅ Ledger posting (atomic sale → ledger)
- ✅ Receipt generation and sending (WhatsApp/email)
- ✅ Workspace isolation (Retail cannot access Accounting routes)

### Explicitly Deferred Features (NOT in v1)
- ❌ Loyalty programs
- ❌ Offline POS mode (Phase 4 - partially implemented but not production-ready)
- ❌ Multi-store management (stores exist but advanced features deferred)
- ❌ Supplier automation (AP automation)
- ❌ Advanced analytics (beyond basic sales history)
- ❌ Customer credit/accounts receivable
- ❌ Layaway/installments (Phase 2 - partially implemented but not production-ready)

---

## Allowed Changes

### ✅ Permitted
1. **Bugfixes:** Fixes for incorrect behavior, crashes, or data corruption
2. **Security patches:** Vulnerabilities that affect Retail functionality
3. **Performance optimizations:** Only if they fix a performance bug (not feature expansion)
4. **Documentation:** Clarifications, corrections, or additions to docs

### ❌ Prohibited
1. **New features:** Any functionality not in the "Core Functionality" list above
2. **UI/UX enhancements:** Unless fixing a bug (e.g., broken button, missing validation)
3. **Refactoring:** Code reorganization that doesn't fix a bug
4. **Database schema changes:** Unless required for a bugfix
5. **API changes:** New endpoints or breaking changes to existing endpoints

---

## Workspace Boundaries

### Retail Workspace Routes
- `/pos` - POS Terminal
- `/retail/dashboard` - Retail Dashboard
- `/sales/*` - Sales management
- `/inventory` - Inventory management
- `/admin/retail/*` - Retail admin pages
- `/customers` - Customer management (Retail context)
- `/products` - Product management
- `/categories` - Category management

### Accounting Workspace Routes (BLOCKED from Retail)
- `/accounting/*` - All accounting routes are accountant-firm-only
- Retail users **cannot** access accounting routes (enforced via `lib/accessControl.ts`)
- Retail sidebar **does not** show accounting links

### Enforcement
- **Access Control:** `lib/accessControl.ts` - `resolveAccess()` blocks non-firm users from `/accounting/*`
- **Sidebar:** `components/Sidebar.tsx` - Retail sidebar excludes accounting links
- **Page Guards:** Accounting pages use `ProtectedLayout` which enforces workspace boundaries

---

## Technical Constraints

### Tax Engine
- **Canonical Format:** All taxes use `tax_lines` JSONB (not legacy `nhil`, `getfund`, `vat` columns)
- **Posting:** `post_sale_to_ledger()` reads `tax_lines` and posts to control accounts
- **Calculation:** `calculateTaxes()` from `lib/taxEngine` is authoritative

### Discounts
- **Validation:** `lib/discounts/validation.ts` - enforces caps and role limits
- **Calculation:** `lib/discounts/calculator.ts` - computes discounts before tax
- **Storage:** Discounts stored in `sale.subtotal_before_discount`, `sale.total_discount`, `sale.subtotal_after_discount`

### Inventory
- **Stock Decrement:** Happens atomically during sale creation
- **Scoping:** Stock is store-scoped (`products_stock.store_id`)
- **Negative Stock:** Policy is enforced (no negative stock allowed)

### Ledger Posting
- **Atomicity:** Sale creation and ledger posting are in the same transaction
- **Function:** `post_sale_to_ledger(p_sale_id)` in `supabase/migrations/094_accounting_periods.sql`
- **Accounts:** Cash (debit), Revenue (credit), Tax Control Accounts (credit)

---

## CI Guards (Recommended)

### Sidebar Check
```bash
# Check that Retail sidebar doesn't contain /accounting/* routes
grep -r "/accounting" finza-web/components/Sidebar.tsx | grep -v "accountant-firm" | grep "retail"
# Should return no matches
```

### Import Check
```bash
# Check that Retail routes don't import accounting-only components
find finza-web/app -path "*/retail/*" -o -path "*/pos/*" -o -path "*/sales/*" | \
  xargs grep -l "from.*accounting" | \
  grep -v ".test."
# Should return no matches (or only test files)
```

### Route Guard Check
```bash
# Verify accessControl.ts has workspace boundary check
grep -A 10 "workspace === \"accounting\"" finza-web/lib/accessControl.ts
# Should show blocking logic for non-firm users
```

---

## Testing Requirements

Before any change to Retail v1 code:

1. **Manual Test:** Create a sale with customer + discount → verify receipt send pre-fills customer info
2. **Access Test:** Retail user cannot access `/accounting/periods` (should redirect)
3. **Posting Test:** Sale posts to ledger with correct tax lines
4. **Inventory Test:** Stock decrements correctly on sale

---

## Change Process

1. **Identify:** Is this a bugfix or feature?
2. **Verify:** Does it fall under "Allowed Changes"?
3. **Test:** Run manual tests above
4. **Document:** Update this file if adding new constraints or clarifying scope

---

## Version History

- **v1.0 (2026-01-24):** Initial freeze after workspace boundary fixes and receipt hydration fix

---

## Notes

- **Offline Mode:** Partially implemented but not production-ready. Do not enable for v1.
- **Layaway:** Partially implemented but not production-ready. Do not enable for v1.
- **Multi-Store:** Basic store selection works, but advanced features (store transfers, etc.) are deferred.
