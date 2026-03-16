# 🧪 FULL SYSTEM FORENSIC AUDIT — SERVICE MODE ACCOUNTING DATA FLOW

**Mode:** Black box, read-only, zero assumptions.  
**Scope:** Entire repository + database contracts.  
**Objective:** Determine why operational data (invoices, expenses, payments, ledger entries) exists in some layers but fails to consistently appear in Trial Balance, P&L, Balance Sheet, and accounting workspace reports.

---

## 1. EXECUTIVE FAILURE MAP

End-to-end data flow with identified breakpoints:

```
User Action (create invoice / expense / payment / send invoice)
    │
    ▼
API Route (POST create, PATCH send, etc.)
    │
    ├─► [BREAKPOINT A] Invoice create does NOT call ensureAccountingInitialized
    │   → First "create + send" can fail at DB if no period/CoA exists
    │
    ▼
Database write (invoices / expenses / payments)
    │
    ▼
Trigger (AFTER INSERT / UPDATE OF status)
    │
    ├─► [BREAKPOINT B] Invoice: posting only when status IN ('sent','paid','partially_paid')
    │   → Draft invoices NEVER post to ledger (by design)
    │
    ├─► [BREAKPOINT C] Payment: post_payment_to_ledger raises if invoice is draft (227)
    │   → Payment insert rolls back if linked invoice still draft
    │
    ├─► [BREAKPOINT D] Expense: post_expense_to_ledger runs on INSERT; assert_accounting_period_is_open
    │   → If period locked/soft_closed or missing, insert rolls back
    │
    ▼
post_*_to_ledger (post_invoice_to_ledger, post_expense_to_ledger, post_payment_to_ledger, etc.)
    │
    ├─► assert_accounting_period_is_open(business_id, posting_date) — does NOT create period
    ├─► get_control_account_code / get_account_by_code — requires Phase 13 bootstrap (CoA + control mappings)
    │
    ▼
post_journal_entry → INSERT journal_entries, journal_entry_lines
    │
    ▼
Trigger: invalidate_snapshot_on_journal_entry (247)
    │
    ├─► mark_trial_balance_snapshot_stale(business_id, date, 'journal_entry_insert')
    │   → [BREAKPOINT E] If NO period exists for posting date, invalidation is NO-OP (no snapshot row to mark)
    │   → [BREAKPOINT F] If snapshot never existed for that period, nothing is marked stale
    │
    ▼
Ledger storage (journal_entries, journal_entry_lines)
    │
    ▼
Report request (Trial Balance / P&L / Balance Sheet)
    │
    ├─► Accounting workspace: GET /api/accounting/reports/*?business_id=&period_start=
    │   → [BREAKPOINT G] period_start REQUIRED; if UI sends start_date/end_date only → 400
    │
    ├─► Legacy reports: GET /api/reports/* (no period_start) → resolve_default_accounting_period
    │   → [BREAKPOINT H] Resolver returns "latest OPEN with activity" or "current month fallback"
    │   → User viewing "current month" while all activity in previous month → empty report
    │
    ▼
get_trial_balance_from_snapshot(p_period_id)
    │
    ├─► If no snapshot OR snapshot.is_stale → generate_trial_balance(p_period_id, NULL)
    │   → Reads period_opening_balances + journal_entry_lines (je.date in period range)
    │   → [BREAKPOINT I] period_opening_balances may be empty for first period (opening = 0; OK)
    │   → [BREAKPOINT J] RLS on trial_balance_snapshots: INSERT/UPDATE must pass policy (owner/employee/firm)
    │
    ▼
Response → UI
    │
    ├─► [BREAKPOINT K] UI date-range mode on accounting Trial Balance sends start_date/end_date
    │   → API ignores them and requires period_start → 400 or wrong period
    │
    └─► [BREAKPOINT L] Zero-balance accounts: TB/P&L/BS return all accounts from snapshot;
        UI may filter/hide zero balances (presentation only)
```

**Where data can "disappear":**

| Layer | Data exists here? | Can disappear because of |
|-------|-------------------|---------------------------|
| Invoices / Expenses / Payments tables | Yes | N/A (source) |
| journal_entries / journal_entry_lines | No (if draft invoice; or posting failed) | B, C, D, or bootstrap/period assert |
| journal_entries / journal_entry_lines | Yes | N/A |
| trial_balance_snapshots | Stale or missing | E, F, J, or rebuild failure |
| Report API response | Empty or wrong period | G, H, K (period resolution / params) |
| UI | Empty | Same as above + L if UI hides zeros |

---

## 2. EVENT ORIGIN DISCOVERY

All code paths that can create financial impact (evidence from repo):

| Event | API / entry point | DB write | Trigger → post_* | When posting runs |
|-------|-------------------|----------|------------------|-------------------|
| **Invoice** | POST /api/invoices/create (status draft or sent), PATCH send | invoices | trigger_auto_post_invoice (AFTER INSERT OR UPDATE OF status) | Only when status becomes sent/paid/partially_paid from draft |
| **Payment** | POST /api/payments/create | payments | trigger_auto_post_payment (AFTER INSERT) | Every insert; fails if invoice draft (227) |
| **Expense** | POST /api/expenses/create | expenses | trigger_auto_post_expense (AFTER INSERT) | Every insert; period must be open (233) |
| **Credit note** | Create + status applied | credit_notes | trigger_auto_post_credit_note (AFTER INSERT OR UPDATE OF status) | When status = 'applied' |
| **Bill** | Status → open | bills | trigger_auto_post_bill | When status = 'open' |
| **Bill payment** | POST (bill_payments) | bill_payments | trigger_auto_post_bill_payment (AFTER INSERT) | Every insert |
| **Sale (POS)** | Sales/create, POS | sales | post_sale_to_ledger (called by app or trigger per migration history) | When sale is finalized |
| **Manual journal draft** | Post draft API | journal_entries (via post_manual_journal_draft_to_ledger) | Explicit RPC call | When user posts draft |
| **Opening balance** | Opening balances apply | opening_balance_imports | post_opening_balance_import_to_ledger (RPC) | When import posted |
| **Adjustment** | Adjustments apply | post_journal_entry via adjustment flow | RPC | When adjustment posted |
| **Refund / void** | Override APIs | post_sale_refund_to_ledger, post_sale_void_to_ledger | RPC | When refund/void applied |
| **Layaway** | Layaway flows | post_layaway_sale_to_ledger, post_layaway_payment_to_ledger | Per 197 | On completion |
| **Purchase order receipt** | PO receive | post_purchase_order_receipt_to_ledger | Per 198 | On receive |
| **Supplier payment** | Supplier payment | post_supplier_payment_to_ledger | Per 198 | On payment |

**Service-mode relevant:** Invoices (create/send), expenses (create), payments (create). All three depend on accounting being initialized (CoA + control mappings + at least one open period) and, for invoice, on status not staying draft.

---

## 3. LEDGER WRITE VERIFICATION

| Event | Always produces JE? | Conditional? | Async/sync | Can silently fail? | Idempotent? | Date alignment |
|-------|---------------------|-------------|------------|--------------------|------------|----------------|
| Invoice | No | Yes: only when status sent/paid/partially_paid | Sync (trigger) | No (raise → rollback) | Yes (checks existing JE) | issue_date or sent_at |
| Payment | Yes (if invoice not draft) | Yes: draft invoice → raise | Sync | No (218 fail-fast) | Yes | payment date |
| Expense | Yes (if period open) | Yes: period locked → raise | Sync | No | Yes | expense date |
| Credit note | Yes when applied | Yes: status = applied | Sync | No | Yes | Applied date |

- **Posting is synchronous** in all cases (trigger or same-transaction RPC).  
- **Silent failure:** Historically payment trigger swallowed errors (073/075); migration **218** restores fail-fast. Invoice/expense triggers do not swallow.  
- **Idempotent:** All post_* check for existing journal entry by reference_type/reference_id before posting.  
- **Date alignment:** Journal entry uses operational date (issue_date, payment date, expense date). Reports use accounting period (period_start–period_end). If JE date falls inside period, it is included in `generate_trial_balance` (247: `je.date >= period_record.period_start AND je.date <= period_record.period_end`).

---

## 4. STORAGE CONSISTENCY CHECK

- **journal_entries:** Has business_id, date, reference_type, reference_id. Period is implied by date (no period_id column).  
- **journal_entry_lines:** Links to journal_entry_id, account_id, debit, credit. Joins in generate_trial_balance use `je.business_id` and `je.date` for period scope.  
- **Account mapping:** post_* use get_control_account_code(business_id, 'AR'|'CASH'|'BANK'|…) and get_account_by_code (e.g. 4000 revenue). Requires Phase 13 bootstrap (ensure_accounting_initialized → initialize_business_chart_of_accounts + control mappings).  
- **business_id consistency:** All posting and report paths filter by business_id (tenant isolation).  
- **period_opening_balances:** Used as opening balance source in generate_trial_balance. Can be empty for first period (opening = 0). Rollforward and manual bootstrap populate it.

---

## 5. DATA AGGREGATION PIPELINE DISCOVERY

| Layer | What | Used by |
|-------|------|--------|
| **Canonical snapshot table** | trial_balance_snapshots (period_id, business_id, snapshot_data JSONB, is_stale, last_rebuilt_at, …) | get_trial_balance_from_snapshot |
| **Reporting RPCs** | get_trial_balance_from_snapshot(p_period_id), get_profit_and_loss_from_trial_balance(p_period_id), get_balance_sheet_from_trial_balance(p_period_id) | Accounting and legacy report APIs |
| **Snapshot build** | generate_trial_balance(p_period_id, p_generated_by) — reads period_opening_balances + journal_entry_lines for period date range, writes/upserts trial_balance_snapshots | get_trial_balance_from_snapshot when snapshot missing or stale |
| **Invalidation** | mark_trial_balance_snapshot_stale(business_id, posting_date, reason); trigger on journal_entries AFTER INSERT | Ensures next report load rebuilds for that period |
| **Cached reporting tables** | trial_balance_snapshots only (no other cached report tables in scope) | — |
| **In-memory aggregation in API** | None; APIs return RPC result with optional grouping (byType) and totals | — |
| **UI client-side filtering** | Possible filtering of zero balances or pagination (not fully audited per component) | — |

P&L and Balance Sheet do **not** read invoices/expenses/payments directly; they read from Trial Balance snapshot only (get_profit_and_loss_from_trial_balance and get_balance_sheet_from_trial_balance call get_trial_balance_from_snapshot).

---

## 6. PERIOD RESOLUTION PATH ANALYSIS

| Consumer | How period is chosen | Logic |
|----------|----------------------|--------|
| **Accounting reports** (TB, P&L, BS) | Client sends period_start (YYYY-MM-01 style) | From period dropdown; API requires period_start, else 400 |
| **Accounting Trial Balance page** | selectedPeriodStart OR start_date/end_date (useDateRange) | **Gap:** API ignores start_date/end_date and requires period_start → date-range mode can 400 or not match |
| **Legacy reports** (/api/reports/trial-balance, balance-sheet) | No period_start → resolve_default_accounting_period(business_id) | 1) Latest OPEN with activity 2) Latest SOFT_CLOSED with activity 3) Latest LOCKED with activity 4) ensure_accounting_period(current_date) |
| **Reports Balance Sheet / P&L pages** | from_date (from asOfDate/month) → GET /api/accounting/periods/resolve?from_date= | Resolve finds period containing from_date; else ensure_accounting_period(from_date); then calls /api/accounting/reports/* with period_start |
| **Portal accounting page** | from_date / to_date, month picker → periods/resolve | Same resolve then accounting report APIs |

**Implicit defaults:** resolve_default_accounting_period returns "current month" if no period has journal activity. So a user opening legacy reports without a date can see **current month** (empty) while all activity is in a previous month → **period resolution / UX failure**.

**Missing parameter fallbacks:** Accounting report routes return 400 if period_start is missing; no server-side default.

---

## 7. REPORT CONSUMPTION TRACE

- **Report UI** → **API route** (accounting or reports) → **RPC** get_trial_balance_from_snapshot (and P&L/BS wrappers) → **Snapshot or rebuild:** read trial_balance_snapshots; if missing or is_stale then generate_trial_balance → **Data transformation** (byType, totals in API; P&L/BS filter by account type) → **Response**.

- **Ledger list:** Reads journal_entries + journal_entry_lines directly (no snapshot). So ledger can show entries even when reports show empty (different data path).

Stages that can drop or misrepresent data:
- **Filter valid data:** get_trial_balance_from_snapshot returns all accounts in snapshot_data; no filtering of valid data. generate_trial_balance iterates all accounts (for business) and sums journal_entry_lines for period; no intentional drop.
- **Mis-group accounts:** P&L filters income/expense; BS filters asset/liability/equity. Correct by design.
- **Drop zero balances:** Snapshot includes all accounts with opening + period activity; zeros are included. UI may hide them (presentation).
- **Tenant scope:** All RPCs and APIs use business_id from period or request; tenant isolation enforced.
- **Stale cache:** Snapshot is marked stale on journal insert; next report load triggers rebuild. If invalidation no-op (no period/snapshot yet), first report for that period will still call generate_trial_balance when snapshot is missing.

---

## 8. MULTI-TENANT DATA ISOLATION AUDIT

- **Report APIs:** business_id from query param or getCurrentBusiness; checkAccountingAuthority(supabase, user.id, businessId, "read").  
- **RPCs:** get_trial_balance_from_snapshot resolves business_id from period_id (accounting_periods); generate_trial_balance uses period_record.business_id; mark_trial_balance_snapshot_stale uses p_business_id.  
- **RLS:** trial_balance_snapshots has read/insert/update policies (owner or business_users admin/accountant or firm). journal_entries/journal_entry_lines subject to RLS where defined.  
- **Unsafe joins:** No cross-business joins identified in report path.  
- **Period reuse across tenants:** period_id is per business (accounting_periods.business_id).

---

## 9. CACHE AND SNAPSHOT BEHAVIOR

- **Invalidation:** Trigger on journal_entries (AFTER INSERT) calls mark_trial_balance_snapshot_stale(business_id, date, 'journal_entry_insert'). Only updates **existing** snapshot row for the period that contains that date; if period or snapshot doesn’t exist, no-op.  
- **Rebuild:** get_trial_balance_from_snapshot calls generate_trial_balance if snapshot NOT FOUND or is_stale = TRUE. Rebuild is on-demand (on report request).  
- **Background refresh:** None; no cron/job that rebuilds snapshots.  
- **Stale detection:** is_stale column; last_ledger_change_at and stale_reason for audit.  
- **Concurrency:** generate_trial_balance uses pg_advisory_xact_lock(lock_key) to prevent concurrent rebuilds for same period; after lock, re-checks for fresh snapshot.  
- **Memoized API responses:** No explicit response caching in API layer.  
- **UI caching:** Possible (e.g. React state); not fully traced. If data exists but is masked by stale layers, the only cache layer in the data path is trial_balance_snapshots; rebuild on next load should fix it unless rebuild fails (e.g. RLS, or exception in generate_trial_balance).

---

## 10. CONTRACT MISMATCH DETECTION

- **API vs RPC:** Accounting report APIs pass period_id from period_start lookup; RPCs expect p_period_id (UUID). Consistent.  
- **Legacy reports:** Return resolved period info (resolved_period_status, resolved_period_reason); accounting report APIs do not. Different response shape but not a correctness issue.  
- **Balance sheet page:** Maps API response (account_id, code, name, type, balance) to internal (id, code, name, type, balance). Uses account_id as id when present.  
- **Trial Balance accounting page:** Can send start_date/end_date when useDateRange is true; API does not accept them and requires period_start → **contract mismatch**: UI sends params API ignores; can result in 400 or wrong period.  
- **Field names:** Snapshot returns debit_total, credit_total, closing_balance; APIs and UI use consistent names. No observed JSON shape drift in report path.

---

## 11. UI AND PRESENTATION FILTER AUDIT

- **Accounting Trial Balance page:** Builds URL with period_start or start_date/end_date; when date range is used without period_start, API requirement can cause 400 or no data.  
- **Period selector:** Default selectedPeriodStart not set from "latest with activity" automatically in code path audited; user may see no period selected → no request or wrong period.  
- **Zero balance:** Snapshot includes zeros; UI may optionally hide zero rows (not confirmed in every report component).  
- **Pagination:** Report APIs return full account list for period; no server-side pagination that could truncate.  
- **State caching:** If user never refreshes after posting, UI could show pre-post state until refetch; not a data-layer bug but can look like "data not showing."

---

## 12. ROOT CAUSE CLASSIFICATION

| # | Breakpoint | Classification | Severity | Probability |
|---|------------|----------------|----------|-------------|
| A | Invoice create doesn’t call ensureAccountingInitialized | Posting failure (bootstrap not guaranteed before first post) | HIGH | Edge case (first send) |
| B | Invoice posts only when status sent/paid/partially_paid | Posting failure (by design; draft never posts) | MEDIUM | Always for drafts |
| C | Payment posts only if invoice not draft | Posting failure | MEDIUM | When payment on draft invoice |
| D | Expense post requires open period | Posting failure | HIGH | When period closed/locked |
| E, F | Invalidation no-op when no period/snapshot | Cache/snapshot failure (stale not set) | LOW | When period/snapshot not yet created |
| G | Accounting API requires period_start | Period resolution failure / API contract | HIGH | When client sends date range only |
| H | resolve_default_accounting_period → current month when no activity | Period resolution failure | CRITICAL | When user expects "latest with data" |
| I, J | period_opening_balances empty; RLS on snapshot | Aggregation / tenant (RLS) | LOW–MEDIUM | First period; or permission edge cases |
| K | Trial Balance page date-range vs period_start | API contract failure / UI | MEDIUM | When user uses date range |
| L | Zero balance filtering in UI | UI filtering failure | LOW | Cosmetic |

---

## 13. DEFECT SEVERITY

- **CRITICAL:** Default period resolution showing current month when all activity is in another period (H) — financial reporting integrity risk.  
- **HIGH:** Bootstrap not guaranteed before first invoice send (A); expense in closed period (D); accounting API period_start required while UI can send date range (G).  
- **MEDIUM:** Draft invoice never posting (B); payment on draft blocked (C); Trial Balance date-range vs period_start (K).  
- **LOW:** Invalidation no-op for new period (E, F); zero balance display (L); RLS edge cases (J).

---

## 14. FAILURE PROBABILITY

| Defect | Always | Intermittent | Edge case | Data dependent | Time dependent |
|--------|--------|--------------|------------|----------------|----------------|
| A | | | ✓ First send without prior accounting open | | |
| B | ✓ Drafts never post | | | | |
| C | | | ✓ Payment on draft | | |
| D | | | ✓ Post in closed period | | |
| E, F | | | ✓ New period | | |
| G | | | ✓ Date-range usage | | |
| H | | | | ✓ No activity in any period | ✓ Current month vs last month |
| K | | | ✓ Use date range on TB | | |

---

## 15. FIX STRATEGY PROPOSALS (REMEDIATION ONLY; NO CODE CHANGES IN THIS AUDIT)

- **A (Bootstrap before first post):** Safest minimal: Call ensureAccountingInitialized in invoice create (and/or send) before insert/update so period and CoA exist. Invariant-safe: bootstrap is idempotent. Backward compatible.  
- **B (Draft never posts):** By design; no fix unless product changes to support "post draft" (not recommended). Document clearly.  
- **C (Payment on draft):** By design; keep fail-fast. Document.  
- **D (Expense period):** Keep assert; return clear PERIOD_CLOSED to UI (already done in expense create).  
- **E, F (Invalidation no-op):** Acceptable; first report load still triggers generate_trial_balance when snapshot missing. Optional: document that invalidation only affects existing snapshots.  
- **G (period_start required):** Either (1) Accounting API: accept start_date/end_date and resolve to period_id server-side (invariant-safe, one source of truth), or (2) UI: never send date range without resolving to period_start first (e.g. call periods/resolve then pass period_start). Backward compatible if additive.  
- **H (Default period):** Prefer "latest period with journal activity" over "current month" when no as_of_date provided; align legacy reports with resolve_default_accounting_period already returning that first. Concurrency-safe (read-only resolver).  
- **K (TB date range):** Align UI with API: either API accepts date range and resolves period, or UI always resolves to period_start before calling TB API.  
- **J (RLS):** Ensure report-running user has insert/update on trial_balance_snapshots (owner/employee/firm policies already in 239); fix any role that can read but not write snapshot.  
- **L (Zero balance):** Optional UI setting to show/hide zero balances; no change to canonical data.

---

## 16. CORRELATION TEST (LOGICAL SCENARIOS)

**Scenario 1: Create invoice (draft) → Create payment → Create expense**  
- Invoice: in DB, no JE (B).  
- Payment: post_payment_to_ledger raises (draft invoice) → payment insert rolls back (C).  
- Expense: in DB + JE if period open (D).  
- **Where data exists:** invoices row; expenses row + journal; no payment row.  
- **Where it disappears:** Payment never persists. Invoice not in reports (no JE). Expense in ledger and in report for that period.

**Scenario 2: Create invoice (sent) without ever opening Accounting**  
- If ensure_accounting_initialized never ran: no period or no control mapping. post_invoice_to_ledger calls assert_accounting_period_is_open → raises → insert rolls back (A).  
- **Where data exists:** Nowhere (transaction rolled back).  
- **Where it disappears:** Entire invoice create fails with 500.

**Scenario 3: Create invoice (sent), expense, payment; open Trial Balance with wrong period**  
- All three post; JEs in ledger. User opens TB and selects a period that has no activity (e.g. next month).  
- **Where data exists:** Ledger (all JEs); snapshot for the period that contains the JE dates.  
- **Where it disappears:** Visibility only — user is looking at another period (G/H/K).

**Scenario 4: Post expense; open report immediately; snapshot was never created for that period**  
- Invalidation runs but no snapshot row exists (E, F). get_trial_balance_from_snapshot finds no row → calls generate_trial_balance → builds snapshot from journal_entry_lines → returns data.  
- **Where data exists:** Ledger; after first report load, snapshot too.  
- **Conclusion:** No disappearance; on-demand rebuild covers this.

---

## 17. SUMMARY: WHY DATA IS VISIBLE IN SOME SURFACES BUT NOT ALL

- **Ledger list** reads journal_entries directly → shows all posted JEs regardless of period/snapshot.  
- **Trial Balance / P&L / Balance Sheet** read from trial_balance_snapshots (via get_trial_balance_from_snapshot), keyed by **period**.  
So:

1. **Wrong period:** User sees a period with no activity (e.g. default "current month" or wrong dropdown) → reports empty while ledger has data.  
2. **Posting never ran:** Invoice still draft (B), or payment on draft (C), or expense in closed period (D), or first send without bootstrap (A) → no JEs for those operations; ledger and reports both missing that data.  
3. **API/UI contract:** UI sends start_date/end_date or no period; API requires period_start → 400 or wrong period (G, K).  
4. **Snapshot rebuild failure:** Rare (RLS or exception in generate_trial_balance) → report could error or show old snapshot; invalidation would have marked stale, so next successful load would rebuild.

**Component responsible for "data in ledger but not in reports":** Almost always **period resolution** (user or default viewing a period that doesn’t contain the JE dates) or **parameter mismatch** (period_start not sent or overridden by date range). The snapshot pipeline (invalidate on insert, rebuild on read when missing/stale) is designed so that once data is in the ledger and the correct period is requested, it appears in the report.

---

*End of forensic report. No code or schema was modified; all findings are evidence-based from repository and migration content.*
