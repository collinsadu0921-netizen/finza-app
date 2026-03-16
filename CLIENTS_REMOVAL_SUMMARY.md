# CLIENTS REMOVAL - EXECUTION SUMMARY

**Date:** 2026-01-24  
**Objective:** Remove all `clients` references from Service workspace

---

## PHASE 1: INVENTORY ✅

**Findings:**
- `/clients` routes exist: `app/clients/page.tsx`, `app/clients/new/page.tsx`, `app/clients/[id]/edit/page.tsx`
- Sidebar has "Clients" entry in Service workspace
- Dashboard has "Clients & Contacts" section
- Onboarding references `/clients/new`
- Invoice/Estimate creation pages have "Client" UI labels
- Route guards block `/clients` for cashiers
- **Database:** `clients` table exists but invoices use `customer_id` (not `client_id`)
- **Accounting workspace:** `/accounting/firm/clients` is DIFFERENT (accountant firm clients) - KEEP

---

## PHASE 2: DELETED FILES ✅

1. `app/clients/page.tsx` - Deleted
2. `app/clients/new/page.tsx` - Deleted  
3. `app/clients/[id]/edit/page.tsx` - Deleted

---

## PHASE 3: UI UPDATES (IN PROGRESS)

### Completed:
- ✅ Sidebar: Removed "Clients" entry, kept "Customers"
- ✅ Route guards: Removed `/clients` from blocked routes
- ✅ Dashboard: Changed "Clients & Contacts" → "Customers"
- ✅ Dashboard: Changed "Add Client" → "Add Customer", route `/clients/new` → `/customers/new`
- ✅ Onboarding: Changed route `/clients/new` → `/customers/new` (2 occurrences)

### Remaining:
- ⚠️ Invoice creation page (`app/invoices/new/page.tsx`): 
  - Variable names: `clients` → `customers`, `selectedClientId` → `selectedCustomerId`, etc.
  - UI labels: "Client" → "Customer", "Add New Client" → "Add New Customer"
  - Function names: `handleCreateClient` → `handleCreateCustomer`
  - State variables: `showClientModal`, `newClientName`, `clientError`, etc.
  
- ⚠️ Estimate pages (`app/estimates/new/page.tsx`, `app/estimates/[id]/edit/page.tsx`):
  - Similar changes needed

---

## PHASE 4: VERIFICATION (PENDING)

- [ ] No `/clients` routes remain
- [ ] All navigation points to `/customers`
- [ ] Invoice creation uses customer selector
- [ ] Estimate creation uses customer selector
- [ ] Customer 360 accessible
- [ ] No dead links

---

## PHASE 5: FINAL CHECK (PENDING)

- [ ] Global search for "client" (excluding accounting workspace)
- [ ] Confirm only legitimate uses remain (OAuth client_id, etc.)

---

## NOTES

**Accounting Workspace Clients:**
- `/accounting/firm/clients` - KEEP (different concept: accountant firm client engagements)
- `components/ClientSelector.tsx` - KEEP (for accounting workspace)
- `components/ClientContextWarning.tsx` - KEEP (for accounting workspace)

**Database:**
- `clients` table may still exist in DB (not removed - out of scope)
- All operational code uses `customers` table
- Invoices use `customer_id` (confirmed)
