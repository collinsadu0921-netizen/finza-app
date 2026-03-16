# Accounting Control Surface — Implementation Design

Translates the Accounting Operations Layer (runbooks, SOPs) into **executable UI workflows and safe accountant control panels**. The accounting engine, ledger schema, posting logic, and forensic SQL remain **locked** and unchanged.

---

## 1. UI Architecture

### 1.1 Principles

- **Tenant-scoped:** All accountant controls operate within a resolved business context (`resolveAccountingBusinessContext` / `businessId` from query or firm client session).
- **Authority-gated:** Every surface checks `checkAccountingAuthority(supabase, userId, businessId, "read" | "write" | "approve")` before rendering actions or calling write APIs.
- **No engine changes:** UI only triggers existing APIs (reconciliation resolve, adjustments apply, period close, etc.); no new posting or forensic RPCs.
- **Audit hooks:** All write actions (reversal, adjustment, period close/reopen, forensic resolve) call a shared **audit logging hook** (client or API) that appends to the audit store without modifying ledger tables.

### 1.2 Layer Map

| Layer | Location | Responsibility |
|-------|----------|-----------------|
| **Accounting (tenant)** | `/accounting/*` | Ledger, periods, adjustments, reconciliation, reports; **add** reversal panel, period control center, health dashboard, audit visibility. |
| **Admin (platform/firm)** | `/admin/accounting/*` | Forensic runs, failure queue; **extend** with investigation checklist, correction workflow launch, escalation; **add** tenant safety (archive/reactivate) if admin-only. |
| **Shared** | Components + hooks | Guardrail modals, confirmation flows, permission checks, audit log submission. |

### 1.3 Route Additions (new only)

- `GET/POST` **Reversal:** Entry from ledger or dedicated reversal page; no new route required if reversal is a **modal + API** opened from ledger JE row.
- **Adjustment decision:** Part of existing `/accounting/adjustments` or `/accounting/journals/new`; add a **decision helper** component (Reverse vs Adjust vs New Entry) and route approvals via existing `ledger_adjustment_policy` + reconciliation/pending-approvals.
- **Forensic response:** Existing `/admin/accounting/forensic-runs` and `/admin/accounting/forensic-runs/[run_id]`; **extend** with investigation checklist UI, “Correction workflow” launch (e.g. deep link to ledger JE or reconciliation), and Acknowledge / Resolve / Escalate actions (already partially present).
- **Period control:** Existing `/accounting/periods`; **extend** with explicit Close / Soft close / Reopen request workflows and approval routing (partner-level) using existing period APIs.
- **Health dashboard:** New page `/accounting/health` (or `/accounting/dashboard`) under accounting layout; reads latest forensic run (per tenant or firm), open failure count, period status, approval queue.
- **Audit visibility:** New page `/accounting/audit` (or section under existing accounting) for timeline of reversals, adjustments, period reopens, monitoring resolutions; read-only.
- **Tenant safety (admin):** New page `/admin/accounting/tenants` or under existing admin: list businesses, archive/reactivate, verify monitoring exclusion; uses existing `businesses.archived_at` and RLS.

### 1.4 Data Flow

- **Read:** All data via existing APIs (ledger list, periods, forensic runs/failures, pending approvals, resolution history). No new read RPCs.
- **Write:** Reversal = new API that builds reversal JE and calls existing `post_journal_entry` (adjustment path); or reuse adjustment apply with reversal payload. Period close/reopen = existing period APIs. Forensic resolve = existing PATCH resolve/acknowledge. Audit = POST to audit API or insert via API after each action.
- **Guardrails:** Enforced in UI (disable buttons, show modals) and re-validated in API (open period, not already reversed, authority).

---

## 2. Workflow State Machines

### 2.1 Reversal Workflow

```
[Ledger JE selected] → [CanReverse?]
  ├─ No (draft / already reversed / closed period) → Disable or show message
  └─ Yes → [Open Reversal Modal]
             → [User enters reason + optional date]
             → [Preview reversal lines]
             → [Confirm] → API: create reversal JE (adjustment ref = original id)
             → [Success] → Show new JE id; link to ledger; close modal; audit log
             → [Error] → Show message; keep modal open
```

**States:** `idle` | `modal_open` | `submitting` | `success` | `error`.  
**Guards:** Period open for reversal date; JE is posted; JE not already reversed (no existing adjustment referencing it as reversal of); user has write authority.

### 2.2 Adjustment Entry (Decision-Guided)

```
[User wants to correct something]
  → [Decision Helper: Reverse / Adjust / New Entry]
       → Reverse → Redirect to Reversal flow (select JE)
       → Adjust  → [Adjustment form] → Policy check (threshold) → [Needs approval?]
                    ├─ No  → Submit adjustment API → Success/Error
                    └─ Yes → Submit for approval → Pending approvals queue
       → New Entry → [Manual journal form] → Submit (existing flow)
```

**States:** `choice` | `reversal` | `adjustment_form` | `approval_pending` | `submitted` | `error`.  
**Policy:** Read `ledger_adjustment_policy` (and reconciliation policy) to decide approval path; show approval chain status from `ledger_adjustment_approvals`.

### 2.3 Forensic Response Workflow

```
[Failure in queue] → [View payload / affected entity]
  → [Acknowledge] → PATCH acknowledge (existing) → audit
  → [Resolve]     → [Resolution modal: note + optional link to correction]
                   → PATCH resolve (existing) → audit
  → [Escalate]    → [Escalation modal: assignee/reason] → Update failure or external log → audit
  → [Launch correction] → Deep link to Ledger (JE) or Reconciliation (scope) for manual fix
```

**States (per failure):** `open` | `acknowledged` | `resolved` | `escalated`.  
No change to forensic SQL; only UI state and existing failure PATCH APIs.

### 2.4 Period Control Workflow

```
[Periods list] → [Close]
  → Readiness checks (existing) → [All pass?]
       ├─ No  → Show blockers; no close
       └─ Yes → [Confirm close modal] → API close → audit

[Soft close] → Same with soft_close flag if supported by API

[Reopen request]
  → [Reopen modal: reason required] → API reopen (or “request reopen” if approval required)
  → If approval required: [Partner approves] → Then reopen API → audit
```

**States:** `open` | `closing` | `soft_closed` | `locked` (existing period statuses). Reopen adds a “reopen requested” state only if product supports it; otherwise reopen is a single approved action.

---

## 3. Component Specifications

### 3.1 Reversal Control Surface

| Component | Purpose | Props / Inputs | Outputs / API |
|-----------|--------|----------------|---------------|
| **ReversalModal** | Modal for reversing one JE | `journalEntry` (id, date, description, lines, reference_type, reference_id), `businessId`, `onClose`, `onSuccess` | On confirm: POST reversal API with original_je_id, reason, reversal_date; then `onSuccess(reversalJeId)` |
| **Ledger row action** | “Reverse” button on each posted JE row | JE id, period status, `canWrite` | Opens ReversalModal if period open and JE not reversed; else tooltip “Closed period” / “Already reversed” |
| **ReversalPreview** | Shows swapped lines (account, was debit→credit, was credit→debit) | `lines` (from original JE) | Read-only list |

**Guardrails:**  
- Disable Reverse if `period.status !== 'open'` for reversal date (or show “Reopen period first”).  
- Disable if JE is draft or if an adjustment already exists with `adjustment_ref` = this JE id (or equivalent “reversed by” check).  
- Require non-empty `reversal_reason` (min length e.g. 10); optional reversal date defaulting to today.

**Audit:** On successful reversal, call audit hook: `action: 'reversal'`, `original_je_id`, `reversal_je_id`, `reason`, `actor`, `business_id`, `period_id`.

### 3.2 Adjustment Entry Control (Decision Helper)

| Component | Purpose | Props / Inputs | Outputs |
|-----------|--------|----------------|---------|
| **AdjustmentDecisionHelper** | Radio or cards: “Reverse an entry” / “Adjust (reclass/correct)” / “New manual entry” | None | Navigate to reversal flow, adjustment form, or journal form |
| **AdjustmentForm** | Existing or extended; add risk level and approval status | `businessId`, policy (from API), existing form fields | Submit adjustment; if over threshold show “Pending approval” and approval chain |
| **ApprovalChainStatus** | Shows who approved (from `ledger_adjustment_approvals`) | `scopeType`, `scopeId`, `proposalHash` or adjustment ref | Read-only list of approvers and timestamps |

**Guardrails:**  
- Justification (adjustment reason) required.  
- After submit, if policy requires two-person/owner, show “Pending approval” and hide “Post” until approved; show “Request approval” for first approver.

### 3.3 Forensic Response Control Panel (extend existing)

| Extension | Purpose | Where |
|-----------|--------|--------|
| **Failure queue dashboard** | List failures with severity, check_id, business_id, status; filters | Already in `/admin/accounting/forensic-runs/[run_id]`; ensure severity and status filters are prominent |
| **Investigation checklist** | Per check_id, show runbook steps (from ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK) as read-only checklist | Collapsible section on failure detail or run detail |
| **Correction workflow launch** | Button “Open in Ledger” (link to `/accounting/ledger?journal_entry_id=...`) or “Open reconciliation” (link to reconciliation with scope) | On each failure row or detail, using payload.journal_entry_id or payload.invoice_id etc. |
| **Acknowledge / Resolve / Escalate** | Already present; ensure Resolve requires resolution note and calls audit hook | Existing PATCH handlers; add audit log on acknowledge/resolve/escalate |
| **Audit history** | List of actions (ack/resolve/escalate) for this failure or run | New small section or table: “Resolution history” from audit log filtered by failure_id/run_id |

### 3.4 Period Control Center (extend existing)

| Extension | Purpose | Where |
|-----------|--------|--------|
| **Close period workflow** | Button “Close period” → readiness check → confirm modal → close API | Existing periods page; use existing PeriodCloseCenter or equivalent |
| **Soft close** | If API supports, “Soft close” button and same confirm pattern | Same page |
| **Reopen request** | “Request reopen” → modal with required reason → API (or “request” endpoint); partner sees “Approve reopen” | Existing reopen modal; ensure reason required and audit logged |
| **Late adjustment handling** | Message: “To post in this period, request a reopen first.” Link to reopen flow | Shown when user tries to post in closed period |
| **Approval routing** | Reopen and (if applicable) close only for roles with approve/partner (from `checkAccountingAuthority` approve) | Hide “Close” / “Approve reopen” for non-authorized users |
| **Audit visibility** | “Closed by X on Y”; “Reopened by X, approved by Z on Y” | On period card or period detail |

### 3.5 Accounting Health Dashboard

| Block | Data source | Display |
|-------|-------------|---------|
| **Latest forensic run** | GET `/api/admin/accounting/forensic-runs?limit=1` (or tenant-scoped if API supports) | Status, total_failures, alertable_failures, started_at, link to run |
| **Open failure count** | From latest run summary or GET failures with status=open | Number + link to run |
| **Period status summary** | GET periods for business | Count open / soft_closed / locked; next period to close |
| **Snapshot verification** | From run check_counts or separate snapshot check | “Trial balance snapshot: OK / Mismatch” with link |
| **Adjustment approval queue** | GET `/api/accounting/reconciliation/pending-approvals` (and any adjustment-specific queue) | List of pending items; link to reconciliation or adjustment |
| **Monitoring alert history** | List recent runs with alertable_failures > 0 or alert_sent | Table: run id, date, failures, link |

**Page:** `/accounting/health` or `/accounting` (dashboard tab). Permission: accounting read (and admin read for forensic data if tenant-scoped).

### 3.6 Accountant Action Audit Visibility

| Block | Data source | Display |
|-------|-------------|---------|
| **Timeline** | GET audit log API (filter: action_type in reversal, adjustment, period_close, period_reopen, approval, forensic_resolution) | Chronological list; columns: time, actor, action, entity (JE/period/run), reason/note |
| **Entity filter** | Query params: business_id, period_id, journal_entry_id, user_id | Filter timeline |
| **User accountability** | Same log; group by user or show user on each row | Read-only |
| **Immutable** | No edit/delete of log entries in UI | View only |

**Page:** `/accounting/audit`. Requires audit log API (read) and optionally RLS so only authorized roles see audit.

### 3.7 UI Guardrail Enforcement (runtime)

| Guardrail | Implementation |
|-----------|----------------|
| **Warning modals** | Reversal: “This will create a reversing entry. Original will not be modified. You must provide a reason.” Adjustment: “You are posting an adjustment. Ensure reason and reference are correct.” Period close: “Closing will prevent further posting. Ensure reconciliations complete.” Reopen: “Reopening allows posting in a closed period. Requires approval and documentation.” |
| **Required justification** | Reversal: required text field, min length. Adjustment: existing reason field required. Reopen: reason required. Resolve: resolution note required. |
| **Approval gates** | Buttons “Close period”, “Approve reopen”, “Post” (when over threshold) visible only when `checkAccountingAuthority(..., 'approve')` or write with policy pass. Show “Pending approval” when approval required. |
| **Lock indicators** | Period card: badge “Closed” / “Soft closed” when status not open. Ledger JE: badge “Reversed” or “Reversal of &lt;id&gt;” when adjustment_ref points to it (or reversed_by). Disable post/reverse for closed period. |
| **Confirmation flows** | All destructive or high-impact actions: modal with summary + confirm button; optional “Type CONFIRM to proceed” for reopen/close. |

### 3.8 Tenant Safety Admin Panel

| Feature | Implementation |
|---------|-----------------|
| **List tenants** | GET businesses (admin only); columns: name, id, archived_at, created_at |
| **Archive** | Button “Archive” → confirm modal → PATCH business set archived_at = now; audit log |
| **Reactivate** | Button “Reactivate” (only for archived) → confirm + reason → PATCH set archived_at = null; audit log |
| **Monitoring exclusion** | Read-only note: “Archived tenants are excluded from forensic runs.” Show archived_at in list. |
| **Retention visibility** | Read-only text or link to retention policy; no delete button for ledger/audit data. |

**Page:** `/admin/accounting/tenants` or under existing admin accounting section. Permission: platform admin or firm admin only (no tenant accountant).

---

## 4. Permission Matrix

| Surface | Read | Write | Approve |
|---------|------|-------|---------|
| Ledger list | ✓ (accounting read) | — | — |
| Reversal (open period) | — | ✓ (accounting write) | — |
| Adjustment create | — | ✓ | — |
| Adjustment (over threshold) / Reconciliation (large delta) | — | First approver | ✓ (owner or second approver) |
| Period list / readiness | ✓ | — | — |
| Period close | — | — | ✓ (owner/partner) |
| Period reopen | — | — | ✓ (owner/partner) |
| Forensic runs list & detail | ✓ (admin: owner, firm admin, accounting admin) | — | — |
| Forensic acknowledge/resolve | — | ✓ (same admin roles) | — |
| Health dashboard | ✓ (accounting read; forensic read if admin) | — | — |
| Audit log view | ✓ (accounting read or audit role) | — | — |
| Tenant archive/reactivate | ✓ (platform/firm admin) | ✓ (same) | — |

**Implementation:** Use `checkAccountingAuthority(supabase, userId, businessId, 'read'|'write'|'approve')` and existing role checks (e.g. `getUserRole`, firm `canAccessForensicMonitoring`) for each page and button. Do not add new DB roles; only use existing authority.

---

## 5. Audit Logging Hook Integration

### 5.1 When to log

- **Reversal:** After successful reversal API response; log `reversal`, original_je_id, reversal_je_id, reason, actor, business_id, period_id, timestamp.
- **Adjustment:** After successful adjustment apply; log `adjustment`, journal_entry_id, reason, actor, business_id, period_id, timestamp.
- **Period close:** After close API success; log `period_close`, period_id, closed_by, timestamp.
- **Period reopen:** After reopen API success; log `period_reopen`, period_id, requested_by, approved_by, reason, timestamp.
- **Approval (two-person / owner):** After approval recorded (e.g. reconciliation resolve or ledger_adjustment_approvals insert); log `approval`, scope, proposal_ref, approver, timestamp.
- **Forensic:** On acknowledge, resolve, escalate; log `forensic_ack` | `forensic_resolve` | `forensic_escalate`, failure_id, run_id, actor, note, timestamp.
- **Tenant:** On archive/reactivate; log `tenant_archive` | `tenant_reactivate`, business_id, actor, reason, timestamp.

### 5.2 Where to implement

- **Option A (recommended):** API routes that perform the action call a shared `writeAuditLog(supabase, payload)` or insert into `audit_log` (or existing table) with the above fields. UI does not write audit directly; API does after each successful mutation.
- **Option B:** UI calls a dedicated `POST /api/accounting/audit` with the same payload after a successful action; API validates and inserts. Redundant if API already logs.

Use **Option A** so audit cannot be bypassed by UI and remains server-authoritative.

### 5.3 Payload shape (minimum)

```ts
{
  action_type: 'reversal' | 'adjustment' | 'period_close' | 'period_reopen' | 'approval' | 'forensic_ack' | 'forensic_resolve' | 'forensic_escalate' | 'tenant_archive' | 'tenant_reactivate',
  actor_id: string,
  business_id: string | null,
  period_id: string | null,
  reference_type: 'journal_entry' | 'period' | 'forensic_failure' | 'tenant' | ...,
  reference_id: string | null,
  reason_or_notes: string | null,
  outcome: 'success',
  timestamp_utc: string (ISO),
  extra?: Record<string, unknown>  // e.g. reversal_je_id, original_je_id, run_id
}
```

---

## 6. Navigation Structure

### 6.1 Accounting section (tenant-scoped)

- **Existing:** Dashboard, Ledger, Periods, Chart of accounts, Adjustments, Reconciliation, Reports (Trial balance, P&amp;L, Balance sheet, General ledger), Opening balances, Carry-forward, Drafts, AFS, Exceptions, Firm (if firm user).
- **Add:**
  - **Health** → `/accounting/health` (or merge into main accounting dashboard).
  - **Audit** → `/accounting/audit` (timeline of accountant actions).

Sidebar: under “Accounting”, add “Health” and “Audit” links when user has accounting read.

### 6.2 Admin accounting section (platform/firm)

- **Existing:** Forensic runs → list; Forensic runs → [run_id] detail.
- **Add:**
  - **Tenants** (or “Client safety”) → `/admin/accounting/tenants` for archive/reactivate and monitoring exclusion note.

Forensic runs already linked from dashboard or admin menu; ensure “Accounting” admin submenu has “Forensic runs” and “Tenants”.

### 6.3 Entry points to control surfaces

- **Reversal:** From Ledger → row action “Reverse” → ReversalModal.
- **Adjustment decision:** From “Adjustments” or “New journal” → Decision helper at top (Reverse vs Adjust vs New entry).
- **Forensic response:** From Admin → Accounting → Forensic runs → [run] → failure list → Acknowledge/Resolve/Escalate + link to Ledger/Reconciliation.
- **Period control:** From Accounting → Periods → Close / Soft close / Reopen request (existing + confirm modals and reason).
- **Health:** Accounting → Health (new page).
- **Audit:** Accounting → Audit (new page).
- **Tenant safety:** Admin → Accounting → Tenants (new page).

---

## 7. User Journey Maps

### 7.1 Reversal (accountant)

1. Open **Accounting → Ledger**; select business/period.
2. Find posted JE to reverse; click **Reverse**.
3. Modal opens; see original JE summary and reversal preview (swapped lines).
4. Enter **Reversal reason** (required); optionally change reversal date.
5. Click **Confirm reversal**; system posts reversal JE.
6. Success: modal shows “Reversal created: &lt;id&gt;” and link to view new JE; modal closes.
7. Audit log entry created (reversal, original id, new id, reason, user).

### 7.2 Adjustment with approval (accountant → approver)

1. Open **Accounting → Adjustments** (or New journal with decision helper).
2. Choose **Adjust** (reclass/correct).
3. Fill adjustment form (accounts, amounts, reason).
4. Submit; system checks policy → “This adjustment requires owner approval” or “Pending second approval.”
5. First accountant: submission recorded; “Pending approval” shown.
6. Second approver (or owner): opens **Pending approvals** (or reconciliation pending); approves → adjustment posts.
7. Audit: two entries (approval 1, approval 2 + post).

### 7.3 Forensic failure response (ops/accountant)

1. Open **Admin → Accounting → Forensic runs**; see latest run with failures.
2. Open run; filter by severity or check_id.
3. Click a failure; see payload (e.g. journal_entry_id).
4. **Acknowledge** (optional); then **Open in Ledger** (deep link to that JE).
5. In Ledger, perform reversal or review; return to forensic run.
6. Click **Resolve**; enter resolution note; submit.
7. Failure marked resolved; audit log entry (forensic_resolve, failure_id, note, user).

### 7.4 Period close (owner/partner)

1. Open **Accounting → Periods**; run readiness for target period.
2. Resolve any blockers (reconciliation, forensic) or document exception.
3. Click **Close period**; confirm modal: “Ensure all reconciliations complete. Close?”
4. Confirm → API close → success; period shows “Closed”; “Closed by X on Y” visible.
5. Audit: period_close, period_id, closed_by, timestamp.

---

## 8. Failure Handling UX

### 8.1 API errors

- **4xx:** Show message from API (e.g. “Period is closed”, “You do not have permission”, “Reversal reason required”). Do not retry automatically; allow user to correct input or abandon.
- **5xx:** Show generic “Something went wrong. Please try again.” and optional “Retry” button. Log error for support; do not expose stack.

### 8.2 Validation errors

- Inline: mark required fields; show min length or format errors under fields.
- Modal submit: if validation fails, keep modal open and scroll to first error.

### 8.3 Conflict (e.g. period closed mid-flow)

- If user clicks “Close” but period was just closed by another user → API returns conflict → show “This period was already closed. Refresh the page.” and refresh list.

### 8.4 Network / timeout

- Show “Request timed out. Check your connection and try again.” with Retry. Do not assume success if no response.

### 8.5 Idempotency (reversal / reconciliation)

- If user double-submits reversal, API returns existing reversal JE id (idempotent); show “Reversal already exists: &lt;id&gt;” and link. No duplicate JE created.

---

## 9. Safe Operation Confirmation Patterns

### 9.1 Reversal

- **Modal title:** “Reverse journal entry”
- **Body:** Original JE summary (date, description, total debit/credit); preview of reversal lines; required “Reversal reason” field.
- **Footer:** “Cancel” | “Confirm reversal” (primary). On Confirm: validate reason → submit → on success close and show toast/link; on error show message in modal.

### 9.2 Period close

- **Modal:** “Close period &lt;name&gt;?” with readiness summary (e.g. “X reconciliations resolved. Y failures open.”). If failures > 0, show warning and optional “Close anyway” (per product policy) or block.
- **Footer:** “Cancel” | “Close period”. Optional: “I confirm all reconciliations are complete” checkbox.

### 9.3 Period reopen

- **Modal:** “Request reopen: &lt;period&gt;” with required “Reason for reopen” and note “This action requires approval and will be logged.”
- **Footer:** “Cancel” | “Request reopen” (or “Approve reopen” for approver). Approver sees same modal with “Approve” and reason pre-filled.

### 9.4 Forensic resolve

- **Modal:** “Resolve failure” with failure summary and required “Resolution note” (e.g. “Reversed JE &lt;id&gt;” or “Corrected period_id”).
- **Footer:** “Cancel” | “Mark resolved”. On submit, PATCH resolve with note; then close and refresh list.

### 9.5 Tenant archive

- **Modal:** “Archive tenant &lt;name&gt;? They will be excluded from monitoring. Data is retained.”
- **Footer:** “Cancel” | “Archive”. Optional: require typing tenant name or “ARCHIVE” to confirm.

---

## 10. Implementation Checklist (summary)

- [ ] **Reversal:** ReversalModal + ledger row “Reverse” + reversal API (builds reversal JE, calls post_journal_entry adjustment path) + audit hook; guardrails (period open, not reversed, reason required).
- [ ] **Adjustment:** Decision helper on adjustments/journals; approval chain display; policy-driven approve/post; guardrails (reason, approval gates).
- [ ] **Forensic:** Extend run detail with investigation checklist (read-only from runbook), “Open in Ledger”/“Open reconciliation” links, resolve note required; audit on ack/resolve/escalate.
- [ ] **Period:** Close/Soft close/Reopen modals with reason and confirmation; approval for reopen; audit on close/reopen.
- [ ] **Health dashboard:** New page; latest run, open failures, period summary, approval queue, alert history.
- [ ] **Audit visibility:** New page; timeline from audit API; filters (entity, user); read-only.
- [ ] **Guardrails:** Warnings and required fields per ACCOUNTING_UI_GUARDRAILS; lock badges (period, reversed JE); confirmation modals.
- [ ] **Tenant admin:** List businesses; archive/reactivate with confirm and reason; monitoring exclusion note; audit log.
- [ ] **Permissions:** All surfaces gated by `checkAccountingAuthority` and existing admin checks; no new schema.

---

## References

- [ACCOUNTING_OPERATIONS_LAYER.md](./ACCOUNTING_OPERATIONS_LAYER.md)
- [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md)
- [ACCOUNTING_ADJUSTMENT_GOVERNANCE.md](./ACCOUNTING_ADJUSTMENT_GOVERNANCE.md)
- [ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md)
- [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md)
- [ACCOUNTING_UI_GUARDRAILS.md](./ACCOUNTING_UI_GUARDRAILS.md)
- [ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md](./ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md)
- [ACCOUNTING_AUDIT_STANDARD.md](./ACCOUNTING_AUDIT_STANDARD.md)
- Existing: `app/accounting/*`, `app/admin/accounting/forensic-runs/*`, `lib/accountingAuth.ts`, `PeriodCloseCenter`, ledger/adjustment/period APIs.
