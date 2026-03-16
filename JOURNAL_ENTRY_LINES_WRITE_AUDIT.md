# Forensic Audit: All Writes to journal_entry_lines

## Objective
Identify every single write, mutation, or delete that can affect `journal_entry_lines` during a sale posting.

---

## STEP 1: ALL WRITERS TO journal_entry_lines

### INSERT Statements

#### 1. post_journal_entry() - Active Function
- **File**: `supabase/migrations/184_diagnostic_post_journal_entry_payload.sql` (line 132)
- **File**: `supabase/migrations/179_retail_system_accountant_posting.sql` (line 148)
- **Function**: `post_journal_entry()` (14-parameter version)
- **Condition**: Always executes (unconditional)
- **Context**: Inserts lines from `p_lines` JSONB parameter
- **Code**:
  ```sql
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (
    journal_id,
    account_id,
    COALESCE((line->'debit')::NUMERIC, 0),
    COALESCE((line->'credit')::NUMERIC, 0),
    line->>'description'
  );
  ```

#### 2. post_journal_entry() - Legacy 10-parameter wrapper
- **File**: `supabase/migrations/179_retail_system_accountant_posting.sql` (line 170+)
- **Function**: `post_journal_entry()` (10-parameter version)
- **Condition**: Always executes (calls 14-parameter version)
- **Context**: Wrapper function, delegates to 14-parameter version

#### 3. post_journal_entry() - Migration 171 (Backfill)
- **File**: `supabase/migrations/171_phase12_backfill_legacy_data.sql` (line 156)
- **Function**: `post_journal_entry()` (backfill version)
- **Condition**: Always executes
- **Context**: Backfill legacy data posting

#### 4. post_journal_entry() - Migration 166 (Adjustments)
- **File**: `supabase/migrations/166_controlled_adjustments_soft_closed.sql` (line 242)
- **Function**: `post_journal_entry()` (adjustment version)
- **Condition**: Always executes
- **Context**: Adjustment journal posting

#### 5. post_journal_entry() - Migration 165 (Period Locking)
- **File**: `supabase/migrations/165_period_locking_posting_guards.sql` (line 156)
- **Function**: `post_journal_entry()` (period locking version)
- **Condition**: Always executes
- **Context**: Period locking validation

#### 6. post_journal_entry() - Migration 050 (Account ID Fix)
- **File**: `supabase/migrations/050_fix_account_id_null.sql` (line 80)
- **Function**: `post_journal_entry()` (legacy version)
- **Condition**: Always executes
- **Context**: Legacy version with account_id validation

#### 7. post_journal_entry() - Migration 043 (Core)
- **File**: `supabase/migrations/043_accounting_core.sql` (line 177)
- **Function**: `post_journal_entry()` (original version)
- **Condition**: Always executes
- **Context**: Original core function

#### 8. post_invoice_to_ledger()
- **File**: `supabase/migrations/099_coa_validation_guards.sql` (line 845)
- **Function**: `post_invoice_to_ledger()`
- **Condition**: Always executes when posting invoice
- **Context**: Invoice posting to ledger

#### 9. post_expense_to_ledger()
- **File**: `supabase/migrations/099_coa_validation_guards.sql` (line 990)
- **Function**: `post_expense_to_ledger()`
- **Condition**: Always executes when posting expense
- **Context**: Expense posting to ledger

#### 10. post_opening_balance()
- **File**: `supabase/migrations/096_opening_balances.sql` (line 139)
- **Function**: `post_opening_balance()`
- **Condition**: Always executes when posting opening balance
- **Context**: Opening balance posting

#### 11. post_adjustment_journal()
- **File**: `supabase/migrations/095_adjustment_journals.sql` (line 122)
- **Function**: `post_adjustment_journal()`
- **Condition**: Always executes when posting adjustment
- **Context**: Adjustment journal posting

#### 12. post_asset_transaction()
- **File**: `supabase/migrations/046_asset_register.sql` (lines 159, 163, 230, 234, 340, 344, 348, 353, 356)
- **Function**: `post_asset_transaction()`
- **Condition**: Multiple conditions for different asset transaction types
- **Context**: Asset register posting (depreciation, disposal, etc.)

#### 13. post_payroll_to_ledger()
- **File**: `supabase/migrations/047_payroll_system.sql` (lines 312, 316, 320, 324, 328, 332)
- **Function**: `post_payroll_to_ledger()`
- **Condition**: Always executes when posting payroll
- **Context**: Payroll posting to ledger

#### 14. Reconciliation Functions
- **File**: `supabase/migrations/049_combined_reconciliation_assets_payroll_vat.sql` (multiple lines: 321, 324, 384, 387, 483, 486, 489, 493, 496, 794, 797, 800, 803, 806, 809)
- **Functions**: Various reconciliation functions
- **Condition**: Various conditions for reconciliation
- **Context**: Reconciliation posting

#### 15. Opening Balance Batch Posting
- **File**: `supabase/migrations/151_opening_balance_posting_step9_1_batch_c.sql` (line 280)
- **Function**: Batch opening balance posting
- **Condition**: Always executes
- **Context**: Batch opening balance posting

#### 16. Manual Journal Draft Posting
- **File**: `supabase/migrations/148_manual_journal_draft_posting_hardening.sql` (line 288)
- **Function**: Manual journal draft posting
- **Condition**: Always executes
- **Context**: Manual journal draft posting

### UPDATE Statements

**NONE FOUND** - All UPDATE operations are blocked by trigger `trigger_prevent_journal_entry_line_modification`

### DELETE Statements

#### 1. Migration 052 - Foreign Key Fix
- **File**: `supabase/migrations/052_fix_all_foreign_keys_and_relations.sql` (line 63)
- **Function**: Migration script (one-time cleanup)
- **Condition**: One-time migration cleanup
- **Context**: Foreign key relationship fix (historical cleanup only)
- **Code**:
  ```sql
  DELETE FROM journal_entry_lines 
  ```
  **NOTE**: This is a one-time migration cleanup, not an active code path

**NO OTHER DELETE STATEMENTS FOUND** - All DELETE operations are blocked by trigger `trigger_prevent_journal_entry_line_modification`

### TRUNCATE Statements

**NONE FOUND**

### MERGE Statements

**NONE FOUND**

---

## STEP 2: ALL TRIGGERS ON journal_entry_lines

### Trigger 1: trigger_prevent_journal_entry_line_modification
- **File**: `supabase/migrations/088_hard_db_constraints_ledger.sql` (lines 42-58)
- **Type**: BEFORE UPDATE OR DELETE
- **Function**: `prevent_journal_entry_line_modification()`
- **Condition**: Fires on UPDATE or DELETE operations
- **Action**: Raises exception to prevent UPDATE/DELETE
- **Code**:
  ```sql
  CREATE OR REPLACE FUNCTION prevent_journal_entry_line_modification()
  RETURNS TRIGGER AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Journal entry lines are immutable (append-only). Cannot UPDATE journal entry line. Use adjustment journals for corrections.';
    ELSIF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Journal entry lines are immutable (append-only). Cannot DELETE journal entry line. Use adjustment journals for corrections.';
    END IF;
    RETURN NULL;
  END;
  $$
  
  CREATE TRIGGER trigger_prevent_journal_entry_line_modification
    BEFORE UPDATE OR DELETE ON journal_entry_lines
    FOR EACH ROW
    EXECUTE FUNCTION prevent_journal_entry_line_modification();
  ```

### Trigger 2: trigger_enforce_double_entry_balance
- **File**: `supabase/migrations/088_hard_db_constraints_ledger.sql` (lines 115-151)
- **Type**: AFTER INSERT
- **Function**: `enforce_double_entry_balance()`
- **Condition**: Fires AFTER each INSERT
- **Action**: Validates balance by summing all lines for the journal entry
- **Code**:
  ```sql
  CREATE OR REPLACE FUNCTION enforce_double_entry_balance()
  RETURNS TRIGGER AS $$
  DECLARE
    total_debit NUMERIC := 0;
    total_credit NUMERIC := 0;
    imbalance NUMERIC;
  BEGIN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = NEW.journal_entry_id;
    
    imbalance := ABS(total_debit - total_credit);
    
    IF imbalance > 0.01 THEN
      RAISE EXCEPTION 'Journal entry is not balanced. Debit total: %, Credit total: %, Difference: %. Double-entry requires SUM(debit) = SUM(credit). Tip: Use post_journal_entry() function or insert all lines in a single INSERT statement.',
        total_debit, total_credit, imbalance;
    END IF;
    
    RETURN NEW;
  END;
  $$
  
  CREATE TRIGGER trigger_enforce_double_entry_balance
    AFTER INSERT ON journal_entry_lines
    FOR EACH ROW
    EXECUTE FUNCTION enforce_double_entry_balance();
  ```

---

## CRITICAL FINDINGS

### Finding 1: Only ONE Active Writer for Sale Posting
**During a sale posting, only ONE function writes to `journal_entry_lines`:**
- `post_journal_entry()` (called by `post_sale_to_ledger()`)

**All other INSERT statements are in different functions for different purposes:**
- Invoices, expenses, payroll, assets, adjustments, opening balances, etc.
- **NONE of these are called during sale posting**

### Finding 2: No UPDATE/DELETE Operations
- UPDATE is blocked by `trigger_prevent_journal_entry_line_modification`
- DELETE is blocked by `trigger_prevent_journal_entry_line_modification`
- The only DELETE found is a one-time migration cleanup (not active)

### Finding 3: Trigger Behavior
- `trigger_enforce_double_entry_balance` fires **AFTER each INSERT**
- It reads from the **table** (not from `p_lines`)
- If the table has incorrect values, the trigger will see them

### Finding 4: No Other Mutations
**There are NO other code paths that can mutate `journal_entry_lines` during sale posting:**
- No UPDATE triggers
- No DELETE triggers (except prevention)
- No other INSERT statements in sale posting flow
- No stored procedures that modify the table
- No foreign key cascades that modify the table

---

## CONCLUSION

**The ONLY writer to `journal_entry_lines` during sale posting is:**
- `post_journal_entry()` function (migration 184/179)

**The ONLY trigger that reads from the table is:**
- `trigger_enforce_double_entry_balance` (migration 088)

**Therefore:**
- If `p_lines` is correct (verified)
- And `post_journal_entry()` inserts correct values (should be, with JSONB fix)
- But trigger sees incorrect values (credit=0)
- **Then the INSERT statement itself must be inserting incorrect values**

**The bug is in the INSERT statement in `post_journal_entry()`, specifically:**
- The JSONB extraction `(line->>'credit')::NUMERIC` was unsafe (now fixed to `(line->'credit')::NUMERIC`)
- This was causing NULL coercion to 0, which was then inserted into the table
- The trigger correctly detected this imbalance

**No other code path can explain the credit=0 issue.**
