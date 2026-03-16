# Trigger Design Flaw: Row-Level Balance Enforcement

## The Problem

The `trigger_enforce_double_entry_balance` trigger is defined as:
- **Type**: AFTER INSERT
- **Level**: FOR EACH ROW
- **Action**: Validates balance by summing ALL lines for the journal entry

## Why This Fails

### Row-Level Trigger Behavior

When a row-level trigger fires:
1. It fires **AFTER each individual row is inserted**
2. It cannot see future rows that will be inserted
3. It validates the **current state** of the table

### Example: Inserting a Balanced 2-Line Entry

**Line 1 (Debit):**
```sql
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
VALUES (journal_id, cash_account, 100.00, 0.00);
```

**What happens:**
1. Row is inserted into table
2. Trigger fires (AFTER INSERT, FOR EACH ROW)
3. Trigger queries table: `SELECT SUM(debit), SUM(credit) FROM journal_entry_lines WHERE journal_entry_id = X`
4. Result: `debit = 100.00, credit = 0.00`
5. Imbalance: `100.00 - 0.00 = 100.00 > 0.01`
6. **TRIGGER RAISES EXCEPTION**
7. Transaction is aborted
8. **Line 2 is NEVER inserted**

**Line 2 (Credit) - NEVER REACHED:**
```sql
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
VALUES (journal_id, revenue_account, 0.00, 100.00);
```

## The Fundamental Issue

**A row-level AFTER INSERT trigger that validates balance will ALWAYS fail on the first line** of any multi-line journal entry because:
- The first line creates an imbalance (either debit-only or credit-only)
- The trigger validates immediately after that first line
- The transaction is aborted before subsequent lines can be inserted

## Why post_journal_entry() "Works"

The `post_journal_entry()` function inserts lines in a **loop within a single transaction**:
```sql
FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
LOOP
  INSERT INTO journal_entry_lines ...
END LOOP;
```

**However**, even though all inserts are in the same transaction:
- Each INSERT statement is executed sequentially
- The trigger fires AFTER each INSERT
- After the FIRST INSERT, the trigger sees imbalance and raises exception
- The transaction is aborted
- Subsequent INSERTs in the loop are never reached

**Wait, but the diagnostic showed p_lines is correct...**

This suggests one of two things:
1. The trigger is somehow not firing (unlikely)
2. The trigger is being bypassed somehow (unlikely)
3. **The INSERT statements are somehow being executed atomically** (possible with certain PostgreSQL configurations)
4. **The trigger definition is different than expected** (needs verification)

## Solution Options

### Option 1: Change Trigger to STATEMENT Level
- Change from `FOR EACH ROW` to `FOR EACH STATEMENT`
- Trigger fires once after ALL rows are inserted
- Validates balance after complete entry is inserted

### Option 2: Remove Trigger, Validate in Function
- Remove the trigger entirely
- `post_journal_entry()` already validates balance BEFORE inserting
- The trigger is redundant and causes the failure

### Option 3: Use Deferred Constraint
- PostgreSQL doesn't support deferred triggers
- Would need to use a constraint instead
- More complex implementation

## Recommended Fix

**Remove the row-level trigger** because:
1. `post_journal_entry()` already validates balance before inserting
2. The trigger is redundant
3. The trigger prevents line-by-line insertion (which is sometimes necessary)
4. The trigger causes false failures on the first line

**Alternative**: Change to statement-level trigger if balance validation at DB level is required.
