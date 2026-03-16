# Accounting Immutability Assessment

**Date:** 2025-01-27  
**Auditor:** Database Architecture Review  
**Scope:** journal_entries, journal_entry_lines, posting triggers, accounting_periods  
**Purpose:** Identify where immutability is assumed vs. enforced

---

## 1. Mental Model of Core Structures

### journal_entries Table
- Primary ledger header table containing entry metadata
- Contains: business_id, date, description, reference_type, reference_id, created_at
- Purpose: Audit trail header for all accounting transactions
- Created by: Various posting functions (post_invoice_to_ledger, post_payment_to_ledger, etc.)
- Relationship: One-to-many with journal_entry_lines via journal_entry_id foreign key

### journal_entry_lines Table
- Detailed debit/credit lines for each journal entry
- Contains: journal_entry_id, account_id, debit, credit, description, created_at
- Purpose: Individual account postings that must balance (SUM(debit) = SUM(credit))
- Created by: post_journal_entry() function which inserts header and all lines atomically
- Relationship: Many-to-one with journal_entries, many-to-one with accounts

### Posting Triggers
- Automatic posting triggers exist for invoices, payments, bills, expenses, credit notes, sales
- These call functions like post_invoice_to_ledger() which internally call post_journal_entry()
- Period validation occurs at function level (assert_accounting_period_is_open)
- Additional trigger at database level (enforce_period_state_on_entry) blocks INSERT into locked periods
- Double-entry balance validation occurs via trigger after each line insert

### accounting_periods Table
- Controls which periods allow new ledger entries
- Status values: 'open', 'soft_closed', 'locked'
- 'open' and 'soft_closed' allow posting, 'locked' blocks posting
- Periods are defined by month (period_start = first day, period_end = last day)
- Relationship: Journal entries reference periods implicitly via date falling within period range

---

## 2. Tables That Must Be Append-Only for Accounting Immutability

### journal_entries
- **Required:** Append-only (INSERT only)
- **Reason:** Core audit trail header. Once posted, entries represent historical fact that cannot be altered without creating new adjusting entries
- **Current Enforcement:** BEFORE UPDATE OR DELETE trigger raises exception (migration 088)

### journal_entry_lines
- **Required:** Append-only (INSERT only)
- **Reason:** Individual account postings that constitute the double-entry record. Modification would corrupt historical accounting balances
- **Current Enforcement:** BEFORE UPDATE OR DELETE trigger raises exception (migration 088)

### Note on Related Tables
- **accounts:** Can be modified (name, description changes) but should not be deleted if referenced by journal_entry_lines (enforced via ON DELETE RESTRICT)
- **accounting_periods:** Can be modified (status transitions) as periods are control structures, not historical records

---

## 3. SQL Operations Currently Possible (Gaps in Enforcement)

### Direct UPDATE Operations
- **Status:** BLOCKED by trigger on both journal_entries and journal_entry_lines
- **Enforcement:** prevent_journal_entry_modification() and prevent_journal_entry_line_modification() functions raise exceptions on UPDATE attempts
- **Gap:** None identified for direct UPDATE operations

### Direct DELETE Operations
- **Status:** BLOCKED by trigger on both journal_entries and journal_entry_lines
- **Enforcement:** prevent_journal_entry_modification() and prevent_journal_entry_line_modification() functions raise exceptions on DELETE attempts
- **Gap:** None identified for direct DELETE operations

### CASCADE DELETE from Parent Tables
- **Status:** POSSIBLE via business deletion
- **Enforcement Gap:** journal_entries has ON DELETE CASCADE from businesses table
- **Impact:** If a business is deleted, all journal entries for that business are automatically deleted, violating immutability principle
- **Severity:** Critical - accounting records should survive business deletions (businesses should use soft delete pattern)
- **Location:** Defined in migration 043_accounting_core.sql line 32 and migration 052_fix_all_foreign_keys_and_relations.sql lines 455-457

### CASCADE DELETE Within Journal Structure
- **Status:** POSSIBLE but unlikely due to parent trigger
- **Enforcement Gap:** journal_entry_lines has ON DELETE CASCADE from journal_entries
- **Impact:** If somehow a journal entry were deleted (should not be possible due to trigger), all its lines would cascade delete
- **Severity:** Low - protected by journal_entries trigger, but cascade relationship exists
- **Location:** Defined in migration 043_accounting_core.sql line 51 and migration 052_fix_all_foreign_keys_and_relations.sql lines 467-468

### Foreign Key Reference Integrity
- **Status:** NO FOREIGN KEY CONSTRAINTS on reference_id/reference_type columns
- **Enforcement Gap:** reference_id and reference_type are plain UUID and TEXT columns with indexes but no foreign key constraints
- **Impact:** 
  - If an invoice is deleted, journal entries referencing it remain with orphaned reference_id
  - Journal entries cannot be validated against source documents at database level
  - This may be intentional design (preserve journal entry even if source document deleted)
- **Severity:** Medium - no data corruption but audit trail linkage is weak
- **Location:** journal_entries table schema in migration 043_accounting_core.sql lines 35-36

### RLS Policy Gaps
- **Status:** NO UPDATE/DELETE POLICIES defined
- **Enforcement Gap:** RLS policies only define SELECT and INSERT operations for journal_entries and journal_entry_lines
- **Impact:** This is actually correct behavior - absence of UPDATE/DELETE policies means RLS would deny these operations even if application code attempted them
- **Severity:** None - this is proper configuration, not a gap

### Superuser or Bypass Mechanisms
- **Status:** UNKNOWN - triggers can be bypassed by superuser or trigger manipulation
- **Enforcement Gap:** Database triggers can be dropped by superuser, RLS can be disabled, or triggers can be temporarily disabled
- **Impact:** High-privilege database access could bypass immutability constraints
- **Severity:** Medium - requires database-level security controls beyond application constraints

---

## 4. Where Immutability is Assumed Rather Than Enforced

### Application Code Assumptions
- Documentation states "No edit/delete functionality in UI" and "No edit/delete functionality in API" (ACCOUNTING_MODE_PHASE2E_ADJUSTING_JOURNALS_FINALIZATION_REPORT.md)
- Application code appears to assume journal entries are immutable (adjusting journals create new entries, never modify existing)
- No application code found that attempts UPDATE or DELETE on journal tables
- **Risk:** If application code is modified in future, assumptions may not be enforced at application layer

### Schema Design Assumptions
- journal_entries table has no updated_at column (only created_at), implying immutability by design
- reference_id/reference_type columns suggest one-way reference (journal entry can reference source, but source deletion does not cascade)
- **Risk:** Schema design communicates intent but does not enforce it

### Documentation Assumptions
- Migration comments state "append-only" and "Use adjustment journals for corrections"
- Audit reports assume immutability when verifying "Existing journal entries unchanged" in tests
- **Risk:** Documentation communicates policy but does not guarantee enforcement

---

## 5. Accounting Period Relationship to Immutability

### Period Status Enforcement
- **INSERT blocking:** Trigger enforce_period_state_on_entry blocks INSERT into locked periods (migration 088)
- **Function-level checks:** All posting functions call assert_accounting_period_is_open() which blocks locked periods (migration 094)
- **Status values:** 'open' and 'soft_closed' allow posting, only 'locked' blocks posting
- **Gap:** Period enforcement only blocks NEW entries, does not prevent modification of existing entries (but modification is already blocked by immutability triggers)

### Period-State Dependency
- Journal entries are created with a date that falls within an accounting period
- No explicit foreign key relationship between journal_entries and accounting_periods
- Period is resolved dynamically via date range lookup (find_period_for_date function)
- **Implication:** Period locking is enforced at INSERT time only, not validated on UPDATE (but UPDATE is blocked anyway)

---

## Summary of Critical Findings

**Enforced Immutability:**
- UPDATE/DELETE triggers on journal_entries and journal_entry_lines block direct modifications
- Double-entry balance validation ensures entries are balanced before commit
- Period locking prevents new entries in locked periods

**Assumed Immutability:**
- Application code assumes immutability (no UPDATE/DELETE code paths found)
- Schema design implies immutability (no updated_at column)
- Documentation states append-only policy

**Enforcement Gaps:**
- CASCADE DELETE from businesses table can delete all journal entries for a business (critical gap)
- No foreign key constraints on reference_id/reference_type (orphaned references possible)
- Superuser can bypass triggers if database security is compromised (requires operational controls)
- CASCADE DELETE relationship from journal_entries to journal_entry_lines exists (low risk due to parent trigger protection)

---

**Assessment Complete - No Code Written**
