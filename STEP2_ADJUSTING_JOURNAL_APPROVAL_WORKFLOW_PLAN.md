# Step 2: Adjusting Journal Approval Workflow - Implementation Plan

**Date:** 2025-01-27  
**Status:** IN PROGRESS

---

## Overview

Transform the existing direct-posting adjusting journal system into a governed, accountant-grade workflow with draft → review → post stages.

---

## Database Schema

### New Table: `adjusting_journal_drafts`

```sql
CREATE TABLE adjusting_journal_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  reason TEXT NOT NULL, -- Explanation for the adjustment
  lines JSONB NOT NULL, -- Array of {account_id, debit, credit, description}
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'posted', 'rejected')),
  
  -- Audit fields
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_edited_by UUID REFERENCES auth.users(id),
  submitted_at TIMESTAMP WITH TIME ZONE,
  submitted_by UUID REFERENCES auth.users(id),
  
  -- Review fields
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES auth.users(id),
  review_notes TEXT, -- For rejection reason
  journal_entry_id UUID REFERENCES journal_entries(id), -- Set when posted
  
  -- Constraints
  CHECK (status != 'posted' OR journal_entry_id IS NOT NULL)
);
```

**Status States:**
- `draft` - Can be edited
- `pending_review` - Awaiting review, cannot be edited
- `posted` - Approved and posted to ledger, immutable
- `rejected` - Rejected by reviewer, read-only

**Status Transitions:**
- `draft → pending_review` (submit)
- `pending_review → posted` (approve)
- `pending_review → rejected` (reject)
- ❌ No direct `draft → posted`

---

## API Endpoints

### Draft Management
- `POST /api/accounting/adjustments/draft` - Create draft
- `GET /api/accounting/adjustments/draft/[id]` - Get draft
- `PUT /api/accounting/adjustments/draft/[id]` - Edit draft (only if status = 'draft')
- `POST /api/accounting/adjustments/draft/[id]/submit` - Submit for review

### Review Management
- `GET /api/accounting/adjustments/draft/[id]/review` - Get draft for review
- `POST /api/accounting/adjustments/draft/[id]/approve` - Approve and post
- `POST /api/accounting/adjustments/draft/[id]/reject` - Reject with reason

### Listing
- `GET /api/accounting/adjustments/draft` - List drafts (filtered by status)

---

## Access Control

**Draft Creation/Editing:**
- `accountant` (with write access) or `owner`

**Review/Approval:**
- `owner` or `admin` (senior accountant)

**Blocked:**
- Service/POS roles (admin, manager, employee, cashier from Service workspace)
- `accountant_readonly` users

---

## Workflow

1. **Junior Accountant creates draft**
   - Validates: period is open, debit = credit, reason provided
   - Status: `draft`
   - Stored in `adjusting_journal_drafts` table

2. **Junior Accountant submits for review**
   - Status: `draft → pending_review`
   - Cannot edit after submission

3. **Senior/Owner reviews**
   - Views draft with impact preview
   - Can approve or reject

4. **Approval**
   - Calls `apply_adjusting_journal()` RPC
   - Creates `journal_entry` with `reference_type = 'adjustment'`
   - Links `journal_entry_id` to draft
   - Status: `pending_review → posted`

5. **Rejection**
   - Status: `pending_review → rejected`
   - Review notes stored
   - No ledger impact

---

## Migration Strategy

1. Create `adjusting_journal_drafts` table
2. Keep existing `/api/accounting/adjustments/apply` endpoint (deprecate later)
3. Add new draft workflow endpoints
4. Add audit logging to all actions
5. Verify no Service workspace access

---

## Next Steps

1. Create migration file (141_adjusting_journal_drafts.sql)
2. Implement draft creation endpoint
3. Implement draft editing endpoint
4. Implement submit endpoint
5. Implement review/approve endpoint
6. Implement reject endpoint
7. Add audit logging
8. Verify access control
9. Safety verification
