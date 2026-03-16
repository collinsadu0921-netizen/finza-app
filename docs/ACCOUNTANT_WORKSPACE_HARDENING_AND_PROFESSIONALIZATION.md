# Accountant Workspace Hardening & Professionalization

**Role:** Systems architecture audit and scope hardening.  
**Constraints:** No code, no migrations, no RLS changes, no UI design. Authority, workflow integrity, responsibility boundaries, and enterprise maturity only.

---

# PART 1 — ACCOUNTANT WORKSPACE RESPONSIBILITY MAP

## A. Ledger Authority

### What accountants can read

- Journal entries and journal entry lines for engaged client businesses only (scoped by `business_id` + effective engagement).
- Ledger-derived views: trial balance, general ledger, balance sheet, P&L, AFS runs.
- Filtering by date range, account, reference type is supported at API level.

### What accountants can write (ledger mutation)

Ledger mutation occurs **only** through these paths:

| Path | Mechanism | Notes |
|------|-----------|--------|
| **Manual journals** | Draft → Approve → Post via `post_manual_journal_draft_to_ledger` RPC | Status must be `approved`; period must not be `locked`; Partner required to post (see Journal Governance). |
| **Adjustments** | `apply_adjusting_journal` RPC | Creates journal entry with `reference_type = 'adjustment'`, `is_adjustment = TRUE`. Period must be `open` or `soft_closed`. |
| **Opening balances** | `post_opening_balance_import_to_ledger` RPC | Import must be `approved`; period must not be `locked`; idempotent. |
| **Period close system postings** | Carry-forward, close workflows | DB/triggers or RPCs that create entries as part of period close/lock (e.g. carry-forward). |
| **Reconciliation corrections** | Resolution flow → proposal → post | Creates correction journal entries via reconciliation resolution; hash-locked proposal, governance (small delta vs owner/two-person). |

### What accountants must NEVER mutate

- **Existing journal entries or lines:** No update/delete of posted ledger rows. Ledger is append-only; corrections are new entries (reversals, adjustments, or reconciliation corrections).
- **Operational documents that drive automatic posting:** Invoices, payments, sales, expenses are created and posted from the **Service** workspace (business owner / staff). The accountant does not create or edit those documents from the Accounting workspace.

### Verification: no other ledger mutation paths

- **Direct inserts into `journal_entries`:** Removed; per migration 254 and 051, permissive insert policy was dropped. All posting goes through RPCs (`post_manual_journal_draft_to_ledger`, `apply_adjusting_journal`, `post_opening_balance_import_to_ledger`, plus operational flows that are Service-owned).
- **Operational posting (invoices, payments, sales, expenses):** These flows live under Service/operational routes (e.g. invoices mark-paid, payments create, sales create). They are **not** part of the Accountant Workspace; they mutate the ledger on behalf of the business, not the firm.

**Conclusion:** Ledger mutation in the accountant context is confined to manual journals, adjustments, opening balances, period-close postings, and reconciliation corrections. No other paths exist for accountant-initiated ledger writes.

---

## B. Journal Governance

### Draft lifecycle (manual journals)

- **Create:** Draft created with status `draft`; `created_by` set.
- **Submit:** Draft moves to `submitted`; `submitted_by` set.
- **Approve / Reject:** Senior or Partner with approve access can approve or reject; `approved_by` / `rejected_by` set, status `approved` or `rejected`.
- **Post:** Only when status is `approved`; RPC `post_manual_journal_draft_to_ledger` creates the ledger entry and links `journal_entry_id` to the draft. Idempotent (re-posting returns existing entry).

### Maker–Checker separation

- **Defined in authority matrix:** `create_*` and view actions allowed for Junior with write; `approve_*` and `post_*` require Senior or Partner and approve access.
- **Enforcement:**  
  - **Approve:** `resolveAuthority` requires firm role Senior or Partner and engagement access `approve` for `approve_journal`.  
  - **Post:** The journal post route explicitly requires **Partner** role (not Senior) and approve access. This is **stricter** than the documented `AUTHORITY_MATRIX`, which states `post_journal` requires `minFirmRole: "senior"`. So there is a **documentation vs implementation split:** the matrix says Senior can post; the route allows only Partner.
- **Maker vs checker:** Different users can be `created_by` vs `approved_by` vs poster (posted_by in RPC). The system does not currently enforce “approver must not be creator” or “poster must not be creator”; that would be an explicit maker-checker rule to add if required for compliance.

### Approval hierarchy and posting authorization

- **Hierarchy:** Partner > Senior > Junior > Readonly. Approve and post require Senior or Partner (and in code, post is Partner-only).
- **Posting authorization:** Period must be open or soft_closed (not locked); engagement must be effective and have approve access; firm role must be Partner (in current implementation).

---

## C. Period Control Discipline

### No posting into closed periods

- **Manual journal post:** Route checks period status; if `locked`, returns 400 PERIOD_CLOSED.
- **Opening balance post:** DB function `post_opening_balance_import_to_ledger` enforces period not locked (migrations 151, 189).
- **Adjustments:** `apply_adjusting_journal` allows only `open` or `soft_closed` periods (migration 166); locked periods reject.
- **Reconciliation resolve:** Creates correction entries; period state is validated in context of the scope.

### Close / reopen workflow

- **Actions:** `soft_close`, `lock`, `request_close`, `approve_close`, `reject_close` (period close route).
- **Authority:** Period close uses `can_accountant_access_business` (RPC) and `is_user_accountant_write` (RPC), then `checkFirmOnboardingForAction`, then `getActiveEngagement` + `isEngagementEffective` + `resolveAuthority` for firm path. Only Partners can close/reopen per `AUTHORITY_MATRIX`; `request_close_period` / `approve_close_period` are passed to `resolveAuthority` but the action type enum may not include them (only `close_period` / `reopen_period` are in the matrix), so behavior depends on how those are mapped.
- **Reopen:** Reopen route exists; same authority pattern (firm onboarding, then engagement/role).

### Lock propagation

- Period status (`open` → `soft_closed` → `locked`) is enforced at API and RPC level for posting. Journals and adjustments cannot be posted to a locked period; draft creation and approval may still reference the period, but post is blocked.

### Period closing audit record

- Migrations reference period close checks and audit (e.g. 225_period_close_checks_rpc_and_log, 167_period_close_workflow). Period state transitions and readiness are logged; the exact “audit record” shape (who closed, when) should be confirmed against the period/audit tables and RPCs.

---

## D. Adjustment Integrity

- **Distinguishable from operational journals:** Adjustments are created only via `apply_adjusting_journal`; journal entries get `reference_type = 'adjustment'` and `is_adjustment = TRUE` (migrations 137, 166).
- **Adjustment history:** `accounting_adjustment_audit` (or equivalent) is written by the RPC; adjustment_reason and optional adjustment_ref are required at API level (apply route).
- **Authorization:** Create requires write or approve access; apply route uses `checkAccountingAuthority(supabase, user.id, business_id, "write")`. Approval/posting of adjustments in the manual-journal sense does not apply—adjustments are “create and apply” in one step (no separate draft/approve/post for the apply route). So “approval levels” for adjustments are effectively “who can call apply” (write or approve engagement access).

---

## E. Reconciliation Authority

- **Scope ownership:** Reconciliation is per business, per scope (e.g. invoice, customer, period). Authority to view and resolve is gated by `checkAccountingAuthority` with write for resolve.
- **Who resolves:** Accountant with write (or approve) can call resolve; governance layer then applies:
  - **Small delta (≤ 0.01):** Can be posted by accountant alone (policy-driven).
  - **Larger delta / owner approval:** `requiresOwnerApproval` and `adjustment_requires_owner_over_amount` (ledger_adjustment_policy).
  - **Two-person rule:** `requiresTwoPersonApproval` / `adjustment_requires_two_person_rule` when enabled.
- **Correction entries vs silent modify:** Resolution creates **correction journal entries** (proposal → hash-locked → post). No silent modification of ledger or reconciliation state; proposals are hash-locked to prevent bait-and-switch.

---

## F. Opening Balance Governance

- **Import lifecycle:** Create import → approve → post. Status flow: draft → approved; only approved imports can be posted.
- **Approval requirement:** Opening balance approve route uses `checkFirmOnboardingForAction` and then `resolveAuthority` for `approve_opening_balance` (Senior or Partner, approve access).
- **Posting enforcement:** Post route requires approved status, period not locked, and Partner-only in practice (opening balance post uses same firm onboarding + engagement + role checks). Idempotent.
- **Back-posting restrictions:** Posting is into a specific period; period must be open (or as per RPC rules). Back-posting into locked or closed periods is rejected by DB/RPC.

---

# PART 2 — ACCOUNTANT VS SERVICE BOUNDARY CONTRACT

## Service Workspace owns

- Orders, estimates, invoices, credit notes, bills, payments (create, edit, send, mark paid).
- Operational customer/supplier records (for sales/purchases).
- Inventory, POS, sales sessions (retail).
- **Ledger impact:** Invoices, payments, sales, expenses create journal entries via their own flows; these are **operational** postings, not accountant-initiated. The accountant does not create or edit these documents from the Accounting workspace.

## Accountant Workspace owns

- Ledger (read-only view + controlled writes via journals, adjustments, opening balances, period close, reconciliation corrections).
- Periods (view, close, reopen).
- Journals (drafts, submit, approve, post).
- Adjustments (create and apply).
- Reconciliation (view, resolve with correction entries).
- Opening balances (import, approve, post).
- Financial reports (trial balance, balance sheet, P&L, general ledger, AFS, exports).

## Cross-workspace mutation check

- **No accidental cross-workspace mutation:** Accounting API routes do not call invoice/payment/order create or update. Accounting routes operate on `journal_entries`, `manual_journal_drafts`, `opening_balance_imports`, `accounting_periods`, reconciliation, and reports. Service routes own invoices, payments, etc. The only “cross” is that operational events (e.g. invoice paid) trigger posting from Service-side code; the accountant never triggers those from the Accounting workspace.

---

# PART 3 — AUTHORITY DISCIPLINE

## Gating factors (intended)

Every accounting action should be gated by:

1. **Firm membership** (user in `accounting_firm_users`).
2. **Effective engagement** (accepted/active, date within effective_from/effective_to).
3. **Engagement access level** (read / write / approve) for the client.
4. **Period status** where relevant (open/soft_closed for posting; not locked).
5. **Firm role** (Partner / Senior / Junior / Readonly) for approve/post/close.

## Audit finding: not every route uses the same authority source

| Route type | Authority used | Note |
|------------|----------------|------|
| Reports, AFS, reconciliation read, adjustments list, carry-forward read, audit, COA, periods resolve, reversal status | `checkAccountingAuthority` (engine) | Single engine path. |
| Reconciliation resolve, adjustments apply, opening balances apply, carry-forward apply, reversal, AFS finalize | `checkAccountingAuthority` (engine) | Write/approve level. |
| Journal drafts list/create, draft get/patch, journal post, opening balance get/approve/post | `checkFirmOnboardingForAction` + engagement fetch + `resolveAuthority` | **Does not** call the canonical accounting authority engine; uses onboarding + ad-hoc engagement + firm role. |
| Period close, period reopen, period readiness | `can_accountant_access_business` (RPC) + `is_user_accountant_write` (RPC) + onboarding + `resolveAuthority` | **Dual path:** RPC for “access” and “write,” then app-layer engagement + role. |
| Trial balance (route), periods list, exports (transactions, levies, VAT), audit-readiness | `can_accountant_access_business` (RPC) | **RPC only;** no engine. |

**Conclusion:** The authority **engine** is not used on every accounting route. Journal drafts, opening balance lifecycle, and period close use onboarding + RPC + resolveAuthority. Some read paths (trial balance, periods list, exports) use only the RPC. So:

- **No single bypass of “authority”** in the sense that all routes do some access check, but **the source of truth is not single:** engine vs RPC vs onboarding + resolveAuthority.
- **Resolver:** Business_id comes from URL/session; context-check and effective list use the engine. Routes that use onboarding or RPC do not necessarily derive “allowed” from the same function as context-check.
- **Session state:** Session/client selection supplies business_id; it does not grant authority. Authority is re-checked per request, but via different implementations on different routes.

---

# PART 4 — PROFESSIONAL ACCOUNTANT UX EXPECTATIONS

## Accountant operational dashboard

**Should surface (enterprise expectation):**

- Outstanding reconciliations (counts or list by client).
- Period close readiness (per client/period).
- Draft journals pending approval (per client).
- Adjustments awaiting approval (if a separate “approval” queue exists for adjustments; currently adjustments are apply-on-create).
- Suspicious ledger anomalies (e.g. unreconciled high-value, aged items)—optional.
- Engagement client status (effective, pending, suspended).

**Current state:** Firm dashboard and firm ops exist (`/accounting/firm`, `/accounting/firm/ops`). Metrics and alerts routes exist (`/api/accounting/firm/metrics`, `/api/accounting/firm/ops/alerts`, `/api/accounting/firm/ops/metrics`). The degree to which they expose “outstanding reconciliations,” “draft journals pending approval,” “period close readiness” in one place is implementation-specific; the **expectation** is that a professional dashboard aggregates these.

## Client engagement command center

**For each client, show:**

- Engagement status (pending, accepted, active, suspended, terminated).
- Access level (read, write, approve).
- Period state (open, soft_closed, locked) for current/relevant periods.
- Reconciliation health (e.g. mismatch count, last reconciled).
- Draft workload (e.g. drafts pending approval).
- Posting workload (if applicable—e.g. approved but not yet posted).

**Current state:** Client list from `/api/accounting/firm/clients` returns status, period info, and some counts. A dedicated “command center” view per client that consolidates engagement, period state, reconciliation, and draft/post workload would match enterprise expectations.

## Audit trail visibility

**Should expose:**

- Who posted what (journal entry, opening balance, adjustment).
- Who approved what (draft, opening balance import).
- When entries were posted.
- What engagement (firm/client) authorized the action.

**Current state:**  
- `audit_logs` table and GET `/api/accounting/audit` (with businessId and filters) expose action_type, entity_type, user_id, etc.  
- Drafts carry `created_by`, `submitted_by`, `approved_by`; RPCs record `posted_by`.  
- Whether every posting path writes a consistent audit record (e.g. “journal_posted”, “opening_balance_posted”, “adjustment_applied”) and whether “engagement_id” or “firm_id” is stored for each action is implementation-dependent. **Expectation:** every ledger-mutating action is auditable with who, when, and which engagement/firm.

---

# PART 5 — FAILURE PROTECTION

## Silent posting failures

- **Risk:** A post request fails (e.g. period locked, validation error) but the UI or client does not surface the error, or retries create duplicates.
- **Current:** Post routes return 4xx/5xx with reason codes (e.g. PERIOD_CLOSED, INVALID_STATUS_TRANSITION). Manual journal and opening balance posts are idempotent (existing entry returned if already posted). So **partial journal posting** (e.g. one line posted, rest not) is avoided by doing posting in a single RPC transaction.

## Posting without engagement authority

- **Risk:** A user posts to a client for which they no longer have effective engagement or approve access.
- **Current:** Journal post and opening balance post check engagement (getActiveEngagement, isEngagementEffective, access_level === 'approve'). They do not use the single engine; they use onboarding + engagement fetch. So authority is checked, but not via the same predicate as context-check.

## Posting outside effective engagement dates

- **Risk:** Engagement effective_to has passed (or effective_from not yet reached) but posting is still allowed.
- **Current:** Journal post and opening balance post call `isEngagementEffective(engagement)` and reject with ENGAGEMENT_NOT_EFFECTIVE if outside the date window. So this is enforced.

## Summary

- **Silent failures:** Mitigated by explicit error responses and idempotency where applicable.
- **Partial posting:** Mitigated by single-RPC posting (no half-posted journals).
- **Posting without authority / outside dates:** Enforced at route level; authority source is not unified with the engine.

---

# PART 6 — ACCOUNTANT ROLE TIER MODEL

## Defined roles

- **Partner:** Full firm control; create/update/terminate engagements; close/reopen periods; approve and post journals/opening balances/adjustments; manage clients and firm users.
- **Senior:** Approve and post (per AUTHORITY_MATRIX); create journals and adjustments; cannot manage engagements or close periods.
- **Junior:** Create journals, adjustments, opening balance imports (with write access); cannot approve or post.
- **Readonly:** View only; no create, approve, or post.

## Action vs role (documented matrix vs implementation)

| Action | Junior | Senior | Partner | Notes |
|--------|--------|--------|---------|-------|
| Draft journal | YES | YES | YES | create_journal / write access |
| Submit journal | YES | YES | YES | Same as create/edit |
| Approve journal | NO | YES | YES | minFirmRole senior, approve access |
| Post journal | NO | YES (matrix) / NO (code) | YES | **Implementation:** post route requires Partner only. Matrix says Senior. |
| Close period | NO | NO | YES | close_period, reopen_period |
| Modify engagement | NO | NO | YES | create/update/terminate engagement |

**Discrepancy:** Post journal is documented as Senior + approve in `AUTHORITY_MATRIX`, but the journal post route enforces Partner only. Either the matrix should be updated to “Partner only” or the route should allow Senior with approve (per matrix).

---

# PART 7 — ACCOUNTANT WORKSPACE RELIABILITY TARGET

## Accepted engagement → predictable accounting access

- **Target:** Once the owner accepts an engagement and it is effective (date in range), the accountant can access that client’s books (read and, per access level, write/approve) without hidden conditions.
- **Current:** Access depends on effective engagement, but the **implementation** of “allowed” is split between the authority engine (context-check, effective list, many read/write routes) and onboarding + RPC + resolveAuthority (journals, opening balances, period close). So behavior is consistent only if both paths align (same engagement status and dates). RLS and engine/onboarding must stay in sync.

## Client selection → deterministic authority validation

- **Target:** Whenever a client is selected (URL or session), the next request validates authority for that business_id; no route treats “selected” as sufficient without a check.
- **Current:** Routes that use the engine call `checkAccountingAuthority(supabase, user.id, businessId, level)`. Routes that use onboarding call `checkFirmOnboardingForAction` and then engagement checks. So validation is always done, but the **predicate** (engine vs onboarding+engagement) is not single.

## Ledger operations → audit safe

- **Target:** Every ledger-mutating action is logged with who, when, and under which engagement/firm; no silent or untracked posts.
- **Current:** Audit logs exist; RPCs and routes record posted_by and similar. Full “engagement_id on every post” and consistent action_type naming would need to be confirmed for audit-grade completeness.

## Period close → system enforced

- **Target:** No posting into locked periods; close and reopen are explicit, authorized actions with audit.
- **Current:** Posting into locked periods is rejected at API and RPC level. Period close/reopen are gated by authority (RPC + onboarding + resolveAuthority). So system enforcement is in place.

---

# PART 8 — OUTPUTS

## 1. Accountant Workspace Authority Model (authoritative ruleset)

- **Access:** User has access to a client’s books **if and only if:**  
  (1) User is a member of an accounting firm (`accounting_firm_users`), and  
  (2) That firm has an **effective** engagement for that client: `firm_client_engagements` with status `accepted` or `active`, and current date within `effective_from` and `effective_to` (if set).

- **Action level:**  
  - **Read:** Engagement access read (or write/approve).  
  - **Write:** Engagement access write or approve.  
  - **Approve / post / close:** Engagement access approve and firm role Senior or Partner (and, where implemented, Partner-only for post/close).

- **Single predicate:** One function (authority engine) should answer “allowed for this user, business_id, required level.” All routes that grant or deny accountant access should use that function. Today, journal drafts, opening balances, and period close use onboarding + engagement + resolveAuthority instead of the engine; trial balance and some exports use RPC only.

- **Context:** business_id comes from URL or session; it is **input** to the authority check, not the source of authority. Session state does not grant access.

---

## 2. Workspace Responsibility Matrix

| Capability | Service workspace | Accountant workspace |
|------------|-------------------|----------------------|
| Orders, estimates, invoices, credit notes, bills, payments | Create, edit, send, record | No create/edit; read-only view if exposed |
| Ledger (journal_entries) | Indirect via operational posting | Read; write only via journals, adjustments, OB, period close, reconciliation |
| Manual journal drafts | No | Create, submit, approve, post |
| Adjustments | No | Create and apply |
| Opening balance imports | No | Create, approve, post |
| Periods | No | View, close, reopen |
| Reconciliation | No | View, resolve (correction entries) |
| Financial reports | Owner/staff view (service reports) | Full set (TB, BS, P&L, GL, AFS, exports) |
| Engagement accept/reject | Owner only (Service) | No |
| Engagement suspend/terminate | No | Firm (Partner) |

---

## 3. Professional Workflow Map

### Journal lifecycle

1. **Create** (Junior+ with write): Draft created, status `draft`.  
2. **Submit** (creator or same role): Status `submitted`.  
3. **Approve / Reject** (Senior or Partner with approve): Status `approved` or `rejected`.  
4. **Post** (Partner with approve, period not locked): RPC creates ledger entry; draft linked to `journal_entry_id`. Idempotent.

### Period lifecycle

1. **Open:** Posting allowed (manual journals, adjustments, opening balance per period rules).  
2. **Soft close:** Optional intermediate; posting rules per RPC (e.g. adjustments allowed in soft_closed in some flows).  
3. **Lock:** No posting; close workflow and lock propagation enforced.  
4. **Reopen:** Partner-only; period returns to open/soft_closed.

### Adjustment lifecycle

1. **Create and apply** (single step): User with write (or approve) calls apply with lines, reason, optional ref. RPC validates period (open/soft_closed), creates journal entry with `reference_type = 'adjustment'`, writes audit. No separate draft/approve for this path.

### Reconciliation lifecycle

1. **View** (read): Mismatches and scope.  
2. **Propose fix:** Client gets proposal (e.g. journal entry lines).  
3. **Resolve:** Submit with proposal_hash, clientSeen; governance (small delta vs owner/two-person) applied; correction JE posted and resolution recorded. Hash prevents bait-and-switch.

---

## 4. Risk Exposure Report

### Authority bypass risks

- **Multiple authority sources:** Engine vs RPC vs onboarding+resolveAuthority. A change to one could allow or deny access without the other paths being updated; behavior could diverge.
- **RPC vs engine semantics:** `can_accountant_access_business` and `is_user_accountant_write` may not mirror the engine’s “effective engagement + date” rule exactly (e.g. if RLS or RPC uses a different definition of “effective”). This could allow access on one path and deny on another.

### Workflow integrity risks

- **Post role:** Documented “Senior can post” vs “Partner only” in code. Confusion or future “fix” could loosen to Senior without formalizing maker-checker.
- **Maker-checker:** No explicit rule that approver/poster must be different from creator. Same person could create, approve, and post if they are Partner.
- **Period close action types:** `request_close_period`, `approve_close_period`, `reject_close_period` may not be in the authority matrix; fallback to “default allow” could be wrong if they are not explicitly denied for non-Partner.

### Audit risks

- **Consistent audit fields:** Every post (journal, opening balance, adjustment, reconciliation correction) should write who, when, engagement/firm. Need to confirm all RPCs and routes do this in a consistent way.
- **Immutable history:** Adjustments and ledger entries are append-only; reversal is a new entry. Good. Audit log retention and tamper-evidence are operational concerns.

### Multi-workspace confusion risks

- **URL/session business_id:** If a user bookmarks or shares a URL with business_id and later loses engagement (e.g. terminated), the route should deny access. Current routes do re-check; the risk is only if a route ever skipped the check.
- **Service vs accounting “reports”:** Service dashboard and Accounting reports both exist. Clear naming and navigation (e.g. “Accounting workspace → Reports”) reduce confusion.

---

## 5. Enterprise Maturity Gap Analysis

Compared to professional accounting platforms (Xero Practice Manager, QuickBooks Accountant Hub, Sage Practice Suite, practice-management firm tools):

| Area | Finza current | Typical professional platform |
|------|----------------|--------------------------------|
| **Single authority model** | Split (engine + RPC + onboarding) | Single “firm member + engagement” check everywhere |
| **Maker-checker** | Role-based approve/post; same person can create and approve | Often enforced: creator ≠ approver, or dual approval above threshold |
| **Role matrix vs code** | Matrix says Senior can post; code requires Partner | Consistent role matrix and enforcement |
| **Operational dashboard** | Firm metrics and ops pages exist | One screen: reconciliations, period readiness, drafts pending, alerts |
| **Client command center** | Client list with status | Per-client hub: engagement, periods, reconciliation, workload |
| **Audit trail** | audit_logs + created_by/approved_by/posted_by | Full “who approved what when” and “which engagement” on every action |
| **Period close** | Enforced no post to locked; close gated | Same; plus clear “close checklist” and audit of who closed when |
| **Reconciliation** | Hash-locked proposals; governance (delta, owner, two-person) | Similar; plus bank feeds and rule templates (see FEATURE_GAP doc) |

Finza is **past MVP correctness** and **engagement plumbing**; the next step is to align authority to one engine everywhere, harden role matrix vs implementation, and expose a single professional dashboard and per-client command center with full audit visibility. That would bring it in line with “professional accounting control center” expectations.

---

*End of Accountant Workspace Hardening & Professionalization document.*
