# AUDIT: Why Service Contribution / Owner-Mode Manual Draft Is NOT Posting

## Context

- **UI:** `/service/accounting/contribution`
- **API:** `POST /api/accounting/journals/drafts` (owner-mode: create draft then immediately call RPC)
- **RPC:** `public.post_manual_journal_draft_to_ledger(p_draft_id uuid, p_posted_by uuid)`
- **Proposal gating** was fixed (298) to allow `manual_draft` and `opening_balance`; that path is no longer the blocker.

---

## 1. API route: RPC call and error handling

**File:** `app/api/accounting/journals/drafts/route.ts`

- **Owner-mode branch (isOwnerMode):** Inserts draft into `manual_journal_drafts`, then calls:
  ```ts
  supabase.rpc("post_manual_journal_draft_to_ledger", {
    p_draft_id: draftId,
    p_posted_by: user.id,
  })
  ```
- **Error handling:** On `postError`:
  - `postError.message` is used as the user-facing message (or fallback "Failed to post draft to ledger").
  - No `postError.details` or raw PostgREST body is logged; only `console.error("Error posting owner-mode draft to ledger:", postError)`.
  - Response: `{ reasonCode: "DATABASE_ERROR", message: msg }` with status 500 (unless message is matched for status 400/403 as in the snippet).
- So the **exact DB error text** is whatever the RPC returns (e.g. PostgREST passes through the PostgreSQL exception message). The API does not add or transform it; it is the DB exception message.

---

## 2. Triggers on `journal_entries` — summary

For **each** trigger, below: timing, function, migration, and any `RAISE EXCEPTION` paths.

| Trigger | Timing | Event | Function | Migration | RAISE EXCEPTION (exact strings) |
|--------|--------|--------|----------|-----------|----------------------------------|
| **trigger_audit_journal_entry** | AFTER | INSERT | audit_journal_entry_changes() | 044_audit_logging.sql | None (only PERFORM create_audit_log). |
| **trigger_enforce_accountant_only_posting** | BEFORE | INSERT | enforce_accountant_only_posting() | 089, 189 | Via validate_accountant_posting: (1) `'posted_by_accountant_id is required for accountant postings. Only accountants can post ledger entries manually.'` (2) `'User % does not have accountant role for business %. Only accountants can post ledger entries manually.'` |
| **trigger_enforce_currency_fx_validation** | BEFORE | INSERT OR UPDATE | enforce_currency_fx_validation() | 090_final_hard_constraints.sql | Via validate_currency_fx: (1) `'Currency is required for journal entries'` (2) `'Business currency is required. Please set default_currency in Business Profile settings.'` (3) `'FX rate is required when currency (%) differs from base currency (%).'` (4) `'FX rate must be greater than zero, got: %'` |
| **trigger_enforce_period_state_on_entry** | BEFORE | INSERT | validate_period_open_for_entry() | 088, 166 | (1) `'No accounting period found for date %. Period must exist before posting. Business ID: %'` (2) `'Cannot insert journal entry into locked period (period_start: %)...'` (3) `'Adjustment entries require a non-empty adjustment_reason'` (4) `'Adjustment entries must have reference_type = ''adjustment''. Found: %'` (5) `'Adjustment entries must have reference_id = NULL'` (6) `'Cannot insert journal entry into soft-closed period (period_start: %). Regular postings are blocked. Only adjustments are allowed in soft-closed periods. Period ID: %, Date: %'` (7) `'Cannot insert journal entry into period with status ''%'' (period_start: %). Only periods with status ''open'' allow regular postings. Period ID: %, Date: %'` |
| **trigger_enforce_proposal_gating** | BEFORE | INSERT | enforce_proposal_gating() | 089, 298 | Via validate_proposal_gating (after 298): only for non–manual_draft/opening_balance: `'source_type must be ''proposal'' or ''adjustment'', got: %'` and others for source_id/proposal/adjustment. |
| **trigger_invalidate_snapshot_on_journal_entry** | AFTER | INSERT | invalidate_snapshot_on_journal_entry() | 247_snapshot_engine_v2_stale_aware.sql | Does not abort insert (wrapped so insert is not aborted on invalidation failure). |
| **trigger_prevent_journal_entry_modification** | BEFORE | UPDATE OR DELETE | prevent_journal_entry_modification() | 088, 156 | (1) `'Journal entries are immutable (append-only). Cannot UPDATE journal entry...'` (2) `'Journal entries are immutable (append-only). Cannot DELETE journal entry...'` **Does not fire on INSERT.** |

---

## 3. Per-trigger audit (relevant to manual_draft INSERT)

### trigger_enforce_accountant_only_posting

- **Timing:** BEFORE INSERT, FOR EACH ROW.
- **Function:** enforce_accountant_only_posting() → validate_accountant_posting(NEW.posted_by_accountant_id, NEW.business_id, NEW.posting_source).
- **Location:** 089 (2-arg validate), 189 (3-arg validate with posting_source).
- **Rule (189):**
  - If **posting_source = 'accountant'**: requires **posted_by_accountant_id IS NOT NULL** and **is_user_accountant(posted_by_accountant_id, business_id)**. Otherwise:  
    - `RAISE EXCEPTION 'posted_by_accountant_id is required for accountant postings. Only accountants can post ledger entries manually.'`  
    - or `RAISE EXCEPTION 'User % does not have accountant role for business %. Only accountants can post ledger entries manually.', ...`
  - If posting_source is NULL or not 'accountant': no check (returns TRUE).
- **journal_entries.posting_source:** After 189: NOT NULL, DEFAULT 'accountant'. After 190: NOT NULL, **no default** (DROP DEFAULT). So an INSERT that **omits** posting_source leaves it NULL → **NOT NULL constraint** on `journal_entries.posting_source` fails before or after triggers (see below). If posting_source **were** supplied as 'accountant' (e.g. if a default existed), then the trigger would require posted_by_accountant_id. **post_manual_journal_draft_to_ledger** does not set posting_source or posted_by_accountant_id (it sets posted_by only).

### trigger_enforce_period_state_on_entry

- **Timing:** BEFORE INSERT, FOR EACH ROW.
- **Function:** validate_period_open_for_entry() (0-arg trigger version in 166).
- **Location:** 088 (enforce_period_state_on_entry + validate_period_open_for_entry(UUID,DATE)), 166 (replaced with 0-arg trigger validate_period_open_for_entry()).
- **Rule (166):**
  - Period must exist for (NEW.business_id, NEW.date); else `'No accounting period found for date %...'`.
  - If status = **'locked'**: always block.
  - If status = **'soft_closed'**: allow **only** when **NEW.is_adjustment = TRUE** and adjustment_reason / reference_type = 'adjustment' / reference_id IS NULL; otherwise `'Cannot insert journal entry into soft-closed period... Regular postings are blocked. Only adjustments are allowed...'`.
  - If status not 'open' (and not already handled): block with `'Cannot insert journal entry into period with status ''%''...'`.
- **manual_draft INSERT:** Does not set is_adjustment, adjustment_reason, reference_type (it sets reference_type = 'manual'). So for a **soft_closed** period, the trigger treats the row as a regular posting and **blocks** it. For **open** period, it allows.

### trigger_enforce_currency_fx_validation

- **Timing:** BEFORE INSERT OR UPDATE, FOR EACH ROW.
- **Function:** enforce_currency_fx_validation() → validate_currency_fx(NEW.currency, NEW.fx_rate, NEW.business_id).
- **Location:** 090_final_hard_constraints.sql.
- **Rule:** Currency required (not null/empty); business default_currency required; if currency ≠ base_currency then fx_rate required and > 0. Raises as in table above.
- **manual_draft INSERT:** Does not set currency or fx_rate. Column currency has DEFAULT 'GHS' in 090. So NEW.currency = 'GHS', NEW.fx_rate = NULL. If business.default_currency is NULL or '' → `'Business currency is required...'`. If base_currency ≠ 'GHS' → `'FX rate is required when currency (GHS) differs from base currency (...)'`. So this trigger can block when business currency is missing or differs from GHS.

### trigger_prevent_journal_entry_modification

- **Timing:** BEFORE UPDATE OR DELETE, FOR EACH ROW.
- **Function:** prevent_journal_entry_modification().
- **Location:** 088, 156.
- **Rule:** Raises on UPDATE or DELETE. **Does not run on INSERT.** Not the blocker for manual_draft insert.

---

## 4. Table constraint: posting_source NOT NULL

- **Migrations:** 189 adds posting_source and sets it NOT NULL (with default 'accountant'). 190 removes the default (DROP DEFAULT) and keeps NOT NULL.
- **post_manual_journal_draft_to_ledger** (297/294) INSERT column list: business_id, date, description, reference_type, reference_id, source_type, source_id, source_draft_id, input_hash, accounting_firm_id, period_id, created_by, posted_by. It does **not** include **posting_source** (or posted_by_accountant_id, or currency, or fx_rate).
- So for that INSERT, **posting_source** is not supplied and there is **no default** (after 190). The row therefore has **posting_source = NULL**, which violates **NOT NULL** on `journal_entries.posting_source`. PostgreSQL will raise something like:  
  `null value in column "posting_source" of relation "journal_entries" violates not-null constraint`  
  (exact wording may include a constraint name if one exists).

BEFORE INSERT triggers run with the row as built so far; defaults are applied before triggers. So after 190 there is no default, and the row passed to triggers has posting_source = NULL. The trigger **enforce_accountant_only_posting** calls validate_accountant_posting(..., NEW.posting_source). With p_posting_source = NULL, the function does **not** enter the `IF p_posting_source = 'accountant'` block and returns TRUE. So the **accountant trigger does not raise** when posting_source is NULL. The failure then occurs when the row is written: the **NOT NULL constraint on posting_source** fails. So the **first** blocker for the current schema (190 applied) is the **NOT NULL constraint on journal_entries.posting_source**, not the accountant trigger.

If in some environment the default 'accountant' were still present (e.g. 189 applied but not 190), then NEW.posting_source = 'accountant' and the accountant trigger would require posted_by_accountant_id and would raise:  
`posted_by_accountant_id is required for accountant postings. Only accountants can post ledger entries manually.`

---

## 5. Final answer (format requested)

- **Root cause DB object:**  
  - **Primary (current schema after 190):** **Column constraint** on `journal_entries`: **posting_source NOT NULL**.  
  - **Alternative (if default 'accountant' exists):** **Trigger** `trigger_enforce_accountant_only_posting` and **function** `validate_accountant_posting`.

- **Exact rule enforced:**  
  - **NOT NULL:** `journal_entries.posting_source` must not be null.  
  - **Trigger (when posting_source = 'accountant'):** `posted_by_accountant_id` must be non-null and the user must be an accountant for the business.

- **Why manual_draft owner-mode violates it:**  
  - **post_manual_journal_draft_to_ledger** INSERT does not include **posting_source** (and after 190 there is no default). So the row has **posting_source = NULL** → violates NOT NULL.  
  - If posting_source were defaulted to 'accountant', the same INSERT does not set **posted_by_accountant_id** (it sets **posted_by** only). The trigger would then require posted_by_accountant_id and accountant role and would raise.

- **Evidence (RAISE EXCEPTION / constraint):**  
  - **Constraint:** Insert fails with a not-null violation on `posting_source` (e.g. `null value in column "posting_source" of relation "journal_entries" violates not-null constraint`).  
  - **Trigger (if applicable):**  
    `RAISE EXCEPTION 'posted_by_accountant_id is required for accountant postings. Only accountants can post ledger entries manually.';`  
    in **validate_accountant_posting**, migration 189_fix_ledger_posting_authorization.sql (lines 75–76).

---

## 6. Other possible blockers (if NOT NULL were satisfied)

- **trigger_enforce_period_state_on_entry:** Would block if the period for the entry date is **soft_closed** (manual_draft is not an adjustment), with:  
  `'Cannot insert journal entry into soft-closed period (period_start: %). Regular postings are blocked. Only adjustments are allowed in soft-closed periods. Period ID: %, Date: %'`.
- **trigger_enforce_currency_fx_validation:** Would block if business has no default_currency or base_currency ≠ 'GHS' (and no fx_rate), with the exceptions listed in the table above.

No fixes or code changes proposed; audit only.
