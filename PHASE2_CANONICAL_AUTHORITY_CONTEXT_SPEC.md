# PHASE 2 — Canonical Authority & Context Model (Locked Spec)

**Type:** Locked, explicit contract. Design by extraction only. No new concepts. No implementation.

**Date:** 2025-01-31.  
**Inputs:** Phase 1 Authority, Context & Delegation Audit; existing schemas (businesses, business_users, accounting_firm_users, accounting_firm_clients, firm_client_engagements); RPC can_accountant_access_business; workspace boundaries (Retail, Service, Accounting-First).

**Objective (lock-in):** Answer for every request: **Who is acting? On which business? Under what delegation? From which workspace?**

---

## PART 1 — ACTORS (EXPLICIT)

All actor types that exist **today** in schema and audits:

---

### 1.1 Business Owner

| Attribute | Definition |
|-----------|------------|
| **Identification** | User such that `businesses.owner_id = user_id` for at least one business. |
| **Tables asserting authority** | `businesses` (column `owner_id`). One business may have exactly one owner. |
| **Own business** | Yes. Owner may act on any business they own (owner_id = user_id). |
| **Delegated client business** | N/A. Ownership is direct, not delegation. When an owner is also a firm user, client access (if any) is via firm path, not owner path for that client. |

---

### 1.2 Business Employee

| Attribute | Definition |
|-----------|------------|
| **Identification** | User with at least one row in `business_users` (business_id, user_id, role). Roles include admin, manager, cashier, accountant, employee; optional flag accountant_readonly. |
| **Tables asserting authority** | `business_users` (business_id, user_id, role, accountant_readonly). |
| **Own business** | No. “Own business” is defined by ownership (businesses.owner_id). Employee acts on **assigned** business (business_users.business_id). |
| **Delegated client business** | No. business_users links user to a business directly; there is no “delegated client” for employees. Firm→client is a separate path. |

---

### 1.3 Firm User (Accounting-First)

| Attribute | Definition |
|-----------|------------|
| **Identification** | User with at least one row in `accounting_firm_users` (firm_id, user_id, role). Firm roles in schema: partner, senior, junior, readonly (migration 142); or partner, manager, staff (migration 104). |
| **Tables asserting authority** | `accounting_firm_users` (or `accountant_firm_users` in RPC 105); firm→client link in `firm_client_engagements` (client_business_id, accounting_firm_id, status, access_level) or `accounting_firm_clients` or `accountant_client_access` (RPC). |
| **Own business** | Only if they are also owner or in business_users for that business. Otherwise firm users have no “own business” from ownership/assignment. |
| **Delegated client business** | Yes, when the firm has an active engagement (or equivalent client link) for that business and the user is in that firm. Asserted by firm_client_engagements (status = 'active', access_level, effective_from, effective_to) or by RPC can_accountant_access_business(p_user_id, p_business_id) returning a non-null access level. |

---

### 1.4 System / Automation

| Attribute | Definition |
|-----------|------------|
| **Identification** | No human user_id; ledger posts performed by RPCs or triggers with a designated “posted by” identity (e.g. business.owner_id passed as p_posted_by_accountant_id for Retail sales). |
| **Tables asserting authority** | No user row. Authority is implicit: the calling API has already been authorized (e.g. Retail API called by authenticated user); the RPC executes in a security context that trusts the caller. |
| **Own business** | N/A. Acts on the business_id passed to the RPC by the authorized caller. |
| **Delegated client business** | N/A. System posts are always in the context of a business_id supplied by an authorized request. |

---

## PART 2 — BUSINESS CONTEXT (SINGULAR)

**Single rule** for resolving `business_id` that applies to UI, API, reports, and background jobs.

---

### 2.1 Source of truth for active business

- **At request time (API):** The **authoritative** value of “active business” for a request is the `business_id` that appears in the **request** (query parameter, path, or body) and that the API will use for data scope and authorization. There is no single “session” business_id that APIs read; the client (UI or job) must supply business_id.
- **For owner/employee:** The set of businesses the user may supply is those for which they are owner (`businesses.owner_id`) or have a row in `business_users`. The “current” or “default” business for UI is today resolved by getCurrentBusiness(supabase, userId) (ownership or first business_users row). That resolution is **not** passed to many accounting APIs as a fallback; APIs that require business_id expect it in the request.
- **For firm user:** The set of businesses the user may supply for **client** context is those for which the firm has an active engagement (or equivalent) and the user is in the firm. The “active client” for UI is today stored in sessionStorage (getActiveClientBusinessId). That value must be supplied as business_id in API requests when the firm user is acting on a client.

**Source of truth (canonical):** The **request-scoped** business_id is the source of truth for that request. For UI, the source of truth for “which business I am acting on” must be **one** of: (1) resolved from ownership/assignment (e.g. getCurrentBusiness), or (2) explicit client selection (e.g. getActiveClientBusinessId or URL), and that value must be passed into every API call that is business-scoped.

---

### 2.2 When URL, session, and ownership conflict — which wins?

**Rule (locked):**

1. **API:** The API uses **only** the business_id from the request (query, path, or body). It does not read URL, session, or ownership to infer business_id. If the request omits business_id where required, the API returns 400. Conflict does not arise at API level; the client is responsible for sending the intended business_id.
2. **UI:** For a **single** rule with no ambiguity:
   - **Accounting-First, firm user:** If the user is in `accounting_firm_users` and has **no** row in `businesses.owner_id` or `business_users` for any business (firm-only user), then the active business for accounting flows **must** be the **explicit client selection**: sessionStorage (getActiveClientBusinessId) or URL (e.g. searchParams.business_id), whichever is defined. If both are defined, **URL wins** over session (URL is the explicit navigation target). If neither is defined, there is no valid business context → show “select a client” or equivalent.
   - **Accounting-First, owner/employee:** If the user is owner or in business_users, the active business for accounting flows may be (a) the ownership/assignment-derived business (getCurrentBusiness), or (b) the explicit client selection when they are also a firm user acting on a client. When both apply, **explicit client selection wins** when the user is in the Accounting workspace and has selected a client (so that “open client” is unambiguous). Otherwise ownership/assignment-derived wins.
   - **Service / Retail:** Only ownership/assignment-derived business exists (getCurrentBusiness or equivalent). No firm client selection. No conflict.

**Summary:** **Request (API) = business_id in the call. UI: explicit client selection (URL or session) wins over ownership/assignment when in Accounting-First and a client is selected; otherwise ownership/assignment wins.**

---

### 2.3 How firm users resolve client context

- Firm users resolve **client** context **only** by explicit selection: the client business_id must be chosen from the set of businesses linked to their firm (via firm_client_engagements or accounting_firm_clients / accountant_client_access) and stored or passed as the active context.
- That context must be supplied to every business-scoped API call (as query/body business_id). APIs do not infer “current client” from session or URL; the client sends it.
- Valid client business_id set: those businesses for which there exists an active engagement (status = 'active', within effective_from / effective_to) with the user’s firm and appropriate access_level for the action.

---

### 2.4 How owners resolve their own business

- Owners resolve “own business” by: businesses.owner_id = user_id. If multiple businesses are owned (schema allows it), the canonical resolution used today is “first” by some ordering (e.g. created_at). That resolved value is the default active business when no explicit client selection is in play.
- Same for employees: business_users gives (business_id, user_id, role); “first” or “assigned” business is the default active business when not acting as firm on a client.

---

### 2.5 When business_id is mandatory vs implicit

- **Mandatory:** For every **accounting** API that is business-scoped (reports, periods, reconciliation, adjustments, carry-forward, COA, AFS, opening balances, exports, trial balance, etc.), business_id **must** be supplied in the request. There is no implicit “current business” at API layer. 400 if missing.
- **Implicit:** At **UI** layer, the active business may be **implied** from ownership/assignment (getCurrentBusiness) or from explicit client selection (getActiveClientBusinessId / URL) so that the user does not type business_id by hand. The UI then passes that value explicitly in each API call. So “implicit” only in the sense of UI default; once the request is made, business_id is always explicit in the request.

---

## PART 3 — DELEGATION MODEL (FIRM → CLIENT)

**Exactly** how delegation works, from existing schema and RPC.

---

### 3.1 Tables that assert delegation

- **Firm membership:** `accounting_firm_users` (firm_id, user_id, role). User is in a firm.
- **Firm→client link:** One or both of:
  - `firm_client_engagements` (accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to). Status = 'active' and within date range for the link to be valid.
  - `accounting_firm_clients` (firm_id, business_id, access_level).
  - RPC `can_accountant_access_business(p_user_id, p_business_id)` uses `accountant_firm_users` and `accountant_client_access` (firm_id, business_id, access_level). Returns access_level or NULL.
- Delegation is **asserted** when: user is in accounting_firm_users (or accountant_firm_users), and the firm has an active link to the business (firm_client_engagements with status active, or accounting_firm_clients, or accountant_client_access), and (where applicable) effective_from / effective_to are satisfied.

---

### 3.2 Access levels that exist

- **From schema:**  
  - `accountant_client_access` (RPC): access_level IN ('readonly', 'write').  
  - `accounting_firm_clients`: access_level IN ('read', 'write', 'approve').  
  - `firm_client_engagements`: access_level IN ('read', 'write', 'approve').
- **Semantics (from audits):**  
  - **read / readonly:** May read ledger, reports, periods; no post, no close, no adjust.  
  - **write:** May read and post (e.g. journal drafts, opening balance imports where engagement allows).  
  - **approve:** Required for approve/post flows (e.g. opening balance approve and post, journal draft approve and post). Period reopen and journal draft post use resolveAuthority(firmRole, engagementAccess, action).
- **Firm roles** (accounting_firm_users.role): partner, senior, junior, readonly. Action-level rules (e.g. who may reopen period, who may post draft) are enforced in code (e.g. resolveAuthority); not all actions are expressible as a single access_level in the table.

---

### 3.3 Scope of delegation (API-wide, report-wide, period-wide)

- Delegation is **per (user, business)**. For a given request (user_id, business_id), either the user is owner/employee for that business, or the user is a firm user and the firm has a valid delegation to that business. There is no separate “report-wide” or “period-wide” delegation; the same (user, business) pair either has access or not. Action-level restrictions (read vs write vs approve) apply on top of that.
- So: **API-wide.** Every accounting API that is business-scoped must accept (user_id from auth, business_id from request) and determine access once. No API is “excluded” from delegation by design; if the contract says “firm user may act on client,” then delegation applies to all such APIs consistently (subject to access_level and firm role for the action).

---

### 3.4 Owners as special case or implicit delegation

- **Owners are a special case.** RPC can_accountant_access_business returns 'write' when businesses.owner_id = p_user_id for p_business_id. So “ownership” is treated as full write access without requiring a firm→client row. Owner is **not** “implicit delegation”; ownership is a separate path (businesses.owner_id, business_users). For consistency, any **single** authorization rule must treat owner as: “may act on business_id when owner_id = user_id” and that is equivalent to full write for that business. So in the contract, “owner acting on own business” is one case; “firm user acting on client business” is another; both can be authorized by the same canonical check (e.g. can_accountant_access_business returns write/readonly, or equivalent logic that includes owner).

---

## PART 4 — AUTHORIZATION CONTRACT

**Single rule** that every accounting API must obey.

---

**A request is authorized if and only if the authenticated user is identified and the requested action is permitted for that user and the business_id in the request:**

- **Identity:** The actor is the authenticated user (user_id from session). For system/automation posts, the caller API has already been authorized and supplies business_id and (where applicable) posted_by identity.
- **Business scope:** The request includes a business_id (query, path, or body) that is the scope of the operation.
- **Authority:** One of the following holds:
  1. **Owner:** The user is the owner of the business: `businesses.owner_id = user_id` for that business_id. Then the user has full read and write authority for that business (subject to workspace and action rules below).
  2. **Employee:** The user has a row in `business_users` for that (business_id, user_id) with a role that is allowed for the action (e.g. owner, admin, accountant for accounting actions; accountant_readonly implies read-only). Then the user has authority as defined by that role and flags.
  3. **Firm user acting on client:** The user has a row in `accounting_firm_users` (or accountant_firm_users) and the firm has a valid delegation to the business_id (active firm_client_engagement or accounting_firm_clients / accountant_client_access entry with appropriate access_level and, where applicable, effective dates), and the RPC `can_accountant_access_business(p_user_id, p_business_id)` returns a non-null access level (readonly or write), or equivalent logic using firm_client_engagements is used. The returned access_level and firm role (partner, senior, junior, readonly) then determine whether the specific action (read, post, close period, adjust, reconcile, approve) is allowed.
- **Workspace:** The request originates from a context that is allowed to perform that action: (a) **Retail** must not call accounting APIs for ledger read/post of journal entries, periods, adjustments, or reconciliation; Retail may only trigger operational RPCs (e.g. post_sale_to_ledger). (b) **Service** may read accounting data (reports, reconciliation) for the user’s own business only; Service must not post ledger, close periods, or adjust from Service UI. (c) **Accounting-First** may read and write (subject to access_level and firm role) for own business or delegated client business.
- **Read vs write:** If the action is a write (post, close, adjust, reconcile resolve, approve, etc.), the authority must grant write (or approve where required); readonly / read access_level or accountant_readonly allows only read actions.

---

## PART 5 — WORKSPACE AUTHORITY MATRIX (LOCKED)

Populated from Phase 1 and workspace audit evidence. “Can” = intended authority for that workspace (not “currently implemented” where implementation diverges).

| Workspace        | Can Read Ledger | Can Post Ledger | Can Close Period | Can Adjust | Can Reconcile |
|------------------|-----------------|-----------------|------------------|------------|---------------|
| **Retail**       | No*             | Via RPC only**  | No               | No         | No            |
| **Service**      | Yes***          | No              | No               | No         | Read-only**** |
| **Accounting-First** | Yes         | Yes             | Yes              | Yes        | Yes           |

- \* Retail does not read ledger in the general sense; only one derived value (expected cash for Close Register) is read from the ledger. No reports, no journals, no periods.
- \** Post is only via operational RPCs (post_sale_to_ledger, post_sale_refund_to_ledger, post_sale_void_to_ledger, etc.) triggered by API; no direct journal or adjustment post from Retail.
- \*** Service may read ledger-derived data (reports, reconciliation mismatches) for the **own** business only, when the user is owner or has appropriate role in business_users.
- \**** Reconcile: Service may **read** reconciliation data (mismatches, view); must not **post** resolution (reconcile resolve) from Service workspace. Accounting-First may read and post resolution.

---

## FINAL OUTPUT (MANDATORY)

### 1. Canonical Authority & Context Contract (declarative)

- **Actors:** Business Owner (businesses.owner_id), Business Employee (business_users), Firm User (accounting_firm_users + firm→client link), System/Automation (RPC caller context).
- **Business context:** The active business for a request is the business_id supplied in that request. UI must supply it from exactly one source: ownership/assignment (getCurrentBusiness) or explicit client selection (URL or session); explicit client selection wins when in Accounting-First with a selected client. APIs do not infer business_id from session or URL.
- **Delegation:** Firm→client is asserted by accounting_firm_users plus firm_client_engagements (or accounting_firm_clients / accountant_client_access) with active status and access_level (read/write/approve or readonly/write). RPC can_accountant_access_business(p_user_id, p_business_id) returns that access or 'write' for owner.
- **Authority:** Every accounting API must authorize by: (1) identity = authenticated user, (2) business_id in request, (3) owner OR employee (business_users) OR firm user with valid delegation for that business_id, (4) workspace allowed for the action, (5) read vs write consistent with access_level/role.

---

### 2. Delegation Model Definition

- **Tables:** accounting_firm_users (firm membership); firm_client_engagements or accounting_firm_clients or accountant_client_access (firm→business link with access_level and, for engagements, status and effective dates).
- **Access levels:** read/readonly (read-only), write (read + post), approve (required for approve/post flows). Firm roles (partner, senior, junior, readonly) further restrict which actions a firm user may perform.
- **Scope:** Per (user, business). Same delegation applies API-wide for that pair. No report-wide or period-wide override.
- **Owner:** Treated as full write for own business; RPC returns 'write' for owner. Not “implicit delegation”; separate path in the contract.

---

### 3. Authorization Rule (single paragraph)

**A request is authorized if and only if** the actor is the authenticated user, the request includes the business_id to act on, and one of the following holds: (a) the user is the owner of that business (businesses.owner_id), or (b) the user has a row in business_users for that business with a role and flags that allow the requested action (read or write), or (c) the user is in accounting_firm_users and the firm has a valid delegation to that business (active engagement or client link with appropriate access_level), and the RPC can_accountant_access_business(user_id, business_id) returns a non-null access level (or equivalent check), and that access level and the user’s firm role permit the action (read vs write vs approve). In addition, the request must originate from a workspace that is allowed to perform that action (Retail: no accounting ledger read/post except via operational RPCs; Service: read-only for own business; Accounting-First: read and write for own or delegated client per access_level and firm role).

---

### 4. Workspace Authority Matrix

As in the table in Part 5 above.

---

### 5. Non-Goals (what this model does NOT cover)

- **Implementation:** This spec does not specify how to implement getCurrentBusiness, getActiveClientBusinessId, or API auth checks. It only defines the contract they must satisfy.
- **New tables or roles:** This model does not introduce new schemas, roles, or access levels. It is extracted from existing tables and RPCs.
- **UI/UX:** It does not specify which pages exist, how navigation works, or how to fix “Business not found” in the UI. It states the rule for context (explicit client vs ownership/assignment; URL vs session).
- **Migration of existing APIs:** It does not prescribe which endpoints to change first or how to migrate from current auth to the contract. It locks the target contract only.
- **Background jobs:** It does not define how cron or jobs obtain business_id; it only states that business_id must be determined and supplied and that authorization follows the same rule (identity + business_id + owner/employee/delegation + workspace + read vs write).
- **Audit logging:** It does not define what to log or where. It only defines who is acting and on which business for the purpose of authorization.
- **Multi-tenant isolation:** It assumes business_id is the tenant boundary; it does not define row-level security or tenant isolation beyond “authority for this business_id.”

---

**End of Phase 2. Contract locked. No code, no fixes, no implementation.**
