# Finza Accounting-First Workspace Audit — Vision Alignment Check

**Audit type:** Principal accounting systems architect and auditor. Evidence only. No code. No fixes. No suggestions.

**Date:** 2025-01-31.  
**Scope:** Accounting-First workspace as a standalone professional environment: UI, APIs, ledger authority, period control, reconciliation, multi-client handling.

---

## 1. Purpose Check (Ground Truth)

### What this workspace is

- **Entry and audience:** Routes under `/accounting/*` are **only** accessible to users who have a row in `accounting_firm_users` (i.e. belong to an accounting firm). Business owners (Retail/Service) are **blocked** from the accounting workspace and redirected to `/retail/dashboard` or `/dashboard`; the only exception is Service-mode business owners, who may access `/accounting/reconciliation` only (read-only signpost from dashboard discrepancy banner) (`lib/accessControl.ts` lines 132–184, 165–169).
- **Firm onboarding:** After signup with `signup_intent = 'accounting_firm'`, users are directed to `/accounting/firm/setup` if they have no firm; firm creation and firm onboarding completion are implemented (`app/accounting/firm/setup/page.tsx`, `app/api/accounting/firm/onboarding/complete/route.ts`).
- **Client linkage:** The app uses `accounting_firm_clients` (API: `app/api/accounting/firm/clients/route.ts`) and `firm_client_engagements` (RLS and posting logic in migrations 146, 147, 148, 150, 151, 155). Firm dashboard lists clients and allows “Open client” → set active client and navigate to `/accounting?business_id=${client.business_id}` (`app/accounting/firm/page.tsx` lines 646–647).
- **Opening balance imports:** UI describes “Create and manage opening balance imports for **external clients**” (`app/accounting/page.tsx` lines 96–98). Flow is firm-scoped: select client from session (`getActiveClientBusinessId`), create/edit/post opening balance imports for that client; posting uses `post_opening_balance_import_to_ledger` and writes `journal_entries.accounting_firm_id` (`lib/accounting/openingBalanceImports.ts`, migrations 150, 151, 189).
- **Manual journal drafts:** Drafts are scoped by firm and client (`manual_journal_drafts.accounting_firm_id`, `client_business_id`); posting writes `journal_entries.accounting_firm_id` (migration 148, `lib/accounting/manualJournalDraftPosting.ts`).

**Evidence:** `lib/accessControl.ts` (workspace boundary, firm-only access, Service reconciliation exception); `app/accounting/page.tsx`, `app/accounting/firm/page.tsx`, `app/accounting/opening-balances-imports/*`, `app/accounting/journals/drafts/*`; firm/client APIs and migrations above.

### Who it is for

- **Intended:** Users in `accounting_firm_users` (accounting firm staff). The UI and copy assume firm setup, client list, and “open client” workflow.
- **Not intended (and blocked):** Retail business owners (redirect to `/retail/dashboard`). Service/other business owners (redirect to `/dashboard`), except read-only `/accounting/reconciliation`.

### What authority it holds

- **Route-level:** Only firm users can reach `/accounting/*` (other than the Service reconciliation exception). Within accounting, `accountant_readonly` restricts to a subset of routes (e.g. ledger, trial-balance, periods, exceptions, adjustments, afs); full firm users can also access opening-balances, carry-forward, chart-of-accounts, journals/drafts, opening-balances-imports, firm setup/onboarding (`lib/accessControl.ts` 264–291, `lib/routeGuards.ts` 36–57).
- **API-level:** Authority is **split** (see §2 and §5). Some APIs use the RPC `can_accountant_access_business(p_user_id, p_business_id)` and thus allow firm users to act on **client** businesses. Many others use `getUserRole(supabase, user.id, businessId)` / `getCurrentBusiness(supabase, user.id)` / `requireBusinessRole(..., businessId)`, which resolve only from `businesses.owner_id` or `business_users`; firm users have no row there for client businesses, so those APIs return 403 or “Business not found.”

**Conclusion (Purpose):** The workspace is **designed** for professional accountants/firms and supports external clients (opening balance imports, manual journal drafts, firm client list). It can operate independently in the sense that firm users never need a Retail/Service business to enter the accounting workspace. **Independence is undermined** by the fact that core report and reconciliation flows do not authorize firm users for client businesses (see §2, §5).

---

## 2. Ledger Authority

### Sole authority for period management, adjustments, reconciliation, closing, audit corrections

- **Period list, close, readiness, audit-readiness:** Use `can_accountant_access_business`. Firm users with access to a client business can list periods, close, check readiness, and run audit-readiness for that client (`app/api/accounting/periods/route.ts`, `close/route.ts`, `readiness/route.ts`, `audit-readiness/route.ts`).
- **Period resolve:** Uses `getCurrentBusiness` + `getUserRole` with the resolved business. It does **not** call `can_accountant_access_business`. So when an accountant calls with a client’s `business_id`, resolve uses the **current user’s** business (or null); firm users get 403 “Unauthorized. No access to this business.” (`app/api/accounting/periods/resolve/route.ts`; `REPORT_FAILURE_CLASSIFICATION.md`).
- **Adjustments, carry-forward, COA, AFS, opening-balances apply:** Use `getCurrentBusiness` / `getUserRole` (or equivalent). No use of `can_accountant_access_business` in those routes. Firm users acting on a client get 403 or no business.
- **Reconciliation (mismatches, resolve):** Use `requireBusinessRole(supabase, businessId, { allowedRoles: ["owner", "admin", "accountant"] })`, which calls **only** `getUserRole(supabase, user.id, businessId)`. `getUserRole` checks `businesses.owner_id` and `business_users`; it does **not** check firm delegation. So firm users get 403 FORBIDDEN when requesting reconciliation for a client (`app/api/accounting/reconciliation/mismatches/route.ts`, `resolve/route.ts`; `lib/auth/requireBusinessRole.ts`).
- **Trial balance (legacy route):** `GET /api/accounting/trial-balance` uses `can_accountant_access_business` — firm users can access client data. The **report** routes under `/api/accounting/reports/trial-balance` (and P&L, balance-sheet, general-ledger) use `getUserRole` / `isUserAccountantReadonly` with the **request’s** `business_id`; `getUserRole` returns null for firm user + client → 403.
- **Exports (transactions, levies, VAT):** Use `can_accountant_access_business` — firm users can export for clients (`app/api/accounting/exports/transactions/route.ts`, `levies/route.ts`, `vat/route.ts`).

So: **period list/close/readiness/audit-readiness, trial-balance (legacy), and exports** respect firm→client delegation. **Period resolve, all report APIs (P&L, BS, GL, trial-balance report), adjustments, carry-forward, COA, AFS, opening-balances apply, and reconciliation** do **not**; they effectively restrict to business owner or `business_users` only.

### No other workspace can override ledger truth

- **Retail:** Cannot access `/accounting/*`; ledger writes only via RPCs (`post_sale_to_ledger`, etc.) triggered by operational actions. No direct ledger mutation from Retail UI.
- **Service:** Cannot access accounting workspace except `/accounting/reconciliation` (read-only). No evidence that Service can close periods, post adjustments, or write journal entries.
- **Ledger writes from Accounting-First:** Manual journal drafts and opening balance imports post via RPCs that INSERT into `journal_entries` / `journal_entry_lines`; adjustments and reconciliation resolve post via their own RPCs. All are under accounting workspace or API auth.

**Evidence:** `lib/accessControl.ts` (Retail/Service block); `app/api/accounting/*` (which routes use `can_accountant_access_business` vs `getUserRole`/`requireBusinessRole`); Retail audit (no direct ledger UI).

### Ledger immutability

- **Application:** No API or UI was found that UPDATEs or DELETEs existing rows in `journal_entries` or `journal_entry_lines` for posted data. Corrections are done by posting new entries (e.g. adjustments, reversal + correct).
- **Database:** A trigger `trigger_prevent_journal_entry_modification` exists; migration 189 disables it only temporarily to backfill `posting_source`. Migrations 134, 135, 136, 137 contain UPDATEs to `journal_entries` inside RPCs (e.g. carry-forward, opening balance flows); 052 contains a DELETE in a migration (one-off/fix context). So immutability is enforced at DB level for normal application use; any UPDATE/DELETE is in controlled, migration-defined logic.

**Conclusion (Ledger authority):** Accounting-First is the **only** workspace that can drive period close, adjustments, reconciliation, and manual/import posting. **But** within Accounting-First, **firm users cannot use** period resolve, financial reports (P&L, BS, GL, trial-balance report), adjustments, carry-forward, COA, AFS, opening-balances apply, or reconciliation for **client** businesses, because those APIs do not use firm delegation. Ledger immutability is enforced; no other workspace overrides ledger truth.

---

## 3. Client Models

### Internal Finza businesses

- **As “client” of a firm:** A Finza business can be linked to an accounting firm via `accounting_firm_clients` / `firm_client_engagements`. The firm dashboard and client list use these; “Open client” sets active client and navigates with `business_id`.
- **As “owner” viewing own books:** A business owner (in `businesses.owner_id` or `business_users`) uses `getCurrentBusiness` → gets their business. Report and reconciliation pages that use `getCurrentBusiness` for `businessId` work for the owner; they do **not** work for a firm user viewing that same business as a client (no delegation in those APIs).

### External (non-Finza) client books

- **Opening balance imports:** Explicitly for “external clients.” Data is imported per client business; posting creates journal entries with `accounting_firm_id` and `business_id`. The client is a Finza **business** entity (same schema); “external” here means clients whose books the firm manages, not necessarily a different platform.
- **No separate “external platform” connector** was found (e.g. import from Xero/QuickBooks). External client **books** are represented as businesses in Finza with opening balance (and optionally manual journal) data entered by the firm.

### Mixed client portfolios

- Firm dashboard lists multiple clients; active client is stored in session (`getActiveClientBusinessId` / `setActiveClientBusinessId`). Some accounting pages use **only** `getCurrentBusiness` (reports, periods, reconciliation, adjustments, carry-forward, opening-balances, coa, afs, exceptions); others use **only** `getActiveClientBusinessId()` (opening-balances-imports, journals/drafts, drafts). So:
  - **Firm-client flows:** Opening balance imports, journal drafts, drafts list — use active client → can call APIs that use `can_accountant_access_business` (e.g. periods list).
  - **Report/period/reconciliation flows:** Use `getCurrentBusiness` → for firm users this is **null** → “Business not found” or no data. They do **not** read active client from session or URL for initial load.

### Whether importing external books breaks invariants

- Opening balance import posting is done in RPCs that enforce one opening balance per business (e.g. `input_hash` / idempotency), link to period, and balance debits/credits. No evidence found that importing breaks ledger invariants; the risk is misconfiguration (wrong period, wrong accounts) rather than duplicate or unbalanced posts.

### Whether connected Finza businesses remain source-of-truth

- Ledger and period data for a business live in `journal_entries`, `journal_entry_lines`, `accounting_periods`, etc., keyed by `business_id`. There is a single ledger per business; no duplicated ledger tables. Connected Finza businesses are the source of truth for their own `business_id`; the firm does not maintain a separate copy of the ledger, only access to it via delegation where implemented.

**Conclusion (Client models):** Internal and external clients are both represented as businesses. Mixed portfolios are supported in the UI (client list, active client) and in APIs that use `can_accountant_access_business`. **Invariant risk** from imports is low if RPCs and validations are correct; **source-of-truth** is single ledger per business. The main gap is that many core flows (reports, period resolve, reconciliation, adjustments, etc.) do **not** treat the active client as the context for firm users — they rely on `getCurrentBusiness`, which is null for firm-only users.

---

## 4. Collaboration Reality

### How accountants interact with Finza Retail clients

- **Retail business as client:** If the firm adds the Retail business as a client (engagement), the firm user can use: period list/close/readiness/audit-readiness, legacy trial-balance route, exports (transactions, levies, VAT), opening balance imports, and journal drafts for that client. They **cannot** use: report APIs (P&L, BS, GL, trial-balance report), period resolve, reconciliation, adjustments, carry-forward, COA, AFS, or opening-balances apply — those return 403 or “Business not found” for firm user + client.
- **Retail business owner:** Cannot access `/accounting/*` at all (redirect). So the accountant cannot “share” the accounting workspace with the Retail owner; collaboration is one-way (firm views/manages what the APIs allow).

### How accountants interact with Finza Service clients

- **Service business as client:** Same as above for APIs. Service owner can open `/accounting/reconciliation` read-only (signpost from dashboard); they do not get full accounting workspace.
- **Service business owner:** Blocked from rest of `/accounting/*`.

### Clients who only export data

- **Export/import workflows:** Exports (transactions, levies, VAT) support firm users via `can_accountant_access_business`. So accountants can export client data. Import path is **opening balance imports** (and manual entry via drafts); there is no “import from file” or “sync from external system” in the scope audited. So “export from Finza” is first-class for firms; “import into Finza” is opening balance (and manual) only.
- **Accounting-First does NOT assume clients are on Finza:** The UI allows adding clients (businesses) and managing their books (periods, opening balances, drafts). It does **not** assume the client uses Retail or Service UI; the client could be a business that only exists for the firm (e.g. data entered by firm). So the **model** supports “client not on Finza” (firm-managed only). The **experience** is incomplete because report and reconciliation APIs do not authorize firm users for client `business_id`.

**Conclusion (Collaboration):** Accountants can use a subset of Accounting-First (periods, trial-balance legacy route, exports, opening balance imports, journal drafts) for Finza Retail/Service clients. They **cannot** use the main financial reports, period resolve, reconciliation, adjustments, carry-forward, COA, AFS, or opening-balances apply for those clients. Export is first-class for firms; import is opening balance + manual. The design does not assume clients use Finza, but the implementation of “accountant viewing client” is only partial.

---

## 5. Reporting Authority

### Which reports are exclusive to Accounting-First

- **Canonical report APIs** under `/api/accounting/reports/*`: profit-and-loss, balance-sheet, general-ledger, trial-balance (and their CSV/PDF exports). These use ledger and trial balance snapshots; they are the canonical source for P&L, BS, GL, TB in the product. Only the accounting workspace links to these; Service/Retail do not (Retail gets 410 on legacy `/api/reports/*`; Service uses some dashboard data but not these report routes for full reports).
- **Legacy `/api/reports/*`** (profit-loss, balance-sheet, trial-balance, vat-control, registers, sales-summary, tax-summary, aging) return **410 Gone** with message to use accounting workspace reports (`REPORT_FAILURE_CLASSIFICATION.md`). So ledger-based reporting is **exclusive** to the accounting workspace in practice.

### Which reports are shared (read-only) with other workspaces

- **Service:** Can access `/accounting/reconciliation` read-only. No evidence of shared read-only report endpoints for P&L/BS/GL/TB to Service or Retail; those report APIs live under accounting and are not called by Service/Retail UI with delegation.
- **Retail:** No accounting report access; 410 on legacy report endpoints.

### How period resolution is enforced

- **Report APIs:** Require `period_start` (or equivalent) that must match an accounting period; they call `create_system_accounts` and use RPCs that take `period_id` or period-derived range. Period is enforced in the API and RPC layer.
- **Period resolve:** `GET /api/accounting/periods/resolve` resolves period from `from_date`; it uses `getUserRole`/`getCurrentBusiness` and does **not** use `can_accountant_access_business`, so firm users get 403 when resolving for a client.

### Accounting reports as canonical; others consume, not compute

- **Canonical:** P&L, BS, GL, TB are produced from trial balance snapshots / ledger via `/api/accounting/reports/*`. No other workspace computes these from ledger; legacy report routes are blocked (410).
- **Consume not compute:** Service and Retail do not compute P&L/BS/GL/TB; they would consume only if given a link or embed that calls the accounting report APIs. Currently, firm users **cannot** successfully call those report APIs for client businesses (403), so “accounting reports as canonical” holds for **owner** viewing own business, but **not** for accountant viewing client.

**Conclusion (Reporting authority):** Reporting is **exclusive** to Accounting-First and **canonical**. Period resolution is enforced in report and period APIs. The breach of “others consume, not compute” is that **accountants (firm users) cannot consume** the main report APIs for client businesses, because those APIs do not use firm delegation.

---

## 6. Boundary Enforcement

### What Accounting-First can do that others cannot

- **Access:** Only firm users (and the Service reconciliation exception) can reach `/accounting/*`. Retail and Service owners are blocked.
- **Period close, readiness, audit-readiness:** Only accounting APIs; firm users can use them for clients where `can_accountant_access_business` is used.
- **Posting:** Manual journal drafts, opening balance imports, adjustments, reconciliation resolve — only from accounting workspace/APIs. Retail/Service do not post these.
- **Reports:** Only accounting workspace uses canonical report APIs; legacy report endpoints return 410 to non-accounting usage.

### What it must never allow others to do

- **Retail/Service:** Must not close periods, post adjustments, post manual journals, or post opening balance imports from their workspace. Enforced by route blocking (no access to accounting) and by API auth (report/period/adjustment APIs use business/firm checks).
- **Overriding ledger:** No workspace can UPDATE/DELETE posted journal entries; immutability is enforced at DB and by design (corrections via new entries).

### Where boundaries are soft or unclear

- **Firm user vs client business:** The boundary between “firm user acting on own firm” and “firm user acting on client business” is **inconsistent**. Delegation exists in DB and RPC (`can_accountant_access_business`), and in some APIs (periods, trial-balance legacy, exports, opening balance list/post, journal drafts). It is **absent** in: report APIs (P&L, BS, GL, TB report), period resolve, reconciliation, adjustments, carry-forward, COA, AFS, opening-balances apply. So the “accounting workspace is for firms and their clients” boundary is only partly enforced at the API layer.
- **RPC vs app table names:** `can_accountant_access_business` (migration 105) references `accountant_firm_users` and `accountant_client_access`. The app and later migrations use `accounting_firm_users`, `accounting_firm_clients`, and `firm_client_engagements`. If the RPC was never updated to use the newer tables, firm–client access could depend on legacy tables; schema drift would be a risk. (Not verified: whether both naming schemes exist and are populated.)
- **UI vs API:** Report and reconciliation **pages** use `getCurrentBusiness` to set `businessId`; they do not use `getActiveClientBusinessId()` or URL `business_id` for initial load. So even if the APIs were later fixed to use `can_accountant_access_business`, the current report/reconciliation UI would not pass a client context for firm users (they would still see “Business not found”).

**Conclusion (Boundaries):** Accounting-First is strictly the only place that can perform period close, adjustments, reconciliation, and manual/import posting. Soft/unclear boundaries are: (1) firm user → client access is only partially implemented in APIs and UI, and (2) possible RPC vs app table naming/schema drift for firm–client checks.

---

## 7. Alignment Verdict

### Score: **58%**

- **Rationale:** The workspace is **correctly** scoped to firms, supports client list and active client, and uses delegation in a subset of APIs and in opening balance/journal draft flows. Ledger authority and immutability are in place; no other workspace overrides the ledger. **However**, the majority of core accounting workflows (financial reports, period resolve, reconciliation, adjustments, carry-forward, COA, AFS, opening-balances apply) do **not** authorize firm users for client businesses, and the corresponding UI uses `getCurrentBusiness` so firm users get no business context on those pages. That contradicts the stated purpose of “professional accountants and firms” and “external client books.”

### What is architecturally correct

- Accounting workspace is firm-only at route level; Retail/Service owners are blocked (with one read-only exception).
- Single ledger per business; no duplicated ledgers; ledger immutability enforced.
- Period list/close/readiness/audit-readiness, legacy trial-balance, and exports use `can_accountant_access_business` and support firm→client.
- Opening balance imports and manual journal drafts are firm- and client-scoped; posting records `accounting_firm_id` and uses controlled RPCs.
- Report APIs are canonical; legacy report endpoints return 410 so ledger-based reporting is confined to accounting.
- Reconciliation and adjustments use `requireBusinessRole` (strict); they simply do not yet include firm delegation.

### What is incomplete

- **Report APIs and report UI:** All of `/api/accounting/reports/*` (P&L, BS, GL, TB and exports) use `getUserRole`/`getCurrentBusiness`/role checks with no `can_accountant_access_business`. Report pages set `businessId` from `getCurrentBusiness` only → firm users get “Business not found.”
- **Period resolve:** Uses `getUserRole`/`getCurrentBusiness`; no firm delegation → 403 for firm user + client.
- **Reconciliation (mismatches, resolve):** Use `requireBusinessRole` → `getUserRole` only → 403 for firm user + client.
- **Adjustments, carry-forward, COA, AFS, opening-balances apply:** Same pattern; no firm delegation.
- **UI consistency:** Pages that should support “firm user viewing client” (reports, periods, reconciliation, adjustments, etc.) do not use `getActiveClientBusinessId()` or URL `business_id` for initial business context; they rely on `getCurrentBusiness`, which is null for firm-only users.

### What threatens long-term integrity

- **Split auth model:** Two patterns coexist: `can_accountant_access_business` (firm→client) and `getUserRole`/`getCurrentBusiness`/`requireBusinessRole` (owner/business_users only). New features may copy the wrong pattern and perpetuate “no access for firm viewing client.”
- **RPC vs app schema:** If `can_accountant_access_business` still references `accountant_client_access` / `accountant_firm_users` while the app uses `accounting_firm_clients` / `firm_client_engagements` / `accounting_firm_users`, delegation could fail or depend on legacy data; any migration that retires old tables without updating the RPC would break firm access.
- **UX vs capability:** The firm dashboard invites “Open client” and sends users to `/accounting?business_id=...`, but the main report and reconciliation flows then fail (403 or no business). That undermines trust and makes the “accounting-first for firms” story inconsistent.

---

**End of audit. Evidence only; no fixes or suggestions.**
