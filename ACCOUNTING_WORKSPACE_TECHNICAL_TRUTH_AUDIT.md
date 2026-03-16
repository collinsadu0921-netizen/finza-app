# Accounting Workspace - Technical Truth Audit
**Date:** 2025-01-27  
**Audit Type:** Complete File-Based Verification (No Chat History References)  
**Scope:** Migrations 141+ onwards, API Logic, Service Boundaries, Infrastructure

---

## 1. SCHEMA CHECK: Migrations 141+ Onwards

### Migration 141: `141_afs_finalization_controls.sql`
**Tables Created:**
- `afs_runs` - AFS (Accounting Financial Statements) runs with finalization controls
- `afs_documents` - Individual financial statements within a run

**Functions Created:**
- `prevent_afs_run_update_when_finalized()` - Trigger function to block updates to finalized AFS runs
- `prevent_afs_document_modification_when_run_finalized()` - Trigger function to prevent document modifications when parent run is finalized
- `update_updated_at_column()` - Generic trigger function to auto-update updated_at column

**What They Do:**
- Creates immutable AFS output system (read-only financial statements)
- Finalization locks runs and documents (no updates after finalized)
- RLS policies enforce business-level access (owner/admin/accountant)

**File Paths:**
- `finza-web/supabase/migrations/141_afs_finalization_controls.sql`

---

### Migration 142: `142_accounting_firms_step8_1.sql`
**Tables Created:**
- `accounting_firms` - Accounting firms that manage multiple clients
- `accounting_firm_users` - Users associated with firms (roles: partner, senior, junior, readonly)
- `accounting_firm_clients` - Client businesses linked to firms (access levels: read, write, approve)

**Functions Created:**
- `update_accounting_firm_updated_at()` - Trigger function to auto-update updated_at on firm tables

**What They Do:**
- Enables multi-client firm infrastructure
- Firm-user relationships with role hierarchy
- Firm-client access control with access level hierarchy

**File Paths:**
- `finza-web/supabase/migrations/142_accounting_firms_step8_1.sql`

---

### Migration 143: `143_coa_mapping_schemes_step8_4.sql`
**Tables Created:**
- `coa_mapping_schemes` - COA mapping schemes (templates or client-specific)

**Functions Created:**
- `update_coa_mapping_schemes_updated_at()` - Trigger function to auto-update updated_at

**What They Do:**
- Supports firm-level templates for COA mappings
- Scheme types: coa_statutory_mapping, exception_thresholds, afs_notes_structure
- Either firm_id (templates) OR business_id (client schemes) - mutually exclusive

**CONSTRAINT CHECK - btree_gist Exclusion:**
❌ **NOT FOUND** - The `coa_mapping_schemes` table does NOT have a btree_gist exclusion constraint. Only has:
- CHECK constraint: `(firm_id IS NOT NULL AND business_id IS NULL) OR (firm_id IS NULL AND business_id IS NOT NULL)`
- Indexes (btree, not exclusion)

**File Paths:**
- `finza-web/supabase/migrations/143_coa_mapping_schemes_step8_4.sql`

---

### Migration 144: `144_accounting_firm_activity_logs_step8_6.sql`
**Tables Created:**
- `accounting_firm_activity_logs` - Immutable audit trail for firm-level actions

**Functions Created:**
- `prevent_activity_log_modification()` - Trigger function to prevent UPDATE/DELETE (append-only enforcement)

**What They Do:**
- Append-only audit trail for firm actions
- Action types: bulk_preflight, bulk_afs_finalize, single_afs_finalize, bulk_exception_review, client_access_granted, client_access_revoked, template_created, template_copied
- Hard constraint: No UPDATE/DELETE allowed (trigger + RLS policy)

**File Paths:**
- `finza-web/supabase/migrations/144_accounting_firm_activity_logs_step8_6.sql`

---

### Migration 145: `145_firm_onboarding_status_step8_8.sql`
**Tables Created:**
- None (ALTER TABLE only)

**Functions Created:**
- None

**What They Do:**
- Adds columns to `accounting_firms`:
  - `onboarding_status` (pending/in_progress/completed)
  - `onboarding_completed_at`
  - `onboarding_completed_by`
  - `legal_name`, `jurisdiction`, `reporting_standard`, `default_accounting_standard`

**File Paths:**
- `finza-web/supabase/migrations/145_firm_onboarding_status_step8_8.sql`

---

### Migration 146: `146_firm_client_engagements_step8_8_batch2.sql`
**Tables Created:**
- `firm_client_engagements` - Explicit, time-bound firm-client engagements

**Functions Created:**
- `update_firm_client_engagements_updated_at()` - Trigger function
- `get_active_engagement(firm_id, business_id, check_date)` - Returns active engagement for firm-client pair
- `check_engagement_access(firm_id, business_id, required_access, check_date)` - Checks if firm has required access level

**What They Do:**
- Engagement lifecycle: pending → active → suspended/terminated
- One active engagement per firm-client pair (unique partial index)
- Access level hierarchy: read < write < approve
- Effective date tracking (from/to)

**File Paths:**
- `finza-web/supabase/migrations/146_firm_client_engagements_step8_8_batch2.sql`

---

## 2. LOGIC CHECK: Adjusting Journal Workflow

### Current Status: **DIRECT APPLY ONLY** (No Review → Approve → Post Workflow)

**Database Function:**
- `apply_adjusting_journal()` - Canonical function in migration 137 (Phase 2E)
- **Direct posting** - Creates journal entry immediately
- No pending/review/approval states

**API Endpoints:**
- `POST /api/accounting/adjustments/apply` - Calls `apply_adjusting_journal` RPC directly
- `GET /api/accounting/adjustments` - Lists already-posted adjustments

**UI Pages:**
- `/accounting/adjustments/page.tsx` - Create and apply adjustments (direct posting)
- `/accounting/adjustments/review/page.tsx` - **Review-only page** (shows already-posted adjustments)

**Review Page Note:**
From `app/accounting/adjustments/review/page.tsx` line 136-139:
> "Note: Current system applies adjustments immediately. A pending_review workflow would require additional implementation. All adjustments shown here are already posted."

**Conclusion:**
❌ **Review → Approve → Post workflow is NOT implemented**
- Adjustments are applied directly via `apply_adjusting_journal`
- Review page only displays already-posted adjustments
- No pending/review/approval states in database
- No approval workflow in API or UI

**File Paths:**
- `finza-web/app/api/accounting/adjustments/apply/route.ts`
- `finza-web/app/api/accounting/adjustments/route.ts`
- `finza-web/app/accounting/adjustments/page.tsx`
- `finza-web/app/accounting/adjustments/review/page.tsx`
- `finza-web/supabase/migrations/137_adjusting_journals_phase2e.sql` (contains `apply_adjusting_journal` function)

---

## 3. MAPPING CHECK: coa_mapping_schemes Constraint

**Table:** `coa_mapping_schemes` (Migration 143)

**Constraint Status:**
❌ **btree_gist exclusion constraint NOT FOUND**

**Actual Constraints:**
- CHECK constraint: `(firm_id IS NOT NULL AND business_id IS NULL) OR (firm_id IS NULL AND business_id IS NOT NULL)`
- UNIQUE indexes (btree) on various columns
- **NO exclusion constraint using btree_gist extension**

**File Paths:**
- `finza-web/supabase/migrations/143_coa_mapping_schemes_step8_4.sql`

---

## 4. SERVICE BOUNDARY: Cross-Workspace Calls

**Search Scope:** `/api/invoices/*`, `/api/sales/*`, and other service/POS endpoints

**Findings:**
✅ **CLEAN BOUNDARIES** - No accounting-specific function calls found

**Invoice API (`/api/invoices/create/route.ts`):**
- Uses tax engine (`lib/taxEngine/`)
- Uses audit log (`lib/auditLog`)
- **NO calls to:**
  - `apply_adjusting_journal`
  - `post_journal_entry`
  - Any accounting workspace-specific functions

**Sales API (`/api/sales/create/route.ts`):**
- Handles stock movements
- Payment processing
- **NO calls to accounting workspace functions**

**Other Service Routes Checked:**
- No violations found in service/retail workspace calling accounting functions

**Conclusion:**
✅ **Service boundaries are clean** - No accounting workspace function calls from service/POS code

**File Paths Verified:**
- `finza-web/app/api/invoices/create/route.ts`
- `finza-web/app/api/sales/create/route.ts`
- (No violations found in other service routes)

---

## 5. MULTI-CLIENT INFRASTRUCTURE: Firm Schema Status

**Tables Present:**
✅ **YES** - Full firm infrastructure exists:

1. **`accounting_firms`** (Migration 142)
   - Firm entity with onboarding status (Migration 145)
   
2. **`accounting_firm_users`** (Migration 142)
   - Firm-user relationships
   - Roles: partner, senior, junior, readonly

3. **`accounting_firm_clients`** (Migration 142)
   - Firm-client access mappings
   - Access levels: read, write, approve

4. **`firm_client_engagements`** (Migration 146)
   - Explicit, time-bound engagements
   - Status lifecycle and effective dates

5. **`accounting_firm_activity_logs`** (Migration 144)
   - Firm-level audit trail

6. **`coa_mapping_schemes`** (Migration 143)
   - Firm-level templates support

**Functions Present:**
- `get_active_engagement()` - Get active engagement for firm-client pair
- `check_engagement_access()` - Check engagement access level

**File Paths:**
- `finza-web/supabase/migrations/142_accounting_firms_step8_1.sql`
- `finza-web/supabase/migrations/143_coa_mapping_schemes_step8_4.sql`
- `finza-web/supabase/migrations/144_accounting_firm_activity_logs_step8_6.sql`
- `finza-web/supabase/migrations/145_firm_onboarding_status_step8_8.sql`
- `finza-web/supabase/migrations/146_firm_client_engagements_step8_8_batch2.sql`

---

## 6. COMPLETE FILE PATH INVENTORY

### Schema Files (Migrations 141+)
- `finza-web/supabase/migrations/141_afs_finalization_controls.sql`
- `finza-web/supabase/migrations/142_accounting_firms_step8_1.sql`
- `finza-web/supabase/migrations/143_coa_mapping_schemes_step8_4.sql`
- `finza-web/supabase/migrations/144_accounting_firm_activity_logs_step8_6.sql`
- `finza-web/supabase/migrations/145_firm_onboarding_status_step8_8.sql`
- `finza-web/supabase/migrations/146_firm_client_engagements_step8_8_batch2.sql`

### Adjusting Journal API
- `finza-web/app/api/accounting/adjustments/apply/route.ts`
- `finza-web/app/api/accounting/adjustments/route.ts`

### Adjusting Journal UI
- `finza-web/app/accounting/adjustments/page.tsx`
- `finza-web/app/accounting/adjustments/review/page.tsx`

### Adjusting Journal Database Function
- `finza-web/supabase/migrations/137_adjusting_journals_phase2e.sql` (contains `apply_adjusting_journal`)

### Firm Infrastructure Libraries
- `finza-web/lib/firmOnboarding.ts`
- `finza-web/lib/firmEngagements.ts`
- `finza-web/lib/firmSession.ts`
- `finza-web/lib/firmClientAccess.ts`
- `finza-web/lib/firmClientSession.ts`
- `finza-web/lib/firmActivityLog.ts`

### Firm API Endpoints
- `finza-web/app/api/accounting/firm/firms/route.ts`
- `finza-web/app/api/accounting/firm/clients/route.ts`
- `finza-web/app/api/accounting/firm/clients/add/route.ts`
- `finza-web/app/api/accounting/firm/engagements/route.ts`
- `finza-web/app/api/accounting/firm/engagements/[id]/route.ts`
- `finza-web/app/api/accounting/firm/onboarding/complete/route.ts`
- `finza-web/app/api/accounting/firm/activity/route.ts`
- `finza-web/app/api/accounting/firm/metrics/route.ts`
- `finza-web/app/api/accounting/firm/bulk/afs/finalize/route.ts`
- `finza-web/app/api/accounting/firm/bulk/preflight/route.ts`

### AFS API Endpoints
- `finza-web/app/api/accounting/afs/runs/route.ts`
- `finza-web/app/api/accounting/afs/runs/[id]/route.ts`
- `finza-web/app/api/accounting/afs/runs/[id]/export/csv/route.ts`
- `finza-web/app/api/accounting/afs/runs/[id]/export/json/route.ts`
- `finza-web/app/api/accounting/afs/runs/[id]/export/pdf/route.ts`
- `finza-web/app/api/accounting/afs/documents/[run_id]/route.ts`
- `finza-web/app/api/accounting/afs/[run_id]/finalize/route.ts`

### Service Boundary Verification Files
- `finza-web/app/api/invoices/create/route.ts`
- `finza-web/app/api/sales/create/route.ts`

---

## SUMMARY

### ✅ CONFIRMED IMPLEMENTATIONS

1. **AFS Finalization System** (Migration 141)
   - Tables: `afs_runs`, `afs_documents`
   - Immutability triggers
   - Finalization controls

2. **Accounting Firms Infrastructure** (Migrations 142, 145, 146)
   - Full multi-client firm schema
   - Firm-user relationships
   - Client engagements with lifecycle
   - Onboarding status tracking

3. **Firm Activity Logging** (Migration 144)
   - Append-only audit trail
   - Firm-level action tracking

4. **COA Mapping Schemes** (Migration 143)
   - Firm-level templates
   - Client-specific schemes

5. **Service Boundaries**
   - Clean separation: No accounting function calls from service/POS code

6. **Adjusting Journal Direct Apply**
   - `apply_adjusting_journal` function works
   - Direct posting (no approval workflow)

### ❌ MISSING/NOT IMPLEMENTED

1. **Review → Approve → Post Workflow**
   - NOT implemented for adjusting journals
   - Current: Direct apply only
   - Review page shows already-posted adjustments

2. **btree_gist Exclusion Constraint**
   - NOT present on `coa_mapping_schemes`
   - Only CHECK constraint exists (mutually exclusive firm_id/business_id)

---

## AUDIT METHODOLOGY

- ✅ Examined actual migration files (141-146)
- ✅ Verified API route implementations
- ✅ Checked UI pages for workflow states
- ✅ Searched for service boundary violations
- ✅ Verified database schema against codebase
- ✅ No chat history references (pure file-based audit)
