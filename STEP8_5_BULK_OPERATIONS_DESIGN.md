# Step 8.5 - Bulk Operations Design Decisions

**Date:** 2025-01-XX  
**Status:** Design Review - Awaiting Green Light  
**Scope:** Bulk operations for accounting firm multi-client management

---

## Executive Summary

This document defines the explicit design decisions for bulk operations in Step 8.5, specifically addressing:

1. **Per-client confirmation model** - How confirmations work for bulk operations
2. **Permission escalation rules** - Partner vs Senior role permissions
3. **Failure semantics** - Partial success vs atomic batch behavior

---

## 1. Per-Client Confirmation Model

### Decision: **Two-Phase Confirmation Model**

**Phase 1: Bulk Selection & Preflight Validation**
- User selects multiple clients from dashboard
- Bulk preflight validation runs (read-only)
- Results show which clients are ready/not ready
- **No confirmation required** - this is read-only validation

**Phase 2: Per-Client Explicit Confirmation (Write Operations Only)**
- For **write operations** (AFS finalization, exception review, etc.):
  - UI displays confirmation modal/dialog **per client**
  - User must explicitly confirm **each client** individually
  - Confirmation includes:
    - Client business name
    - Operation being performed (e.g., "Finalize AFS Run")
    - Summary of what will change
    - Warning about irreversibility (if applicable)
  - API accepts `confirmations: { business_id: boolean }[]` in request body
  - **All clients must be confirmed** or operation fails (no partial execution)

**Rationale:**
- Prevents accidental bulk finalization
- Ensures user is aware of each client being affected
- Aligns with "Explicit per-client confirmation required for finalize" requirement
- Read-only operations (preflight validation) don't need confirmation

### API Contract: Bulk Write Operations

```typescript
// Request body for bulk write operations
{
  business_ids: UUID[],
  confirmations: {
    business_id: UUID,
    confirmed: boolean
  }[],
  operation: 'afs_finalize' | 'exception_review' | ...
}

// Validation:
// - confirmations.length === business_ids.length
// - All confirmations[].confirmed === true
// - All confirmations[].business_id must be in business_ids
```

---

## 2. Permission Escalation Rules (Partner vs Senior)

### Decision: **Role-Based Access with Escalation**

**Firm Roles** (from `accounting_firm_users`):
- `partner` - Full authority
- `senior` - Elevated authority (can approve)
- `junior` - Standard authority (can write)
- `readonly` - Read-only access

**Client Access Levels** (from `accounting_firm_clients`):
- `read` - Read-only access
- `write` - Write access (can create/modify)
- `approve` - Approval authority (can finalize/approve)

### Permission Matrix:

| Operation Type | Partner | Senior | Junior | Readonly |
|---------------|---------|--------|--------|----------|
| **Read-only bulk operations** (preflight validation, viewing) | ✅ | ✅ | ✅ | ✅ |
| **Bulk AFS draft generation** | ✅ | ✅ | ✅ | ❌ |
| **Bulk exception review** (acknowledge/mark reviewed) | ✅ | ✅ | ✅ | ❌ |
| **Bulk AFS finalization** | ✅ | ✅ (if client access = 'write' or 'approve') | ❌ | ❌ |
| **Bulk approval operations** (adjustments, etc.) | ✅ | ✅ (if client access = 'approve') | ❌ | ❌ |

### Escalation Rules:

1. **Partner Role:**
   - Can perform **all bulk operations** regardless of client access level
   - Bypasses client access level checks (full authority)
   - Can finalize/approve for any client in the firm

2. **Senior Role:**
   - Can perform bulk operations **subject to client access level**
   - For AFS finalization: Requires client access level = `write` OR `approve`
   - For approval operations: Requires client access level = `approve`
   - Cannot bypass access level restrictions

3. **Junior Role:**
   - Can perform bulk read-only operations
   - Can perform bulk draft generation (non-finalizing)
   - **Cannot perform bulk finalization or approval operations**
   - Must use single-client operations for write actions

4. **Readonly Role:**
   - **Only read-only bulk operations**
   - Cannot perform any write operations (bulk or single-client)

### API Contract: Permission Checks

```typescript
// For bulk write operations, check:
1. User's firm role (from accounting_firm_users)
2. Client access level (from accounting_firm_clients)
3. Operation type (finalization, approval, etc.)

// Validation logic:
if (userRole === 'partner') {
  // Allow - partner has full authority
} else if (userRole === 'senior') {
  // Check client access level
  if (operation === 'afs_finalize' && clientAccess !== 'write' && clientAccess !== 'approve') {
    REJECT
  }
  if (operation === 'approve' && clientAccess !== 'approve') {
    REJECT
  }
} else if (userRole === 'junior' || userRole === 'readonly') {
  // Reject bulk write operations
  REJECT
}
```

---

## 3. Failure Semantics (Partial Success vs Atomic Batch)

### Decision: **Hybrid Model - Per-Operation Type**

#### Read-Only Operations (Preflight Validation):
- **Partial Success Model**
- Returns results for all accessible businesses
- Filters out inaccessible businesses (no error, just excluded)
- Continues processing even if one business validation fails
- Returns `results[]` array with per-client status

#### Write Operations (AFS Finalization, Exception Review):
- **Atomic Batch Model with Per-Client Validation**
- All clients must pass preflight validation before any execution
- All clients must be confirmed before execution
- If any client fails validation or is not confirmed, **entire batch fails** (no partial execution)
- Transaction-like behavior: **All or nothing**
- Returns success/failure for entire batch

**Rationale:**
- Write operations are irreversible (e.g., AFS finalization)
- Prevents inconsistent state (some clients finalized, others not)
- Ensures audit trail integrity (all-or-nothing batch operations)
- Aligns with accounting best practices (no partial batch finalizations)

### API Contract: Response Format

```typescript
// Read-only operations (preflight validation)
{
  operation: 'afs_draft' | 'afs_finalize',
  total: number,
  ready: number,
  not_ready: number,
  results: Array<{
    business_id: UUID,
    access_level: 'read' | 'write' | 'approve',
    ready: boolean,
    issues: string[],
    warnings: string[],
    // ... other fields
  }>
}

// Write operations (AFS finalization)
{
  success: boolean,
  operation: 'afs_finalize',
  total_requested: number,
  total_confirmed: number,
  total_executed: number,
  errors: Array<{
    business_id: UUID,
    error: string
  }>,
  results: Array<{
    business_id: UUID,
    afs_run_id: UUID,
    status: 'finalized',
    finalized_at: string
  }>
}

// If any validation fails or not all confirmed:
{
  success: false,
  error: 'Batch validation failed: Not all clients confirmed or validated',
  validation_errors: Array<{
    business_id: UUID,
    error: string
  }>
}
```

---

## 4. Current Implementation Status

### ✅ Implemented:
- **Bulk Preflight Validation API** (`/api/accounting/firm/bulk/preflight`)
  - Read-only operation
  - Returns per-client validation results
  - Partial success model (filters inaccessible businesses)
  - No confirmation required
  - No role-based restrictions (yet)

### ⚠️ Needs Implementation:
- **Permission escalation checks** (partner/senior/junior/readonly)
- **Per-client confirmation model** (for write operations)
- **Bulk AFS finalization endpoint** (with atomic batch semantics)
- **UI for bulk operations** (with confirmation dialogs)

---

## 5. Open Questions / Decisions Needed

1. **✅ Per-client confirmation model** - DECIDED: Two-phase model with explicit per-client confirmation for write operations

2. **✅ Permission escalation rules** - DECIDED: Partner (full authority), Senior (subject to access level), Junior/Readonly (read-only bulk operations)

3. **✅ Failure semantics** - DECIDED: Partial success for read-only, atomic batch for write operations

---

## 6. Next Steps (After Green Light)

1. Add permission escalation checks to bulk preflight API
2. Create bulk AFS finalization endpoint with:
   - Per-client confirmation validation
   - Atomic batch semantics
   - Permission escalation checks
3. Create bulk operations UI page with confirmation dialogs
4. Add bulk operations links to firm dashboard
