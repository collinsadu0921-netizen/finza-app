# Canonical Posting Engine — Feasibility Audit

**Scope:** Evaluate replacing `post_manual_journal_draft_to_ledger` (and other flow-specific RPCs) with a single canonical `post_journal_entry` engine used by all flows: invoices, adjustments, manual journals, contributions, opening balances, payroll.

**Constraints:** Audit only. No implementation. No refactor suggestions. Critical assessment.

---

## 1. RPCs that insert into `journal_entries`

| RPC | Inserts via | Calls post_journal_entry? |
|-----|-------------|---------------------------|
| **post_journal_entry** | Direct INSERT (journal_entries + journal_entry_lines) | — (is the engine) |
| **post_invoice_to_ledger** | Via post_journal_entry | Yes |
| **post_invoice_payment_to_ledger** | Via post_journal_entry | Yes |
| **post_payment_to_ledger** | Via post_journal_entry | Yes |
| **post_expense_to_ledger** | Via post_journal_entry | Yes |
| **post_credit_note_to_ledger** | Via post_journal_entry | Yes |
| **post_bill_to_ledger** | Via post_journal_entry | Yes |
| **post_bill_payment_to_ledger** | Via post_journal_entry | Yes |
| **post_sale_to_ledger** | Via post_journal_entry | Yes |
| **post_sale_refund_to_ledger** | Via post_journal_entry | Yes |
| **post_sale_void_to_ledger** | Via post_journal_entry | Yes |
| **post_supplier_payment_to_ledger** | Via post_journal_entry | Yes |
| **apply_adjusting_journal** | Via post_journal_entry | Yes |
| **post_reconciliation_journal_entry** | Via post_journal_entry | Yes |
| **post_manual_journal_draft_to_ledger** | Direct INSERT | **No** |
| **post_opening_balance_import_to_ledger** | Direct INSERT | **No** |
| **post_adjustment_to_ledger** | Direct INSERT (also writes accounting_adjustments) | **No** |
| **post_asset_purchase_to_ledger** | Direct INSERT | No |
| **post_depreciation_to_ledger** | Direct INSERT | No |
| **post_asset_disposal_to_ledger** | Direct INSERT | No |
| **post_payroll_to_ledger** | Direct INSERT | No |
| **post_stock_transfer_to_ledger** | Via post_journal_entry (migration 196) | Yes |

---

## 2. API routes that result in inserts into `journal_entries`

| Route / trigger | RPC invoked |
|-----------------|-------------|
| POST `/api/accounting/journals/drafts` (owner create-and-post) | post_manual_journal_draft_to_ledger |
| POST `/api/accounting/journals/drafts/[id]/post` | post_manual_journal_draft_to_ledger |
| POST `/api/accounting/opening-balances/[id]/post` | post_opening_balance_import_to_ledger |
| POST `/api/accounting/adjustments/apply` | apply_adjusting_journal → post_journal_entry |
| Invoice send / trigger | post_invoice_to_ledger → post_journal_entry |
| POST `/api/sales/create` | post_sale_to_ledger → post_journal_entry |
| POST `/api/override/void-sale` | post_sale_void_to_ledger |
| Expense create (trigger) | post_expense_to_ledger |
| Payment / invoice payment (trigger) | post_invoice_payment_to_ledger / post_payment_to_ledger |
| Credit note applied (trigger) | post_credit_note_to_ledger |
| POST `/api/assets/create` | post_asset_purchase_to_ledger |
| POST `/api/assets/[id]/depreciation` | post_depreciation_to_ledger |
| POST `/api/payroll/runs/[id]` (approve) | post_payroll_to_ledger |
| POST `/api/stock-transfers/[id]/receive` | post_stock_transfer_to_ledger |
| Reconciliation resolve | post_reconciliation_journal_entry |
| Accounting reversal | post_journal_entry (direct from route) |

---

## 3. Generic posting RPC

**Yes.** `post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN)` exists and is the shared engine for:

- Invoice, payment, expense, credit note, bill, bill payment, sale/refund/void, supplier payment
- Adjustment (via `apply_adjusting_journal` which builds payload and calls it)
- Reconciliation (via `post_reconciliation_journal_entry` which calls it)

It does **not** currently:

- Set or accept `source_type`, `source_id`, `source_draft_id`, `source_import_id`, `input_hash`, `accounting_firm_id`, `posted_by`
- Implement hash-based idempotency
- Enforce “first open period only” or “no other JEs in period”
- Enforce owner-mode vs firm-mode auth (it uses `posted_by_accountant_id` / system owner)

So it is **generic for reference_type-based, period + balance + revenue–guarded posting**, but **not** for draft/import-style flows that use `source_type` and `input_hash`.

---

## 4. Path comparison

### Invoice posting

- **Entry:** `post_invoice_to_ledger(p_invoice_id, ...)`
- **Idempotency:** Skip if JE exists with `reference_type = 'invoice'`, `reference_id = p_invoice_id`, and AR account line.
- **Validation:** Period open (`assert_accounting_period_is_open`), AR/revenue accounts exist, invoice not draft for revenue.
- **Write:** Builds lines (AR, revenue, tax), calls `post_journal_entry(..., reference_type := 'invoice', reference_id := p_invoice_id, ...)`.
- **journal_entries columns:** reference_type, reference_id, period_id, posting_source, created_by, posted_by_accountant_id. **source_type / source_id / input_hash:** not set (NULL).

### Adjustment posting

- **Entry:** `apply_adjusting_journal(...)` → `post_journal_entry(..., reference_type := 'adjustment', reference_id := NULL, is_adjustment := TRUE, ...)`.
- **Idempotency:** None; each apply creates a new JE.
- **Validation:** Period open or soft_closed (not locked), entry_date in period, ≥2 lines, balance, adjustment_reason. Then audit row in `accounting_adjustment_audit`.
- **Write:** Via post_journal_entry. **source_type:** not set (NULL).

### Manual journal (draft) posting

- **Entry:** `post_manual_journal_draft_to_ledger(p_draft_id, p_posted_by)`.
- **Idempotency:** If draft.journal_entry_id set and JE exists → return it. Else compute `input_hash` (digest of canonical payload); if JE with same `source_type = 'manual_draft'` and `input_hash` exists → link draft to it and return.
- **Validation:** Draft status = approved, period not locked, owner-mode (owner of business) or firm-mode (active engagement, access_level = approve).
- **Write:** **Direct INSERT** into journal_entries with: source_type = 'manual_draft', source_id, source_draft_id, input_hash, accounting_firm_id, period_id, created_by, posted_by. Then INSERT lines. **Does not call post_journal_entry.**

### Opening balance posting

- **Entry:** `post_opening_balance_import_to_ledger(p_import_id, p_posted_by)`.
- **Idempotency:** If import.journal_entry_id set and JE exists → return. Else compute `input_hash`; if JE with same `source_type = 'opening_balance'` and `input_hash` exists → link import and return.
- **Validation:** Import status = approved, period not locked, **period must be first open period**, **no other JEs in that period** (only opening_balance), firm engagement with approve access.
- **Write:** **Direct INSERT** with source_type = 'opening_balance', source_import_id, input_hash, accounting_firm_id, period_id, posted_by, etc. **Does not call post_journal_entry.**

---

## 5. Duplicate logic, divergent validation, source_type / reference_type coupling

### Duplicate posting logic

- **Period check:** Every path enforces “period allows posting” but in different ways: `assert_accounting_period_is_open(business_id, date)` (invoice, expense, payment, asset, payroll, etc.), or inline “status != 'locked'” (manual draft, opening balance), or “open or soft_closed” (adjustment).
- **Balance check:** post_journal_entry validates SUM(debit) = SUM(credit) and uses batch INSERT for lines; manual/opening build lines and insert in a loop; asset/payroll use single multi-row INSERT. Logic is repeated, not shared.
- **Idempotency:** Implemented per flow: invoice = “existing JE by reference_type + reference_id + AR line”; manual/opening = “existing JE by source_type + input_hash”; adjustment = none; reconciliation = proposal_hash + deterministic reference_id.

### Divergent validation logic

- **Revenue:** Only post_journal_entry (and thus invoice/credit-note/sale paths) enforces “revenue only on issued invoice or explicit revenue correction.”
- **Adoption boundary:** Only post_journal_entry checks `accounting_start_date` and blocks operational posting before that date (opening_balance/backfill allowed).
- **Adjustment:** Only apply_adjusting_journal allows soft_closed periods and requires adjustment_reason and audit row.
- **Opening balance:** Only that RPC enforces “first open period” and “no other JEs in period.”
- **Manual draft:** Only that RPC does owner vs firm authorization (owner_id vs firm_client_engagements + access_level).
- **Line format:** post_journal_entry expects lines with `account_id`, `debit`, `credit`, `description`. Adjustment uses same. Manual draft and opening balance use same shape but are built from draft/import rows; post_adjustment_to_ledger (legacy) uses account_code, debit_amount, credit_amount.

### source_type / reference_type coupling

- **journal_entries** has both:
  - **reference_type / reference_id:** Used by post_journal_entry and all callers (invoice, payment, adjustment, asset, payroll, etc.).
  - **source_type / source_id / source_draft_id / source_import_id / input_hash:** Used only by post_manual_journal_draft_to_ledger and post_opening_balance_import_to_ledger. CHECK constraint allows source_type IN ('proposal', 'adjustment', 'manual_draft', 'opening_balance') or NULL.
- Rows created by post_journal_entry have **source_type = NULL**. Rows created by manual_draft and opening_balance RPCs set **source_type** and the corresponding source_* and input_hash columns.
- So two parallel taxonomies: “reference” (operational and adjustment) vs “source” (draft/import with hash idempotency). Unifying would require either overloading reference_* for draft/import or extending post_journal_entry to set source_* and input_hash and to enforce hash-based idempotency and first-period rules where needed.

---

## 6. Complexity assessment

**Assessment: HIGH**

- **Architecturally:** The system is **not** aligned on a single engine. Two distinct patterns exist:
  1. **post_journal_entry** path: reference_type/reference_id, period_id, posting_source, adoption + revenue guards; no source_type/source_* / input_hash.
  2. **Direct INSERT** path: manual_draft and opening_balance use source_type, source_draft_id/source_import_id, input_hash, period_id, accounting_firm_id, posted_by; idempotency and “first period only” / “no other JEs” are flow-specific.
- Asset and payroll also bypass post_journal_entry and use direct INSERT with reference_type/reference_id/posting_source only (no source_type). So “canonical engine” today is used for most operational and adjustment flows but explicitly **not** for manual draft, opening balance, asset, or payroll.

---

## 7. Estimated files impacted

- **Migrations:** 20+ files define or replace post_journal_entry, post_manual_journal_draft_to_ledger, post_opening_balance_import_to_ledger, post_adjustment_to_ledger, apply_adjusting_journal, post_asset_*, post_payroll_to_ledger, post_reconciliation_journal_entry, and related helpers. Any move to a single engine would touch many of these.
- **API routes:** At least 8–10 route files call posting RPCs (drafts, drafts/[id]/post, opening-balances/[id]/post, adjustments/apply, sales/create, void-sale, assets/create, assets/[id]/depreciation, payroll/runs/[id], stock-transfers/[id]/receive, reconciliation/resolve, reversal).
- **Tests:** Invoice issuance idempotency, send-ar-posting, draft-invoice-accounting, expense-posting, opening-balance posting/idempotency/period-lock/duplicate-protection, manual journal draft posting, period posting-block, ledger-immutability, revenue-recognition. Unifying engine would require regression coverage across all of these.

---

## 8. Can existing posting logic be unified without breaking invariants?

**Not without a major redesign.**

- **Invariants at risk if unified naively:**
  - **Period locking:** Manual/opening use “not locked”; adjustment uses “open or soft_closed”; others use “open” only. Putting everything through one entry point would require the engine to accept a “period policy” (open only / open or soft_closed / first open only and no other JEs) and enforce it correctly for each caller.
  - **Idempotency:** Hash-based (manual, opening) vs reference-based (invoice, reconciliation) vs none (adjustment). A single engine would need to support multiple idempotency modes and ensure no path can create duplicates or drop required deduplication.
  - **Authorization:** Owner vs firm vs system is currently enforced only in post_manual_journal_draft_to_ledger (and similarly in opening balance for firm). Moving to a single engine would require passing or resolving “who is posting” and “allowed for this business/firm” into one place without weakening checks.
  - **Audit:** apply_adjusting_journal writes accounting_adjustment_audit; post_adjustment_to_ledger writes accounting_adjustments. Manual and opening do not write separate audit tables but do update draft/import rows. Unification must preserve or replicate these behaviors.
- **Schema:** post_journal_entry does not write source_type, source_draft_id, source_import_id, input_hash, accounting_firm_id, posted_by. Unifying would require extending the engine’s signature and INSERT list (and possibly RLS/audit expectations) for those columns. Downstream reporting or constraints that assume “source_type NOT NULL ⇒ manual_draft or opening_balance” would need to remain valid.

---

## 9. Risks (period locking, idempotency, RLS, audit)

| Risk | Detail |
|------|--------|
| **Period locking** | Different rules per flow (open only / open or soft_closed / first open only). Unifying into one engine without explicit “period policy” per call could allow posting into the wrong period or block valid posting. |
| **Idempotency** | Hash-based and reference-based strategies differ. Merging into one engine risks double posts (if hash/reference checks are skipped or wrong) or broken idempotency (if one strategy overwrites the other). |
| **RLS** | Posting is SECURITY DEFINER; RLS on journal_entries mainly affects reads. Changing which RPC writes which rows could affect visibility if RLS keys off reference_type/source_type or business_id/firm. |
| **Audit** | adjustment_audit and accounting_adjustments tables are written by specific RPCs. Moving their logic into a shared engine requires ensuring the same (or equivalent) audit rows are still written and that manual/opening “link draft/import to JE” behavior is preserved. |
| **Revenue and adoption** | post_journal_entry enforces revenue recognition and accounting_start_date. Manual and opening flows do not. Routing them through post_journal_entry would require explicit “skip revenue/adoption checks” or equivalent so that manual/opening do not accidentally trigger those guards. |

---

## 10. Deliverables summary

| Item | Result |
|------|--------|
| **Complexity** | **HIGH** |
| **Estimated files impacted** | 20+ migrations, 8–10 API routes, 10+ test files |
| **Unification without breaking invariants** | **No.** Requires major redesign: extend post_journal_entry (or introduce shared core) with source_* / input_hash, multiple period policies, multiple idempotency modes, and preserved auth/audit per flow. |
| **Risks** | Period rules, idempotency strategies, RLS visibility, audit tables, revenue/adoption guards. |

No implementation suggestions. No optimism bias. Audit only.
