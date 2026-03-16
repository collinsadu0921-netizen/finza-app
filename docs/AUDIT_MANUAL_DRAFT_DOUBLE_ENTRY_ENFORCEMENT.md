# Audit: Manual Draft Posting Fails Double-Entry Enforcement (Read-Only)

## 1. Locate Balance Enforcement

**Trigger name:** `trigger_enforce_double_entry_balance`  
**Table:** `journal_entry_lines`

**Timing and level:**
- **AFTER INSERT**
- **FOR EACH STATEMENT** (statement-level). Migration 088 originally created a **FOR EACH ROW** trigger; migration 185 replaced it with statement-level; migration 188 dropped and recreated the statement-level trigger. The current definition (from 188) is statement-level.

**Function:** `enforce_double_entry_balance_statement()` (188) — or, if 185 was applied and 188 was not, the same function name from 185. Migration 088’s row-level function was `enforce_double_entry_balance()` and was dropped in 188.

**Exact RAISE EXCEPTION text** (identical in 088 row-level and 185/188 statement-level):

```text
Journal entry is not balanced. Debit total: %, Credit total: %, Difference: %. Double-entry requires SUM(debit) = SUM(credit). Tip: Use post_journal_entry() function or insert all lines in a single INSERT statement.
```

**Migration file:**  
- Current trigger/function: **188_fix_journal_balance_enforcement.sql**  
- Original row-level (replaced): **088_hard_db_constraints_ledger.sql**  
- Intermediate statement-level: **185_fix_ledger_balance_trigger_statement_level.sql**

**Trigger definition (188, lines 69–72):**

```sql
CREATE TRIGGER trigger_enforce_double_entry_balance
  AFTER INSERT ON journal_entry_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION enforce_double_entry_balance_statement();
```

**Function definition — relevant part (188, lines 31–64):**

```sql
CREATE OR REPLACE FUNCTION enforce_double_entry_balance_statement()
RETURNS TRIGGER AS $$
DECLARE
  journal_entry_id_val UUID;
  total_debit NUMERIC;
  total_credit NUMERIC;
  imbalance NUMERIC;
BEGIN
  FOR journal_entry_id_val IN 
    SELECT DISTINCT journal_entry_id
    FROM journal_entry_lines
  LOOP
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = journal_entry_id_val;
    imbalance := ABS(total_debit - total_credit);
    IF imbalance > 0.01 THEN
      RAISE EXCEPTION 'Journal entry is not balanced. Debit total: %, Credit total: %, Difference: %. Double-entry requires SUM(debit) = SUM(credit). Tip: Use post_journal_entry() function or insert all lines in a single INSERT statement.',
        total_debit, total_credit, imbalance;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

---

## 2. Confirm Current Insert Behavior

From **post_manual_journal_draft_to_ledger** (299_manual_draft_posting_source.sql, lines 206–221):

- Journal entry lines are inserted inside a **FOR ... LOOP**:
  - `FOR line_record IN SELECT * FROM jsonb_array_elements(draft_record.lines) LOOP`
- Each iteration runs a **separate** `INSERT INTO journal_entry_lines (...) VALUES (...)`.
- So there are **multiple row-level insert operations**, each executed as its **own SQL statement** (one INSERT per loop iteration).

---

## 3. Enforcement Timing

- The trigger is **AFTER INSERT** and **FOR EACH STATEMENT**.
- So it runs **once per INSERT statement**, after that statement’s rows are inserted.
- It does **not** run after the whole transaction commits; it runs at the end of each INSERT statement.
- It does **not** run once “after all lines” when multiple lines are inserted in multiple statements: each statement gets its own trigger execution.

So:

- **Does the trigger validate balance after each row insert?**  
  No. With FOR EACH STATEMENT it runs after each **statement**. But each row in `post_manual_journal_draft_to_ledger` is inserted by a **separate** statement, so effectively it runs after each row’s insert.
- **Or after the entire statement completes?**  
  Yes — after the **current** INSERT statement completes. For the manual-draft function, each INSERT inserts exactly one row, so “entire statement” = one line.
- **Or after transaction commit?**  
  No.

**Conclusion from migration definitions:** The trigger validates balance after each INSERT **statement**. Because `post_manual_journal_draft_to_ledger` uses one INSERT per line, the trigger runs after the first line is inserted. At that moment only one row exists for that `journal_entry_id`, so SUM(debit) ≠ SUM(credit) (e.g. debit 1000, credit 0) and the trigger raises.

---

## 4. Compare With Canonical Engine

**post_journal_entry()** (253_accounting_adoption_boundary.sql, lines 227–240):

- Inserts **journal_entry_lines** with a **single** INSERT:
  - `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) SELECT journal_id, (jl->>'account_id')::UUID, ... FROM jsonb_array_elements(p_lines) AS jl;`
- So it uses a **single INSERT ... SELECT** that inserts all lines in one statement.
- It uses the **same** trigger on `journal_entry_lines` (no separate path).
- The trigger runs **once** after that single INSERT; at that time all lines for that journal entry are visible, so the balance check sees the full entry and passes (when the entry is balanced).

**Conclusion:** The canonical engine complies with the enforcement mechanism by inserting all lines in **one statement**, so the statement-level trigger runs once and sees a balanced set of rows.

---

## 5. Final Conclusion (Required Format)

- **Exact DB object causing failure:**  
  Trigger **`trigger_enforce_double_entry_balance`** on table **`journal_entry_lines`**, which calls function **`enforce_double_entry_balance_statement()`**.

- **Exact rule being enforced:**  
  For every `journal_entry_id` that has rows in `journal_entry_lines`, the sum of `debit` and the sum of `credit` for that `journal_entry_id` must differ by at most 0.01 (i.e. SUM(debit) = SUM(credit) within rounding). The trigger runs AFTER INSERT ON journal_entry_lines FOR EACH STATEMENT and raises the exception above when imbalance > 0.01.

- **Exact reason loop-based insertion violates it:**  
  `post_manual_journal_draft_to_ledger` inserts lines one at a time in a PL/pgSQL loop, with **one INSERT statement per line**. The trigger runs **after each INSERT statement**. After the **first** INSERT, only **one** line exists for that journal entry (e.g. one debit line: 1000 debit, 0 credit). So total_debit = 1000, total_credit = 0, imbalance = 1000 > 0.01, and the trigger raises before any further lines are inserted.

- **Whether this behavior is by design:**  
  Yes. Migrations 185 and 188 explicitly state that the row-level trigger was wrong for multi-line entries and that the fix is (1) a statement-level trigger and (2) inserting all lines in a **single** INSERT (or using post_journal_entry). The tip in the exception message says to “insert all lines in a single INSERT statement.” So the design is: one INSERT per journal entry’s lines, then one trigger run that sees the full set.

- **Whether this is consistent with current ledger architecture:**  
  Yes. The canonical path (`post_journal_entry`) and other posting functions (e.g. payroll 287, asset 290) use a **single** INSERT for all lines of a journal entry. Only `post_manual_journal_draft_to_ledger` (and, from earlier audits, `post_opening_balance_import_to_ledger` if it uses a loop) inserts lines in a loop with one INSERT per line, which is inconsistent with how the balance trigger is intended to be used.

---

No fixes, refactors, or migrations suggested. Audit only.
