# Credit Note Ledger Posting — Read-Only Audit Report

**Scope:** Trace why credit notes may not appear in the ledger after lifecycle events. Confirm posting is intended only on `"applied"` and whether the trigger chain runs correctly. No code changes; evidence only.

---

## STEP 1 — Business Rule (Confirmed)

**1. Is ledger posting intentionally designed to occur ONLY when `credit_notes.status = 'applied'`?**

**Yes.** Evidence:

- **`app/api/credit-notes/[id]/send/route.ts` lines 11–12:**  
  Comment: *"Does NOT post to ledger; ledger posting occurs only when status becomes 'applied' (trigger_post_credit_note)."*

- **Trigger condition:**  
  `supabase/migrations/219_credit_note_trigger_atomicity.sql` lines 13–14 and `043_accounting_core.sql` lines 983–984:  
  `IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied') THEN`  
  Posting is only invoked when status becomes `'applied'`.

**2. Does the send route call posting RPC or any DB posting function?**

**No.** Evidence:

- **`app/api/credit-notes/[id]/send/route.ts`:**  
  No references to `post_credit_note_to_ledger`, `post_journal_entry`, or any other posting RPC/DB function.  
  Only status update: `.update({ status: "issued" })` (line 152). No `journal_entry_id` update (table has no such column per 040).

---

## STEP 2 — Apply Flow End-to-End

| Step | Location | Evidence |
|------|----------|----------|
| UI Apply | `app/credit-notes/[id]/view/page.tsx` | Apply button → `PUT /api/credit-notes/${id}` with `body: JSON.stringify({ status: "applied" })` |
| API | `app/api/credit-notes/[id]/route.ts` | PUT handler: validates apply (outstanding, tolerance), then `supabase.from("credit_notes").update(updateData).eq("id", creditNoteId)` (lines 311–316). No direct call to `post_credit_note_to_ledger`; posting is expected via DB trigger on that UPDATE. |
| DB trigger | `043_accounting_core.sql` 979–1010 | Trigger name: `trigger_auto_post_credit_note`. Fires: **AFTER INSERT OR UPDATE OF status** ON `credit_notes`. Function: `trigger_post_credit_note()`. |
| Trigger function | `219_credit_note_trigger_atomicity.sql` 10–24 | When `NEW.status = 'applied'` and idempotency check passes, `PERFORM post_credit_note_to_ledger(NEW.id)`. |
| RPC | `190_fix_posting_source_default_bug.sql` 1267–1462 | `post_credit_note_to_ledger(p_credit_note_id UUID)` builds lines and calls `post_journal_entry(...)` (line 1441). |
| Journal writes | `190_fix_posting_source_default_bug.sql` 98–235 | `post_journal_entry` inserts one row into `journal_entries` (lines 185–216), then one batch INSERT into `journal_entry_lines` (lines 220–234). |

**Expected journal table writes:** One row in `journal_entries` with `reference_type = 'credit_note'`, `reference_id = credit_note.id`; multiple rows in `journal_entry_lines` for that `journal_entry_id`.

---

## STEP 3 — Trigger Execution Conditions

**1. Trigger fires on: AFTER UPDATE OF status?**  
Yes. `043_accounting_core.sql` line 1008: `AFTER INSERT OR UPDATE OF status ON credit_notes`.

**2. Trigger condition: NEW.status = 'applied'?**  
Yes. `219_credit_note_trigger_atomicity.sql` line 13: `IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied') THEN`.

**3. Does trigger check OLD.status != 'applied'?**  
Yes. Same line: `(OLD.status IS NULL OR OLD.status != 'applied')` prevents re-posting when already applied.

**4. Does trigger swallow errors?**  
No. No EXCEPTION block in `trigger_post_credit_note()`. Migration 219 (lines 1–6) states that failures in `post_credit_note_to_ledger` (e.g. `assert_accounting_period_is_open`) abort the transaction and the UPDATE to `status = 'applied'` is rolled back.

**Trigger SQL (current definition):**  
`supabase/migrations/219_credit_note_trigger_atomicity.sql` lines 10–24 (full function body).

---

## STEP 4 — RPC Behavior (`post_credit_note_to_ledger`)

**Source:** `190_fix_posting_source_default_bug.sql` lines 1267–1462.

- **Inserts:** Does not INSERT directly. Calls `post_journal_entry(...)` (line 1441), which performs:
  - One INSERT into `journal_entries` (190 lines 185–216),
  - One batch INSERT into `journal_entry_lines` (190 lines 220–234).
- **Single INSERT for lines:** Yes; `post_journal_entry` uses a single batch INSERT for all lines.
- **Idempotency guard:** In the **trigger**, not in the RPC. Trigger (219 and 043): `IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference_type = 'credit_note' AND reference_id = NEW.id) THEN PERFORM post_credit_note_to_ledger(NEW.id)`. The RPC itself does not check for an existing journal entry.
- **assert_accounting_period_is_open:** Yes. Line 1321: `PERFORM assert_accounting_period_is_open(business_id_val, cn_record.date);` before building lines.
- **Account mapping:** AR from control key `'AR'`; revenue from code `'4000'`; tax from `tax_lines` (canonical `lines` array) with `ledger_account_code` and `ledger_side` from line meta; credit note reverses (AR credit, revenue debit, tax sides flipped).

---

## STEP 5 — Runtime Failure Points

- **API try/catch:** `app/api/credit-notes/[id]/route.ts` lines 311–324: UPDATE is awaited; if DB returns error (including trigger-raising), `error` is set and API returns 500. No catch that would ignore a trigger failure and still return success.
- **SQL EXCEPTION blocks:** `trigger_post_credit_note` has no EXCEPTION block. `post_credit_note_to_ledger` and `post_journal_entry` use RAISE EXCEPTION on validation/assert failures; no `EXCEPTION WHEN ...` that would swallow and continue.
- **Early RETURN in RPC:** Only normal exit: `RETURN journal_id` (190 line 1459) after successful `post_journal_entry`. Early exits are RAISE EXCEPTION (e.g. 1306, 1315), which abort the transaction.

**Conclusion:** If posting fails (e.g. period closed, missing account), the trigger raises, the UPDATE transaction rolls back, and the API receives a DB error and returns 500. **Credit note status cannot become `'applied'` in the same request while ledger posting fails** under this code path.

---

## STEP 6 — Invoice Balance Update Trigger

- **Trigger:** `129_fix_invoice_status_sync.sql` lines 166–170: `trigger_update_invoice_on_credit_note` on `credit_notes`, **AFTER UPDATE OF status**, WHEN `(NEW.status = 'applied' OR OLD.status = 'applied')`, executes `update_invoice_status_on_credit_note()`.
- **Function:** Same migration lines 114–124: when status changes to or from `'applied'`, `PERFORM recalculate_invoice_status(NEW.invoice_id)`.
- **Independent of ledger posting:** Yes. This trigger only calls `recalculate_invoice_status`; it does not call `post_credit_note_to_ledger` or any journal logic. Invoice status recalc and ledger posting are separate.

---

## STEP 7 — Actual Data

**Note:** The `credit_notes` table has **no** `journal_entry_id` column (see `040_credit_notes.sql`). The link is: `journal_entries.reference_type = 'credit_note'` and `journal_entries.reference_id = credit_notes.id`.

**Query to run in DB (requires DB access):**

```sql
SELECT cn.id, cn.status,
       je.id AS journal_entry_id,
       (SELECT COUNT(*) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) AS line_count
FROM credit_notes cn
LEFT JOIN journal_entries je ON je.reference_type = 'credit_note' AND je.reference_id = cn.id
WHERE cn.status = 'applied' AND cn.deleted_at IS NULL;
```

**Check:** Rows with `status = 'applied'` and `journal_entry_id` NULL (or missing `journal_entry_lines`) would indicate applied without posting. This audit did not run against a live DB; run the above to verify.

---

## STEP 8 — Period Lock Blocking

- **Usage:** `post_credit_note_to_ledger` calls `assert_accounting_period_is_open(business_id_val, cn_record.date)` (190 line 1321). If the period is closed, this raises.
- **Effect:** Trigger has no EXCEPTION handler, so the exception aborts the transaction. The UPDATE that set `status = 'applied'` is **rolled back** (per 219 comment). So **period lock does not leave credit note applied without posting**; it prevents the apply from committing.

---

## STEP 9 — Send Route Side Effects

- **File:** `app/api/credit-notes/[id]/send/route.ts`.
- **Status:** Only sets status to `issued` (line 152: `.update({ status: "issued" })`). Does not set `applied`.
- **Posting:** Does not call any posting RPC or DB function (see Step 1).
- **journal_entry_id:** Table has no such column; send route does not update it.

---

## STEP 10 — Final Diagnosis

1. **Intended behaviour:** Ledger posting for credit notes is intended **only** when `credit_notes.status` becomes `'applied'`. It is driven by the DB trigger `trigger_auto_post_credit_note` (AFTER INSERT OR UPDATE OF status), which calls `post_credit_note_to_ledger`. The send route only sets status to `issued` and does not post.

2. **Is the posting chain broken?** From the code, the chain is **consistent**: Apply → API UPDATE → trigger → `post_credit_note_to_ledger` → `post_journal_entry` → `journal_entries` + `journal_entry_lines`. No EXCEPTION swallowing; trigger and RPC failures roll back the UPDATE.

3. **Exact failure location if broken:** Not identified in code. If “credit notes not appearing in ledger” persists, possible causes outside this chain include: trigger not created (e.g. migration order: 043’s `IF EXISTS credit_notes`), different code path (e.g. direct DB or other client setting `status = 'applied'` without running migrations), or UI/query showing ledger data incorrectly (e.g. filter excluding `reference_type = 'credit_note'`).

4. **Skipped vs failing:** Design does not allow “skip” of posting while still committing `applied`: if posting fails, the transaction rolls back. So if applied rows exist without a journal entry, either the trigger was not present when they were applied, or the link is via `journal_entries.reference_id` and the query/report does not join correctly.

5. **Evidence references:**  
   - Send route: `app/api/credit-notes/[id]/send/route.ts` (lines 11–12, 148–152).  
   - Apply API: `app/api/credit-notes/[id]/route.ts` (311–324).  
   - Trigger: `043_accounting_core.sql` (979–1010), `219_credit_note_trigger_atomicity.sql` (full).  
   - RPC: `190_fix_posting_source_default_bug.sql` (1267–1462, 1321, 1441).  
   - Invoice trigger: `129_fix_invoice_status_sync.sql` (114–124, 166–170).  
   - Table: `040_credit_notes.sql` (no `journal_entry_id`).

---

**No fixes or suggestions.** Evidence-only audit as requested.
