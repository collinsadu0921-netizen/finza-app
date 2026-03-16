# Service Contribution Posting — Diagnosis (manual_draft flow)

## Context

- Service UI: `/service/accounting/contribution` → `POST /api/accounting/journals/drafts` (owner-mode).
- Owner-mode creates draft (accounting_firm_id = null, status = approved) and immediately calls:
  `rpc("post_manual_journal_draft_to_ledger", { p_draft_id, p_posted_by: user.id })`.
- **Runtime error:** `source_type must be 'proposal' or 'adjustment', got: manual_draft`

---

## 1. Culprit (exact DB object that throws)

**Trigger:** `trigger_enforce_proposal_gating`  
**Trigger function:** `enforce_proposal_gating()`  
**Validation function:** `validate_proposal_gating(p_source_type TEXT, p_source_id UUID, p_business_id UUID)`

The exception is raised **inside** `validate_proposal_gating`, at the check that only allows `'proposal'` or `'adjustment'`.

---

## 2. Where it’s defined

**Migration:** `089_additional_hard_constraints.sql`

**Trigger:**

```sql
DROP TRIGGER IF EXISTS trigger_enforce_proposal_gating ON journal_entries;
CREATE TRIGGER trigger_enforce_proposal_gating
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_proposal_gating();
```

**Trigger function:**

```sql
CREATE OR REPLACE FUNCTION enforce_proposal_gating()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_type IS NOT NULL THEN
    PERFORM validate_proposal_gating(NEW.source_type, NEW.source_id, NEW.business_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Validation function (exception at lines 50–53):**

```sql
  IF p_source_type IS NOT NULL THEN
    IF p_source_type NOT IN ('proposal', 'adjustment') THEN
      RAISE EXCEPTION 'source_type must be ''proposal'' or ''adjustment'', got: %', p_source_type;
    END IF;
    -- ... adjustment_journal / posting_proposal checks ...
  END IF;
```

---

## 3. Why the insert fails despite the check constraint

- **Check constraint** `journal_entries_source_type_check` (migrations 148, 151) allows  
  `source_type IS NULL OR source_type IN ('proposal', 'adjustment', 'manual_draft', 'opening_balance')`.  
  So at the **constraint** level, `manual_draft` is valid.

- The insert fails **before** the row is checked against that constraint, because:
  1. `post_manual_journal_draft_to_ledger` performs `INSERT INTO journal_entries (..., source_type, ...) VALUES (..., 'manual_draft', ...)`.
  2. A **BEFORE INSERT** trigger, `trigger_enforce_proposal_gating`, runs first.
  3. The trigger calls `validate_proposal_gating(NEW.source_type, NEW.source_id, NEW.business_id)`.
  4. `validate_proposal_gating` only allows `source_type IN ('proposal', 'adjustment')` and raises  
     `source_type must be 'proposal' or 'adjustment', got: manual_draft` for `manual_draft`.
  5. The exception aborts the transaction, so the row never reaches the CHECK constraint.

So the **trigger** is enforcing an older rule (proposal/adjustment only). Migrations 148 and 151 updated only the **constraint** and did not drop or relax this trigger (or the function).

---

## 4. Evidence summary

| Item | Status |
|------|--------|
| CHECK constraint | Allows manual_draft (148, 151). |
| Trigger on INSERT | `trigger_enforce_proposal_gating` (089) still present. |
| Trigger function | `enforce_proposal_gating()` calls `validate_proposal_gating`. |
| Validation function | `validate_proposal_gating` allows only `'proposal'` or `'adjustment'`. |
| Later migrations | No migration drops or alters this trigger or function. |

---

## 5. Minimal fix options (identification only — do not implement here)

- **Option A (DB-only):** In `validate_proposal_gating`, extend the allowed list so that when `source_type` is `'manual_draft'` (and optionally `'opening_balance'`), skip the proposal/adjustment validation (e.g. allow and return without checking source_id against proposal/adjustment tables). This keeps the trigger but aligns it with the CHECK constraint.
- **Option B (DB-only):** Drop the trigger `trigger_enforce_proposal_gating` so that only the CHECK constraint and RPC logic enforce source_type. Proposal/adjustment semantics would then be enforced only in the code paths that use them (e.g. post_journal_entry / apply_adjusting_journal), not on every insert.
- **Option C (DB-only):** Change the trigger so it does not run when `source_type IN ('manual_draft', 'opening_balance')` (e.g. in `enforce_proposal_gating()`, IF `NEW.source_type IN ('manual_draft', 'opening_balance')` THEN RETURN NEW; before calling `validate_proposal_gating`). Then proposal/adjustment still validated for other source_types.

Once you choose which option (A, B, or C), the smallest safe fix can be implemented in a single migration (DB-only).
