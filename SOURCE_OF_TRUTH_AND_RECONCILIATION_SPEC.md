# Source of Truth, Tolerance, Reconciliation Engine, Impact, and Transition

**SPECIFICATION AND DESIGN ONLY — NO CODE. EXPLICIT DECISIONS.**

---

## 1. Source of Truth Matrix

| Row (Concept) | UI / API / Report context | Current source | Desired source | Reason |
|---------------|---------------------------|----------------|----------------|--------|
| **Invoice balance / outstanding** | Invoice view (remaining balance), invoice list (outstanding column), pay form max | Operational (invoices.total − payments − credit_notes) | **Ledger** (AR balance for that invoice from journal_entry_lines) | Accounting correctness: posted AR is the legal record. Display and validation must match what is in the books. |
| **Invoice balance / outstanding** | Mark-paid API, payments create API, credit-note create/apply API (balance validation) | Operational | **Ledger** | Same: validation must forbid overpay/over-credit vs actual AR. |
| **Customer outstanding** | Customer 360 view, customer list/detail totals | Operational (sum of per-invoice inv.total − paid − credits) | **Ledger** (sum of AR balances by customer from journal_entry_lines) | Accounting correctness: customer-level AR must match ledger. |
| **Dashboard KPIs** | Dashboard page (outstanding, overdue, total invoiced, total outstanding, collected) | Operational | **Ledger** (for outstanding/overdue); **operational** (for “total invoiced” and “collected” if defined as document totals) | Outstanding/overdue: must match ledger. “Total invoiced” and “collected” are UX aggregates; decision: **ledger** for all money amounts so KPIs reconcile with reports. |
| **Aging report** | Aging report (balance per invoice, buckets, customer subtotals) | Ledger (when unblocked: AR from journal_entry_lines) | **Ledger** | Already ledger-based in design. Keep ledger as source. |
| **Customer statement** | Customer statement API and page (total invoiced, total paid, total credits, total outstanding) | Operational | **Ledger** (for outstanding); **operational** for line-level invoice/payment/credit detail; **ledger** for summary totals | Legal/compliance: statement totals must match books. Line detail can stay operational for narrative; summary totals must be ledger-derived. |
| **Period close validation** | Period-close flow (pre-close checks) | N/A (no reconciliation today) | **Ledger** (plus reconciliation engine comparing ledger vs operational) | Accounting correctness: period close is only valid if trial balance balances and AR reconciles. |
| **Audit / compliance export** | Exports for accountant, auditor, or regulator (e.g. trial balance CSV/PDF, GL, statement totals) | Ledger for TB/GL/P&amp;L/BS; operational for statement/360 | **Ledger** for all financial totals and balances | Legal/audit: exports must reflect ledger only. No operational-derived totals in audit exports. |

**Explicit decisions (no “maybe”, no “both”):**

- **Invoice balance / outstanding:** Desired = **Ledger**. Everywhere it is shown or used for validation.
- **Customer outstanding:** Desired = **Ledger**.
- **Dashboard KPIs (money amounts):** Desired = **Ledger**.
- **Aging report:** Desired = **Ledger** (already so when implemented).
- **Customer statement:** Desired = **Ledger** for summary totals; line detail may remain operational for narrative only.
- **Period close validation:** Desired = **Ledger** (and reconciliation result).
- **Audit / compliance export:** Desired = **Ledger** for all financial totals and balances.

---

## 2. Reconciliation Tolerance Rules

**Per-invoice balance mismatch**

- **Allowed tolerance:** **0.01** (one cent) when used for display or “soft” checks.
- **When it applies:** Real-time UI (e.g. “remaining balance” on invoice view), report load (e.g. invoice list outstanding), manual audit.
- **Action when breached:**  
  - **Report load / UI:** **Warn** in UI (“Balance may not match ledger; contact support”), **log** variance. Do not block viewing.  
  - **Manual audit:** **Log** and include in variance list; no block.  
  - **Period close:** See per-period rule; period close uses its own threshold.

**Per-invoice balance mismatch — strict (period close / validation)**

- **Allowed tolerance:** **0** when used to allow or block a payment, credit, or period close.
- **When it applies:** Payments create, credit-note create/apply, mark-paid, and period-close reconciliation.
- **Action when breached:** **Block** the operation (payment/credit/period close) and return a clear error (“Ledger balance does not match operational balance; resolve before proceeding”).

**Per-customer AR mismatch**

- **Allowed tolerance:** **0.01** for display and reporting.
- **When it applies:** Customer 360, customer statement, dashboard “customer outstanding” (if shown), report load.
- **Action when breached:** **Warn** in UI, **log** variance. Do not block viewing.

**Per-customer AR mismatch — period close**

- **Allowed tolerance:** **0** when used in period-close reconciliation.
- **When it applies:** Period close (e.g. “all customers’ AR reconciles”).
- **Action when breached:** **Block** period close; return list of failing customer(s) and deltas.

**Per-period AR mismatch**

- **Allowed tolerance:** **0** for period close.
- **When it applies:** Period close only.
- **Action when breached:** **Block** period close; return message “Period AR total does not match operational total” and delta.

**Trial balance imbalance**

- **Allowed tolerance:** **0** (zero).
- **When it applies:** Trial balance report, balance sheet report, period close (implicit: close assumes TB is balanced).
- **Action when breached:** **Abort** report with 500 (current behavior); **block** period close. **Log** the imbalance amount.

**Where tolerance is ZERO (explicit):**

1. **Per-invoice balance** when used to **validate or block** a payment, credit-note application, or mark-paid.
2. **Per-customer AR** when used in **period-close** reconciliation.
3. **Per-period AR** in **period-close** reconciliation.
4. **Trial balance** (debits − credits) in **report generation** and **period close**.

---

## 3. Reconciliation Engine — Design (Architecture Only)

**Inputs**

- **business_id** (required): Scope of reconciliation.
- **period_id** (optional): If set, reconciliation is restricted to that accounting period (e.g. AR movements and snapshot in that period).
- **invoice_id** (optional): If set, run per-invoice reconciliation for that invoice only.
- **customer_id** (optional): If set, run per-customer reconciliation for that customer only.

Filters are combined: e.g. business_id + period_id + customer_id = “AR reconciliation for this customer in this period.”

**Outputs**

- **expected_balance:** Total derived from operational source: for an invoice, `invoice.total - sum(payments.amount) - sum(credit_notes.total where status='applied')`; for a customer, sum of those per invoice; for a period, sum over scope.
- **ledger_balance:** Total from ledger: for an invoice, sum of (debit − credit) on AR account for `reference_type='invoice'` and `reference_id=invoice_id`; for a customer, sum over that customer’s invoices; for a period, sum over JEs in that period for the scope.
- **delta:** ledger_balance − expected_balance (or equivalent sign convention, clearly defined).
- **status:** **OK** (within tolerance), **WARN** (breach of display tolerance, e.g. &gt; 0.01), **FAIL** (breach of zero-tolerance, or used in a context where tolerance is zero).

**Data sources for each output**

- **expected_balance:**  
  - Per-invoice: `invoices.total`, `payments.amount` (invoice_id), `credit_notes.total` (invoice_id, status=applied).  
  - Per-customer: same, aggregated by customer_id.  
  - Per-period: same, filtered by issue_date/date in period.
- **ledger_balance:**  
  - Per-invoice: `journal_entry_lines` joined to `journal_entries` where account_id = AR, `reference_type='invoice'`, `reference_id=invoice_id`; balance = sum(debit)−sum(credit).  
  - Per-customer: same, aggregated by customer (e.g. via invoice_id → invoices.customer_id) or by AR lines linked to invoices for that customer.  
  - Per-period: same, filtered by journal date in period (and period_id if available).
- **delta:** Computed from the two above.
- **status:** Computed by comparing |delta| to the tolerance for the calling context (display/warn vs block).

**Where the engine is called**

- **Reports:** Optional call when loading invoice list, invoice view, customer 360, customer statement, or dashboard. Use display tolerance; return status WARN/OK and optionally delta; UI may show a warning banner if WARN.
- **Period close:** Mandatory call before marking period closed. Run per-period AR reconciliation (and optionally per-invoice or per-customer). Use zero tolerance. If any result is FAIL, period close fails.
- **Manual audit:** On-demand job or admin tool. Call with business_id and optional period_id / invoice_id / customer_id. Return list of (scope, expected_balance, ledger_balance, delta, status). No automatic block; used for investigation and cleanup.

**Failure semantics (what happens upstream)**

- **Report load:** Engine returns status WARN or FAIL. Upstream treats OK: render as normal. WARN: render plus optional banner “Totals may not match ledger.” FAIL: same as WARN for display-only; no block. Optional “strict report” mode: on FAIL, block report and show “Reconciliation failed; resolve variances before viewing.”
- **Period close:** Engine returns FAIL for any zero-tolerance check. Upstream **blocks** period close; returns HTTP 4xx or equivalent with message and list of failing checks (e.g. “Invoice X: delta 0.02”; “Period AR: delta 1.50”). No state change to “closed.”
- **Manual audit:** Engine returns variance list. Upstream displays or exports it. No automatic block; operator decides follow-up.

---

## 4. Impact Matrix — Ledger-Based Invoice Balance

**If invoice balance (and customer outstanding) were switched to ledger as the source of truth, the following would be impacted.**

**UI pages that display remaining balance, outstanding amount, or customer totals**

| Location | What is displayed | Role w.r.t. balance | Impact if switched to ledger |
|----------|--------------------|---------------------|------------------------------|
| Invoice view (`app/invoices/[id]/view/page.tsx`) | Remaining balance, total paid, total credits | **Read-only display** | Must call ledger (or reconciliation engine) for “remaining balance”; total paid/credits can stay from operational for narrative or become ledger-derived for consistency. |
| Invoice list (e.g. list with “outstanding” column) | Outstanding amount per invoice | **Read-only display** | Must use ledger-derived balance per invoice (or reconciliation output). |
| Pay form (inline on invoice view or modal) | Remaining balance, max payment amount | **Validation / blocking logic** (max = remaining) | Must use ledger balance (or reconciled value) for “max”; validation must use same source. |
| Dashboard (`app/dashboard/page.tsx`) | Total outstanding, overdue amount, total invoiced, collected | **Read-only display** (KPIs) | Must use ledger for outstanding/overdue; “total invoiced” and “collected” definition must be decided (ledger-derived totals vs document totals). |
| Customer 360 (`app/customers/[id]/...` or 360 view) | Total outstanding, total paid, total credits, total invoiced | **Read-only display** | Must use ledger for outstanding (and optionally for paid/credits/invoiced if desired for consistency). |
| Customer statement (statement view/export) | Total outstanding, total paid, total credits, total invoiced | **Read-only display** (and audit export) | Must use ledger for all summary totals in statement. |

**APIs that validate or block using remaining balance**

| API | What it validates / blocks | Role | Impact if switched to ledger |
|-----|----------------------------|------|------------------------------|
| `POST /api/invoices/[id]/mark-paid` | remainingBalance &gt; 0 before creating payment; amount = remainingBalance | **Validation / blocking** | Must derive “remaining” from ledger (or reconciliation); reject if ledger balance ≤ 0 or if requested amount &gt; ledger balance. |
| `POST /api/payments/create` | amount ≤ remaining balance (invoice.total − payments − credits) | **Validation / blocking** | Must use ledger balance for “remaining”; block if amount &gt; ledger balance. |
| `POST /api/credit-notes/create` | credit total ≤ remaining gross (invoice − payments − credits) | **Validation / blocking** | Must use ledger-derived remaining; block if credit &gt; ledger remaining. |
| `PATCH /api/credit-notes/[id]` (apply) | credit amount ≤ remaining gross | **Validation / blocking** | Same as above. |
| Credit-note create page (client-side guard) | Same as create API | **Validation / blocking** (duplicate of API) | Client must use same rule as API; API remains authority. |

**Impact matrix (compact)**

| Area | Type | Impact |
|------|------|--------|
| Invoice view — remaining balance | Read-only display | **Impacted:** data source must change from operational to ledger (or reconciliation output). |
| Invoice view — pay form max / validation | Validation / blocking | **Impacted:** validation must use ledger balance. |
| Invoice list — outstanding column | Read-only display | **Impacted:** data source must change to ledger per invoice. |
| Dashboard — outstanding / overdue / KPIs | Read-only display | **Impacted:** data source must change to ledger for money KPIs. |
| Customer 360 — totals | Read-only display | **Impacted:** totals must come from ledger (or reconciliation). |
| Customer statement — totals | Read-only display (+ audit) | **Impacted:** summary totals must come from ledger. |
| Mark-paid API | Validation / blocking | **Impacted:** remaining balance and “allow payment” must use ledger. |
| Payments create API | Validation / blocking | **Impacted:** “remaining balance” check must use ledger. |
| Credit-notes create API | Validation / blocking | **Impacted:** “remaining” check must use ledger. |
| Credit-notes [id] apply API | Validation / blocking | **Impacted:** same as above. |
| Credit-notes create page (client guard) | Validation / blocking | **Impacted:** must align with API (ledger-based). |

**Summary:** Every place that today shows or validates “remaining balance,” “outstanding,” or “customer totals” is either read-only display or validation/blocking; all of them are **impacted** by a switch to ledger-based balance. No “no impact” entries for balance/outstanding logic.

---

## 5. Transition Strategy: Operational Truth → Ledger Truth

**Chosen approach: Dual-run (compare + warn), then feature-flagged cutover**

- **Dual-run:** For a defined window, all balance/outstanding logic continues to use operational data as today. In parallel, the system computes ledger-derived balance (or runs the reconciliation engine) for the same scope. Where they differ by more than the display tolerance (0.01), surface a **warning** (e.g. “This balance may not match your ledgers”) and **log** the variance. No change yet to validation or blocking.
- **Feature-flagged cutover:** After a stable dual-run period and cleanup of known mismatches, a feature flag (“use_ledger_for_balance”) is introduced. When **off:** behavior stays as today (operational + optional warn). When **on:** display and validation use ledger (or reconciliation result). Rollout is by tenant, role, or global toggle. Validation/blocking uses zero tolerance when the flag is on.

**Migration steps (conceptual, no implementation)**

1. **Implement reconciliation engine** (inputs, outputs, data sources, tolerances) and **logging** for expected_balance, ledger_balance, delta, status.
2. **Dual-run wiring:** In invoice view, invoice list, dashboard, customer 360, customer statement, and in mark-paid, payments create, credit-note create/apply: keep current operational logic as the active path; add a parallel call to the reconciliation engine for the same scope. If status is WARN or FAIL, show a non-blocking warning in UI and write a log/event.
3. **Analyse and remediate:** Use logs and manual-audit output to list existing mismatches (invoice_id, customer_id, delta). Business decides: correct ledger (e.g. post missing JEs, reverse duplicates) or correct operational data (e.g. fix payments/invoices). Document resolution policy.
4. **Feature flag:** Add “use_ledger_for_balance.” When off, keep dual-run + warn only. When on, use ledger_balance (or reconciled value) for display and use zero-tolerance checks for validation/blocking.
5. **Rollout:** Enable flag for internal/test tenants first; then selected customers; then global. Monitor errors and variance logs.
6. **Drop legacy path:** Once all tenants are on “use_ledger_for_balance” and stable, remove operational-only path for balance/outstanding and the dual-run warning; keep reconciliation for period close and audit.

**Rollback strategy**

- **Before cutover:** Rollback = do nothing; operational path remains authoritative.
- **After flag is on:** Rollback = set “use_ledger_for_balance” to **off** for the affected tenant(s) or globally. Display and validation revert to operational logic. No schema or historical data revert needed.
- **If ledger source is wrong:** Fix ledger (and/or reconciliation rules) first; then re-enable flag. Do not roll back to operational as long-term source once ledger is correct.

**How mismatches are surfaced to users**

- **Dual-run:** Non-blocking banner or inline note: “This balance may not match your accounting records. If you see a difference, contact support or run an audit.” Link (if available) to “Reconciliation report” or “Contact support.”
- **After cutover (flag on):** If a user tries an action that fails zero-tolerance (e.g. payment &gt; ledger balance): clear error message, e.g. “Payment amount exceeds the amount due per your ledger. Current balance: [ledger_balance]. Please refresh or contact support if you believe this is incorrect.”
- **Period close:** “Period cannot be closed: reconciliation failed. [List of failed checks, e.g. per-invoice or per-period deltas].”

**Existing mismatches in production**

- **Not auto-corrected.** The transition does not silently change ledger or operational rows. Existing data is left as-is.
- **Visibility:** Dual-run and manual-audit output expose mismatches (expected_balance vs ledger_balance, delta). Operators use that to decide corrections.
- **Correction ownership:** Business policy must define whether to fix ledger (post adjustments, reversals) or operational (fix invoices/payments/credits). Design doc does not mandate which; it only states that resolution is deliberate and logged.
- **Cutover with known variances:** If some mismatches remain at cutover, two policies are possible: (a) **Strict:** do not enable “use_ledger_for_balance” until those entities are reconciled; or (b) **Tolerant:** enable flag, and for those entities treat delta as WARN (allow view, warn) until resolved, while new data is ledger-authoritative. This spec **decides (a):** zero-tolerance for validation/blocking. So for any invoice/customer/period that still has |delta| &gt; 0, payments/credits/period-close that depend on it remain blocked until the mismatch is resolved (or the flag is rolled back for that scope).

---

## 6. Reconciliation proposals — hash-locked

**Reconciliation proposals are hash-locked for audit-grade determinism and tamper-evidence.**

- **proposal_hash** = SHA256 of a **canonical JSON** that includes:
  - **Reconciliation result:** scope (businessId, customerId?, invoiceId?, periodId?), expectedBalance, ledgerBalance, delta.
  - **Proposed JE:** posting_source, description, reference_type, reference_id, lines (sorted).
- **GET /mismatches** returns, for each mismatch row: `result`, `proposal`, and **proposal_hash**. The client must use this `proposal_hash` when calling resolve; it must not recompute or alter it.
- **POST /resolve** requires **proposal_hash** in the body. The server:
  1. Re-runs reconciliation for the scope.
  2. Re-generates the proposal from that result.
  3. Computes **proposal_hash** from (result + proposed_fix).
  4. If the computed hash **does not match** the client’s `proposal_hash` → returns **409 STALE_RECONCILIATION** with the new `result`, `proposal`, and `proposal_hash` (so the client can refresh and retry).
  5. If it matches, the server uses the **server-generated** proposal for posting and approval records (not the client’s body).
- **Effect:** Stale or altered proposals cannot be posted; only the exact proposal bound to the latest reconciliation state can be resolved. Proposals are reproducible and tamper-evident.

---

*End of specification. No code, no SQL, no TS; design and decisions only.*
