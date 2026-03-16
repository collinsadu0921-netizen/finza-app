# Accountant Workspace — Scope and Architecture

**Role:** Principal systems architect audit and redesign scope.  
**Constraints:** No code, no RLS/migration changes, no features, no UI aesthetics. Authority, scope, and correctness only.

---

## 1. ACCOUNTANT WORKSPACE SCOPE (AUTHORITATIVE)

### 1.1 What an accountant CAN do

- **Ledger**
  - Read journal entries and journal entry lines for engaged client businesses only.
  - Filter by date range, account, reference type.
  - Export or view ledger-derived data (no mutation).

- **Journals**
  - Create, submit, and (where role allows) approve and post manual journal drafts for an engaged client.
  - View journal drafts and their status for that client.
  - Posting is subject to period open and engagement access_level (e.g. approve).

- **Adjustments**
  - Create, submit, and (where role allows) approve and post adjustment journals for an engaged client.
  - View adjustment history for that client.

- **Periods**
  - View accounting periods for an engaged client.
  - Close and reopen periods when firm role and engagement access allow (e.g. Partner/Senior, approve).
  - View period status (open, closed) and blocking conditions.

- **Reports**
  - Run and view ledger-derived reports for an engaged client: trial balance, balance sheet, profit and loss, general ledger.
  - Export reports (e.g. CSV, PDF) for that client.
  - Reports are read-only aggregations of posted data.

- **Opening balances**
  - Create, approve, and post opening balance imports for an engaged client when access and period allow.
  - View opening balance import status and history.

- **Reconciliation**
  - View reconciliation state and mismatches for an engaged client’s accounts.
  - Resolve mismatches (where access allows) by creating or linking to correcting entries.

- **Client and firm context**
  - See a list of client businesses for which they have effective engagement (accepted/active, within effective dates).
  - Select one client as “current” and perform all above actions in that context.
  - View firm-level metadata (firm name, own role) and client business name/id for the selected client.

### 1.2 What an accountant CANNOT do

- **Operational documents (service workspace ownership)**
  - Cannot create, edit, or delete orders, estimates, invoices, credit notes, bills, or payments for the client.
  - Cannot send invoices, record payments, or mark invoices paid on behalf of the client.
  - Cannot change client business profile, products, or customers in the service/operational sense.

- **Ledger and books**
  - Cannot delete or edit existing journal entries or journal entry lines.
  - Cannot alter historical ledger data; only add new entries through approved flows (manual journals, adjustments, opening balances, period-close effects).

- **Engagement lifecycle (client-facing decisions)**
  - Cannot accept or reject engagements; only the business owner can (Service workspace).
  - Can suspend, resume, or terminate engagements when firm role allows (e.g. Partner/Senior); this is firm-side lifecycle, not acceptance.

- **Client list**
  - Cannot see or select businesses with which the firm has no effective engagement (no “pending only” or “outside effective window” access).
  - Cannot act in a client context that has not been explicitly selected (or auto-selected when exactly one effective client).

### 1.3 What an accountant MUST NEVER do

- **Bypass engagement**
  - Must never read or write ledger, periods, or reports for a business without an effective engagement (accepted/active, within effective_from/effective_to).

- **Bypass firm membership**
  - Must never act as an accountant for a client if the user is not a member of an accounting firm that holds that engagement.

- **Mutate operational documents**
  - Must never create or modify invoices, payments, or orders from the Accounting workspace; those remain Service workspace and business-owner authority.

- **Use session/URL as authority**
  - Must never treat “current client in session” or “business_id in URL” as sufficient for access; authority must be re-validated server-side on every request using firm membership + engagement.

- **Assume RLS is the only guard**
  - Must never rely solely on RLS for accountant access; application layer must enforce the same authority condition so that failures are deterministic and testable.

---

## 2. AUTHORITY MODEL (SINGLE SOURCE OF TRUTH)

### 2.1 Proposed canonical condition: “Accountant has access”

**Single condition (both required):**

1. **Firm membership**  
   The user has at least one row in `accounting_firm_users` (any role).

2. **Effective engagement**  
   For the chosen client `business_id`, there exists a row in `firm_client_engagements` such that:
   - `accounting_firm_id` is one of the user’s firms (from 1),
   - `client_business_id` = the chosen business_id,
   - `status` is `accepted` or `active`,
   - Today’s date (or the relevant check date) is in the window: `effective_from <= date` and (`effective_to` is null or `effective_to >= date`).

**No other conditions.** In particular:

- “Access” is not “invitation visible” or “engagement exists but pending.”
- “Access” is not “business row visible via RLS” in isolation (RLS may expose businesses for other reasons; authority for accounting actions must be effective engagement).
- “Access” is not “client is selected in the UI” or “business_id is in the cookie/URL”; those are context, not authority.

### 2.2 How the three factors combine

- **Firm membership**  
  Defines “this user is an accountant for some firm.” Without it, the user is not in the Accountant Workspace authority set at all.

- **Engagement status**  
  Only `accepted` or `active` count. `pending`, `suspended`, `terminated` do not grant access. Acceptance (by the business owner) is the gate.

- **Effective dates**  
  Engagement must be “in effect” on the date of the action. This avoids future-dated or expired engagements granting access.

All three are necessary. The single source of truth for “can this accountant act for this business?” is: **effective engagement exists for (user’s firm, business_id)**. One function (e.g. the existing authority engine) should implement this and be the only place that defines “effective.”

### 2.3 What must NOT be part of the authority decision

- **UI session state**  
  Whether the client is selected in the ClientSelector, or stored in sessionStorage/cookie, must not define authority. It only supplies the candidate `business_id`; authority is then checked for that id.

- **URL or query params**  
  `business_id` in the URL is input to the check, not the check itself.

- **Resolver ordering**  
  “First URL, then session, then getCurrentBusiness” is a resolution order for *which* business_id to use, not *whether* the accountant is allowed. The latter must be a separate, single predicate.

- **Presence in “effective list”**  
  The effective client list should be *derived* from the same authority rule (effective engagement), not a separate rule that might drift.

---

## 3. CURRENT FAILURE POINTS

Why engagement can be accepted but the accountant still cannot access books, categorized.

### 3.1 Authority design

- **No single predicate.**  
  Access is the AND of seven layers (firm membership, engagement row, status, effective dates, businesses RLS, accounting table RLS, resolver/session). A single missing or inconsistent layer (e.g. RLS allows, but resolver returns no context) causes “accepted but no access.”

- **Effective logic duplicated.**  
  “Effective” is implemented in the authority engine, in the effective-engagements API, in context-check, and in RLS (businesses policy does not enforce effective dates). Duplication allows one path to allow and another to deny.

- **Businesses RLS is looser than application effective rule.**  
  `has_firm_engagement_with_business` does not filter by status or effective dates. So a firm can see a business row (e.g. pending) while the application “effective” list excludes it, or the engine denies access. Mismatch causes confusion and fragile behavior.

### 3.2 Resolver design

- **Two different resolvers for two workspaces.**  
  Service uses `resolveServiceBusinessContext` (getCurrentBusiness + owner_id). Accounting uses `resolveAccountingBusinessContext` (URL → session → getCurrentBusiness). They can return different “current” business or NO_CONTEXT for the same user, so invitation/accept flow and accounting context are not aligned by design.

- **Session client is not derived from authority.**  
  The “active client” is set by UI (ClientSelector, context-check autoSelect). If the user lands with a stale or wrong client id, authority is then checked for that id and may fail; the user does not get “the one client you can access” unless the list and selection are driven by the same effective rule.

- **Resolver returns business_id, not “allowed.”**  
  Resolver answers “which business_id should we use?” It does not answer “is this accountant allowed for this business_id?” So callers must remember to call the authority check separately; if they forget or assume “if resolver returned id then allowed,” failures follow.

### 3.3 Session/state design

- **Client context is browser state.**  
  sessionStorage and cookie can be cleared, wrong tab, or out of date. If the only way to have a business_id is “user picked it” or “autoSelect ran once,” then reload or new device can leave the user with no context even when they have an effective engagement.

- **No server-side “current client” for accountant.**  
  There is no server-authoritative “this session’s client”; only client-side storage. So every request that needs business_id gets it from URL or cookie and re-validates. That is correct, but the UX assumption “I already selected a client” conflicts with “we don’t persist that on the server,” so any loss of client state looks like “no access.”

### 3.4 RLS coupling

- **Multiple tables and policies.**  
  accountant_firm_users, firm_client_engagements, businesses, journal_entries, journal_entry_lines, accounting_periods, trial_balance_snapshots each have their own policies. All must align with “effective engagement” for the same firm/user/business. If one policy is stricter or looser (e.g. businesses without effective-date check), behavior is inconsistent.

- **Recursion risk.**  
  Businesses RLS for firms depends on firm_client_engagements; engagement policies depend on businesses. The recursion fix (SECURITY DEFINER helper) is correct but illustrates tight coupling; any change to “who sees what” can require coordinated RLS and helper changes.

### 3.5 UX assumptions

- **“Accept” implies “I can open books.”**  
  Users expect that after the owner accepts, the accountant can immediately open that client’s books. The system does not guarantee that: effective dates, client selection, and “effective list” must all align. So the mental model (“accept → access”) is not the implemented model (“accept + effective + selected client + same rule everywhere”).

- **“I have one client” should be enough.**  
  When there is exactly one effective client, the system can auto-select and redirect. If that logic lives only in context-check and depends on cookie/URL being empty, and the user already has a different client in session, they may not get auto-select and may see redirect or “no context” instead of “your one client.”

---

## 4. PROPOSED IMPROVEMENTS (NO CODE)

### 4.1 Authority flow

- **One function, one rule.**  
  All accountant access decisions (API routes, context-check, effective list) must call a single authority function: “for this user and this business_id, is there an effective engagement?” No inlined engagement queries or status/date filters elsewhere. The existing engine is a step in this direction; every path that grants “accountant can see this client” must use it (or an equivalent single implementation).

- **Authority in, context out.**  
  Inputs: `user_id`, `business_id`, optional `required_level` (read/write/approve). Output: allowed/denied, reason, and optionally firm_id, engagement_id, level. No input from session or URL to the *decision*; session/URL only supply the candidate business_id that is then passed into this function.

- **Effective list = authority applied to candidates.**  
  The list of “clients I can work with” must be computed by: for each (firm, business_id) pair the user’s firms have an engagement for, call the same authority function; include only those where allowed. No separate “effective” query that duplicates status/date logic.

### 4.2 Resolver simplification

- **Accounting resolver only chooses business_id.**  
  Resolver’s job: given URL, session, and user, return one business_id (or “none”). It must not imply “you are allowed”; it only answers “which client context are we using.” Every route that needs “allowed for this client” must then call the authority function with that business_id.

- **No resolver for “am I allowed?”**  
  “Am I allowed?” is never answered by “resolver returned a value.” It is answered only by the canonical authority function. So: resolver → business_id; authority(business_id) → allowed/denied.

- **Optional: server-side “last used client” for accountant.**  
  To reduce dependency on browser state, the server could store “last business_id this firm user worked on” (e.g. per user or per session) and the resolver could use it as a fallback when URL and cookie are empty. This is a small extension of “context,” not a change to the authority rule.

### 4.3 Workspace boundary clarity

- **Explicit contract: Accounting workspace is read-ledger + controlled writes.**  
  Document and enforce: accountant can read ledger and reports; can create/submit/approve/post only through defined flows (journals, adjustments, opening balances, period close). No creation or edit of invoices, payments, or orders in this workspace. This reduces ambiguity and prevents future “convenience” features that blur the boundary.

- **Accept/reject only in Service workspace.**  
  Only the business owner (Service) can accept or reject engagements. Accounting workspace can only suspend/resume/terminate (firm-side). This is already the case; making it an explicit part of the contract avoids drift.

### 4.4 Client context handling

- **Context-check must validate with authority.**  
  When the request has a business_id (URL or cookie), context-check must call the authority function. If not allowed, respond with “no valid client” and redirect to client picker (or auto-select if exactly one effective client). Never return “hasClient: true” for a business_id that fails the authority check.

- **Client picker list = authority-derived.**  
  The list of clients in the picker must be exactly the set of business_ids for which the authority function returns allowed. No separate query that could include pending or out-of-window engagements.

- **Auto-select when exactly one.**  
  If the user has no business_id in URL/session but has exactly one effective client (per authority function), return that as autoSelect so the UI can set context and redirect. This preserves “one client → no picker needed.”

### 4.5 Mental model alignment

- **User-facing message after accept.**  
  After the owner accepts, the product should show a clear message to the accountant: “You can now access [Client]’s books. Open the Accounting workspace and select [Client] if needed.” This aligns expectation (“accept → access”) with the actual requirement (“accept + select client in Accounting workspace”).

- **Clear “no access” reasons.**  
  When authority denies access, the reason (e.g. NOT_ACCEPTED, NOT_EFFECTIVE, NO_ENGAGEMENT) should be available so support and logs can diagnose without guessing. The authority function already returns reasons; surfaces that do not expose internals can still show a generic “You don’t have access to this client’s books” with a stable code for logging.

- **Testable guarantee.**  
  Define one acceptance criterion: “For every (user, business_id) where the authority function returns allowed, the user can load at least one accounting page (e.g. ledger) for that business_id without 403 and with data scoped to that business.” This makes “reliable after acceptance” testable and avoids regressions.

---

## 5. NEW ACCOUNTANT WORKSPACE CONTRACT (SHORT)

- **Scope**  
  The Accountant Workspace is for viewing and managing the ledger, journals, adjustments, periods, opening balances, and reports for client businesses. It does not create or edit operational documents (orders, invoices, payments). Only businesses with an effective engagement (accepted/active, within effective dates) are in scope.

- **Authority**  
  A user has access to a client’s books if and only if: (1) they are a member of an accounting firm, and (2) that firm has an effective engagement for that client (status accepted or active, current date within effective_from/effective_to). One canonical function implements this; all routes and context checks use it. Session and URL only supply the client id; they do not grant access.

- **Context**  
  The “current client” is chosen by URL, then session/cookie, then (optionally) server-side “last used.” That choice is validated on every request: if the authority function denies the chosen client, the response is “no valid context” and the user is redirected to pick a client or to the single effective client when there is exactly one.

- **Integrity**  
  Ledger and accounting data are immutable once posted. The accountant can only add new entries through approved flows (manual journals, adjustments, opening balances, period close). Operational documents (invoices, payments) are owned by the Service workspace and business owner; the accountant never mutates them from the Accounting workspace.

- **Reliability**  
  Acceptance by the business owner, plus effective dates, is the only engagement-side condition for access. No additional hidden conditions (e.g. “must have opened the client once” or “must have cookie set”). The effective client list and “can I access this client?” use the same rule so that “I see the client in the list” and “I can open their books” are the same thing.

---

*End of scope and architecture document.*
