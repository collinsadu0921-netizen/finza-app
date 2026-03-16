# Option B — Receipt OCR / Auto-Fill: Impact & Invariants Audit

**Audit type:** Principal Accounting Systems Auditor — audit-only, no code or schema changes.  
**Scope:** Receipt OCR & auto-fill for expenses; ledger and accounting invariants.  
**Context:** OCR does not exist yet. Current system properties are fixed for this audit.

---

## 1. Current expense workflow (baseline)

### When an expense is created

| Step | Authority | Evidence (behavior) |
|------|-----------|---------------------|
| User submits expense form | UI | Form sends supplier, date, amount, nhil, getfund, vat, covid, total, notes, receipt_path, business_id, category_id. |
| API validates user and business | API | Create route checks auth and membership (getUserRole for business_id). |
| API inserts row into `expenses` | API → DB | Single INSERT. No draft; no “save without post.” |
| DB accepts INSERT | DB | Row exists in `expenses` only if all constraints pass. |

**Conclusion:** Expense “creation” is the single INSERT. There is no separate “post” action at the UI or API layer.

### When ledger posting happens

| Step | Authority | Evidence (behavior) |
|------|-----------|---------------------|
| AFTER INSERT trigger on `expenses` | DB | Trigger runs in the same transaction as the INSERT. |
| Trigger calls `post_expense_to_ledger(expense.id)` | DB | Only if no journal entry already exists for this expense (idempotent at trigger level). |
| `post_expense_to_ledger` | DB | Reads expense row; asserts period open; builds one journal entry (reference_type = 'expense', reference_id = expense.id); inserts into `journal_entries` and `journal_entry_lines`. |
| Commit | DB | If posting raises (e.g. period closed), whole transaction rolls back: no expense row and no JE. |

**Conclusion:** Ledger posting is **trigger-driven** and **DB-authoritative**. It happens only as a consequence of a successful INSERT into `expenses`, in the same transaction.

### Invariants enforced (period, immutability, attribution)

| Invariant | Where enforced | How |
|-----------|----------------|-----|
| **Period** | DB | BEFORE INSERT: expense date must fall in an open period (`assert_accounting_period_is_open`). BEFORE UPDATE/DELETE: expense date (OLD) must be in an open period. Posting function also calls period assert before writing JE. |
| **Immutability (document)** | DB | BEFORE UPDATE/DELETE: if a journal entry exists with reference_type = 'expense' and reference_id = expense.id, UPDATE and DELETE are blocked. |
| **Immutability (ledger)** | DB | Journal tables: triggers and REVOKE prevent UPDATE/DELETE on `journal_entries` and `journal_entry_lines`. |
| **Attribution** | DB | Each JE stores reference_type = 'expense', reference_id = expense.id, posting_source, date. |
| **One expense → one JE** | DB | Trigger and posting logic ensure at most one JE per expense (idempotency check before calling post). |

### Which layer is authoritative

| Question | Authoritative layer | Note |
|----------|---------------------|------|
| Whether an expense may be created for a given date | **DB** | Period check in DB (BEFORE INSERT and inside posting). API can return 400 when DB raises period error. |
| Whether an expense row may be updated or deleted | **DB** | Document immutability trigger blocks UPDATE/DELETE once a JE exists. |
| What gets posted to the ledger | **DB** | Only `post_expense_to_ledger` (trigger-invoked) writes JEs. API does not call posting. |
| Who may create expenses for a business | **API + RLS** | API checks membership; RLS enforces row-level access. |

**Conclusion:** **DB is authoritative** for period, posting, and document/ledger immutability. UI and API are not authoritative for those invariants.

---

## 2. Allowed vs forbidden OCR behavior

### OCR is ALLOWED to

| Action | Rationale |
|--------|-----------|
| **Suggest values before save** | Suggestions are not persisted until the user submits the form and the API performs the INSERT. No ledger impact until then. |
| **Pre-fill form fields** | Same as above: pre-fill is UI-only. User can change or clear values. Authority remains with the single INSERT when the user confirms. |
| **Attach receipt images** | Storing a receipt (e.g. `receipt_path`) is already supported. OCR can set the path after upload; it does not by itself create an expense or a JE. |
| **Mark fields as “OCR-suggested”** | Purely presentational. Helps user distinguish suggested vs manually entered data and reduces over-trust (see risk table). |

**Principle:** OCR acts as an **input aid** to the same, single path: one user-confirmed INSERT, then DB trigger posts once. No new path to the ledger.

### OCR is FORBIDDEN to

| Action | Why it would violate accounting invariants |
|--------|--------------------------------------------|
| **Create expenses automatically** | Automatic creation would bypass explicit user confirmation. Accountability and audit trail require a human decision to “create” the expense. Auto-creation could also create expenses in closed periods if date logic were wrong, undermining period authority. |
| **Post ledger entries** | Posting is reserved to the DB trigger on INSERT. Any other path that wrote JEs would bypass period checks, idempotency, and the one-expense-one-JE rule. Ledger would no longer be fully DB-authoritative. |
| **Modify existing expenses** | Posted expenses are immutable at the document layer. Modifying them would either (a) change data that is already reflected in an immutable JE (document–ledger divergence) or (b) require changing the JE (ledger mutation). Both are forbidden. |
| **Modify journal entries** | Ledger is append-only. Any UPDATE/DELETE on journal tables would break immutability and auditability. |
| **Bypass period checks** | Period control is DB-authoritative. Allowing creation or posting into a closed/locked period would break period close integrity and external reporting. |
| **Backdate silently** | Backdating (e.g. defaulting date to receipt date without clear user action) can push the expense into a closed period. Period check would then block INSERT—but silent backdating can confuse users and obscure the real reason for failure. Transparent date and explicit user confirmation preserve period authority. |
| **Reclassify accounts** | Expense account (e.g. 5100) and tax accounts are determined by posting logic from the expense row. OCR must not inject or change account classification; that remains a function of the canonical posting path and chart of accounts. |

**Principle:** OCR must not introduce a **second path** to creation or posting, and must not **mutate** existing expenses or ledger rows.

---

## 3. Ledger integrity analysis

### Can OCR weaken ledger immutability?

**Answer: No** — provided OCR does not post or modify ledger data.

- Ledger immutability is enforced in the DB (triggers and REVOKE on journal tables). OCR does not touch those tables.
- OCR only influences **input** to the expense form. The only way data reaches the ledger is: user submits → API INSERT → trigger → `post_expense_to_ledger`. That path is unchanged.
- **Failure mode if OCR did post or modify:** If OCR (or any non-trigger code) wrote or updated journal rows, the ledger would have entries not governed by the same period and idempotency rules, and could be updated/deleted, breaking immutability. **Mitigation:** Do not implement any OCR path that calls posting or touches journal tables.

### Can OCR affect reconciliation accuracy?

**Answer: No** — in the current design.

- Reconciliation is invoice/customer AR–based. Expenses are not in scope for that reconciliation.
- Expense JEs (Dr Expense, Cr Cash, tax accounts) do not hit AR. So OCR cannot introduce AR/reconciliation mismatches by itself.
- **Failure mode if expenses were later included in reconciliation:** If the reconciliation scope were extended to expenses, then incorrect OCR-suggested amounts or dates could, after user confirmation and posting, create expense JEs that disagree with external data. That would be a reconciliation design change, not an inherent OCR flaw, as long as OCR only suggests and does not post.

### Can OCR affect period close?

**Answer: No** — provided OCR does not bypass period checks.

- Period close readiness and close itself are driven by DB logic (e.g. unposted expenses in period, period status). OCR does not alter period status or readiness rules.
- If OCR suggests a date in a closed period and the user accepts it, the INSERT will still be blocked by the DB BEFORE INSERT trigger. So period authority holds.
- **Failure mode if OCR bypassed period check:** If OCR could create expenses or post JEs without going through the INSERT + trigger path, expenses could end up in closed periods, breaking period close integrity. **Mitigation:** No creation or posting outside the single INSERT → trigger path.

---

## 4. Risk classification

| Risk | Description | Severity | Mitigation |
|------|-------------|----------|------------|
| **Mis-dated receipts** | OCR or user picks wrong date (e.g. print date vs transaction date); expense posts into wrong period. | Medium | DB already blocks INSERT when date is in closed/locked period. UI should make date prominent and editable; consider “transaction date vs receipt date” guidance. Do not auto-default date without user confirmation. |
| **Incorrect tax extraction** | OCR misreads VAT/NHIL/GETFund; user accepts; wrong amounts post to tax accounts. | Medium | Treat OCR tax as suggestion only; user must confirm. Consider showing confidence or “review tax” for low-confidence extractions. Correction path remains new expense or adjustment JE, not edit of posted expense. |
| **Duplicate receipts** | Same receipt uploaded twice; two expenses and two JEs for one economic event. | Medium | Operational/process: duplicate detection (e.g. hash of image or key fields) before or after save is a UX/process control, not a ledger change. Ledger remains correct (two JEs for two rows); correction by adjustment if needed. |
| **OCR confidence errors** | Low-confidence values presented as if certain; user over-relies and submits wrong data. | Medium | Mark OCR-suggested fields clearly; require explicit user action to submit; optional confidence indicators or “review suggested values” step. |
| **User over-trusting OCR** | User accepts all suggestions without review; systematic errors (e.g. wrong supplier or total) enter ledger. | Medium | UX and policy: “OCR-suggested” labelling, mandatory review step, and accounting policy that user is responsible for verifying amounts and dates before submit. |

**Note:** None of these risks introduce a **new** ledger or period vulnerability if OCR is constrained to suggestion/pre-fill only and all creation/posting goes through the existing INSERT + trigger path. Severity is “medium” because they affect **correctness of what gets posted**, not the integrity of the posting mechanism itself.

---

## 5. Verdict

**SAFE IF CONSTRAINED** — OCR is acceptable under strict rules.

**Reasoning (accounting terms):**

- **Single path to the ledger:** The only path that creates expense rows and journal entries is: user-confirmed INSERT → DB trigger → `post_expense_to_ledger`. OCR does not add a second path provided it only suggests values and does not create expenses or post JEs.
- **DB remains authoritative:** Period, immutability, and attribution are enforced in the database. OCR does not bypass these checks as long as it does not call posting logic or modify expenses/JEs.
- **No ledger or period mutation:** OCR does not touch journal tables or period logic. It only influences the payload the user submits; the same invariants (period check on INSERT, document freeze after post, append-only ledger) continue to hold.
- **Risks are input-quality and process:** Mis-dates, wrong tax, duplicates, and over-trust affect *what* gets posted, not *whether* the system can post into closed periods or mutate the ledger. They are mitigated by UX (clear labelling, review step, editable fields) and policy (user responsibility to verify before submit), not by changing ledger or period rules.

**Condition:** OCR must be implemented as **suggestion and pre-fill only**. It must not create expenses automatically, post ledger entries, modify existing expenses or journal entries, bypass period checks, backdate silently, or reclassify accounts. Under that constraint, Option B is consistent with the current audit-grade expense and ledger model.

---

*End of audit. No code or schema changes. No implementation. For implementation or accounting policy, use a separate prompt or document.*
