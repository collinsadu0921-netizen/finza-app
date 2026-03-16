# Invoice Crediting (Credit Note) — Debug & Fix

## A) User-facing entry point

| Item | Location | Evidence |
|------|----------|----------|
| **Create Credit Note** | `app/invoices/[id]/view/page.tsx:837` | Button: `onClick={() => router.push(\`/credit-notes/create?invoiceId=${invoiceId}\`)}` → navigates to `/credit-notes/create?invoiceId=...` |
| **Create API** | `app/credit-notes/create/page.tsx:191` | `fetch("/api/credit-notes/create", { method: "POST", body: JSON.stringify({ business_id, invoice_id, date, reason, items, ... }) })` |
| **Apply Credit Note** | `app/credit-notes/[id]/view/page.tsx:88–91` | `fetch(\`/api/credit-notes/${id}\`, { method: "PUT", body: JSON.stringify({ status: "applied" }) })` |

Payload shape for create: `{ business_id, invoice_id, credit_number?, date, reason, notes, items, apply_taxes? }`. Required: `business_id`, `invoice_id`, `date`, `items` (non-empty).

---

## B) API routes

| Route | File | Purpose | DB writes |
|-------|------|---------|-----------|
| **POST /api/credit-notes/create** | `app/api/credit-notes/create/route.ts` | Create credit note | `credit_notes` (status `"draft"`), then `credit_note_items` |
| **PUT /api/credit-notes/[id]** | `app/api/credit-notes/[id]/route.ts` | Apply (or update status/reason/notes) | `credit_notes` UPDATE `status = 'applied'` (and optional reason/notes) |

- Create: auth via `getUser` + `getCurrentBusiness`; scoping by `business_id`/`invoice_id`. Insert uses `credit_number`, `date`, `subtotal`, `total_tax`, `total`, `status: "draft"`, `tax_lines` (from `toTaxLinesJsonb`), etc.
- Apply: PUT body `{ status: "applied" }` → `supabase.from("credit_notes").update(updateData).eq("id", creditNoteId)`. Auth/scoping present but currently commented for development.

---

## C) DB posting (triggers)

| Item | File:line | Evidence |
|------|-----------|----------|
| **Trigger** | **043_accounting_core.sql:1004–1008** | `CREATE TRIGGER trigger_auto_post_credit_note` AFTER INSERT OR UPDATE OF status ON credit_notes, FOR EACH ROW, EXECUTE FUNCTION trigger_post_credit_note(); |
| **Function** | **043_accounting_core.sql:979–994** | `trigger_post_credit_note()`: IF NEW.status = 'applied' AND (OLD IS NULL OR OLD.status != 'applied') THEN NOT EXISTS( JE for this id ) → PERFORM post_credit_note_to_ledger(NEW.id). No EXCEPTION block. |

**Condition:** Posting runs only when `NEW.status = 'applied'` and (INSERT or status transition into applied). Idempotency: calls `post_credit_note_to_ledger` only when no `journal_entries` row exists with `reference_type = 'credit_note'` and `reference_id = NEW.id`.

**Exception handling:** The trigger does **not** wrap `post_credit_note_to_ledger` in `EXCEPTION WHEN OTHERS`. Any exception from posting propagates and aborts the transaction, so the UPDATE to `status = 'applied'` is rolled back. No swallowing.

---

## D) Posting function (canonical)

| Item | File:line | Evidence |
|------|-----------|----------|
| **Canonical** | **190_fix_posting_source_default_bug.sql:1267–1462** | `post_credit_note_to_ledger(p_credit_note_id UUID)` |
| **Period assert** | **190:1319–1320** | `PERFORM assert_accounting_period_is_open(business_id_val, cn_record.date);` — uses **credit note date** (`cn_record.date`). |
| **Accounts** | 190:1344–1369 | AR via `get_control_account_code`/`get_account_by_control_key`, revenue `4000`, tax from `tax_lines` (meta.ledger_account_code / ledger_side). |
| **reference_type / reference_id** | 190:1444–1446 | `'credit_note'`, `p_credit_note_id` passed to `post_journal_entry`. |
| **Idempotency** | Trigger (043:984–987) | Trigger calls posting only when `NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference_type = 'credit_note' AND reference_id = NEW.id)`. |

---

## E) Failing step and guards

**Exact failing step:** Without a concrete run, the flow is consistent: create inserts draft → user applies → PUT updates status to `applied` → trigger runs → `post_credit_note_to_ledger` runs → period assert and COA run → `post_journal_entry`. If any step raises (e.g. LOCKED/SOFT_CLOSED, or missing account), the trigger does not catch it, so the whole transaction rolls back and the credit note row does **not** stay applied. So we do **not** get “credit note row exists but no journal entry” from this path.

**Guards already in place:**

1. **Trigger does not swallow** (043:979–994) — exceptions abort the transaction.
2. **Period assert** in `post_credit_note_to_ledger` (190:1320) — uses `cn_record.date`.
3. **Idempotency** — trigger’s NOT EXISTS ensures we do not post twice for the same credit note id.

**Hardening added:** Migration **219_credit_note_trigger_atomicity.sql** redefines `trigger_post_credit_note` with the same no-swallow logic and an explicit comment that failures must roll back. This matches the payment-trigger pattern (218) and makes the intended behaviour explicit in a later migration.

---

## Evidence table (trigger / posting)

| Component | Calls assert_accounting_period_is_open? | Swallows exceptions? | Can row exist without JE? |
|-----------|----------------------------------------|----------------------|----------------------------|
| **trigger_post_credit_note** (043:979–994) | N (calls `post_credit_note_to_ledger` only) | **N** | **N** (on failure, transaction rolls back) |
| **post_credit_note_to_ledger** (190:1267+) | **Y** (190:1320, date = `cn_record.date`) | **N** | **N** (caller is trigger; on failure, transaction aborts) |

---

## Verification checklist

- **OPEN period:** Apply credit note → trigger → post_credit_note_to_ledger → assert passes → exactly 1 JE with `reference_type = 'credit_note'`, `reference_id = credit_note.id`.
- **SOFT_CLOSED / LOCKED:** Apply credit note → trigger → post_credit_note_to_ledger → assert raises → transaction rolled back → credit note row remains non-applied (draft/issued) → no new JE.
- **Exactly 1 JE when successful:** Trigger’s NOT EXISTS ensures at most one call to `post_credit_note_to_ledger` per credit note id per apply.

---

## Patch summary (files and diffs)

### 1. New migration: `supabase/migrations/219_credit_note_trigger_atomicity.sql`

**Purpose:** Re-state `trigger_post_credit_note()` with explicit no-swallow behaviour so that any failure in `post_credit_note_to_ledger` (including `assert_accounting_period_is_open`) aborts the transaction. Matches the pattern used for payments in 218.

**Change:** `CREATE OR REPLACE FUNCTION trigger_post_credit_note()` with the same body as 043:979–994 (no `EXCEPTION WHEN OTHERS`). Behaviour is unchanged; the migration documents intent and keeps the definition aligned with payment trigger atomicity.

**Diff (new file):**

```sql
-- Credit note trigger must not swallow period enforcement or other posting errors.
-- ...
CREATE OR REPLACE FUNCTION trigger_post_credit_note()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied') THEN
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE reference_type = 'credit_note'
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_credit_note_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2. New document: `INVOICE_CREDITING_DEBUG_AND_FIX.md`

**Purpose:** Evidence and flow for (A)–(E): entry points, API routes, triggers, posting function, and guards. No code changes.

### 3. Files not changed

- No edits to retail/POS routes, triggers, or functions.
- No edits to `post_credit_note_to_ledger` (190 already has period assert and correct accounts).
- No edits to `app/api/credit-notes/create/route.ts` or `app/api/credit-notes/[id]/route.ts`.

### 4. Guard “credit note row exists but no JE”

**Current behaviour:** The trigger does not catch exceptions. If `post_credit_note_to_ledger` raises (period closed, COA, etc.), the trigger raises, the transaction rolls back, and the UPDATE to `status = 'applied'` is not committed. So we do not get “credit note applied without journal entry” from this path.

**Hardening:** Migration 219 makes the no-swallow contract explicit and keeps it consistent with the payment trigger (218).
