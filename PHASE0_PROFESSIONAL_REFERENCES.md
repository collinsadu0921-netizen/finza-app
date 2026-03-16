# PHASE 0 — PROFESSIONAL REFERENCES SNAPSHOT

**Date:** 2025-01-23  
**Purpose:** Complete inventory of all `professional` references before removal

---

## FILES REFERENCING `professional`

### Application Code (Runtime Logic)

1. **`components/Sidebar.tsx`** (line 113)
   - Condition: `if (businessIndustry === "service" || businessIndustry === "professional")`
   - **Action:** Remove `|| businessIndustry === "professional"`

2. **`app/dashboard/page.tsx`** (line 179)
   - Redirect: `case "professional": router.push("/clients")`
   - **Action:** Remove entire case block

3. **`app/onboarding/page.tsx`** (lines 130, 154, 188)
   - Line 130: `} else if (business?.industry === "professional") { router.push("/clients") }`
   - Line 154: `} else if (business?.industry === "professional") { router.push("/clients") }`
   - Line 188: `if (industry === "service" || industry === "professional") {`
   - **Action:** Remove all professional branches

4. **`app/sales-history/page.tsx`** (line 169)
   - Condition: `if (business.industry === "service" || business.industry === "professional")`
   - **Action:** Remove `|| business.industry === "professional"`

5. **`app/business-setup/page.tsx`** (line 133)
   - Option: `<option value="professional">Professional Services</option>`
   - **Action:** Remove option

6. **`lib/accessControl.ts`** (line 58)
   - Comment: `// Service workspace: clients, invoices, estimates (default for service/professional industry)`
   - **Action:** Update comment to remove "professional"

7. **`app/api/business/profile/route.ts`** (line 196)
   - Comment: `// service, professional, or other`
   - **Action:** Update comment to remove "professional"

---

### Database Migrations

1. **`supabase/migrations/050_fix_account_id_null.sql`** (lines 102, 131)
   - Line 102: `IF NEW.industry = 'service' THEN` (trigger function)
   - Line 131: `SELECT id FROM businesses WHERE industry = 'service'` (backfill)
   - **Action:** Update to include 'professional' in Phase 1, then remove in Phase 3

2. **`supabase/migrations/060_convert_old_industries.sql`** (lines 3, 21)
   - Line 3: Comment mentions 'professional'
   - Line 21: `WHERE industry NOT IN ('retail', 'service', 'professional', 'logistics', 'rider')`
   - **Action:** Remove 'professional' from valid list

3. **`supabase/migrations/037_business_profile_invoice_settings.sql`** (line 2)
   - Comment: `-- Adds business profile fields and invoice settings for professional Ghana invoices`
   - **Action:** Update comment (cosmetic only)

---

### Documentation Files (No Code Changes Needed)

1. `SERVICE_PROFESSIONAL_AUDIT_REPORT.md` - Audit report (keep as historical)
2. `ARCHITECTURE_ANALYSIS.md` - Documentation (update in Phase 5)
3. `PROFESSIONAL_ACCOUNTING_COMBINED_INVESTIGATION.md` - Investigation doc (keep as historical)
4. `ACCOUNTANT_FIRST_MODE_INVESTIGATION.md` - Investigation doc (keep as historical)
5. `BUSINESS_PROFILE_ONBOARDING_ANALYSIS.md` - Analysis doc (keep as historical)
6. `ONBOARDING_ANALYSIS.md` - Analysis doc (keep as historical)
7. `AUDIT_REPORT_ADD_EXTERNAL_CLIENT_BOOKS_ONLY.md` - Audit doc (keep as historical)
8. `SYSTEM_AUDIT_REPORT.md` - Audit doc (keep as historical)
9. `RETAIL_ONBOARDING_IMPLEMENTATION_PLAN.md` - Plan doc (keep as historical)

---

## MIGRATIONS REFERENCING `professional`

1. **`050_fix_account_id_null.sql`** - System account creation (CRITICAL - needs fix)
2. **`060_convert_old_industries.sql`** - Industry validation (needs update)
3. **`037_business_profile_invoice_settings.sql`** - Comment only (cosmetic)

---

## BUSINESS COUNT

**Note:** Cannot query database directly. Migration will include verification query:
```sql
SELECT COUNT(*) FROM businesses WHERE industry = 'professional';
```

Expected: Unknown (will be converted to 0 in Phase 2)

---

## SUMMARY

- **Runtime Logic Files:** 7 files need updates
- **Migration Files:** 3 files (1 critical fix, 1 validation update, 1 comment)
- **Documentation Files:** 9 files (keep as historical reference)

**Total Files Requiring Code Changes:** 10 files

---

**END OF PHASE 0**
