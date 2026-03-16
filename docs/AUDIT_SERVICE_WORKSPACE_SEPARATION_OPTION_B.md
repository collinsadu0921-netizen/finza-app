# Service Workspace Separation — Option B Audit (READ-ONLY)

**Role:** Principal engineer. **Mode:** Read-only. No code changes, patches, or migrations.  
**Goal (Option B):** Service workspace autonomous UI under `/service/*`; shared Accounting Engine + APIs; Accounting Workspace and firm engagement workflow unchanged.

---

## 1) HARD COUPLING: Service → /accounting/* redirects and links

| File | Line(s) | Snippet | Coupling type |
|------|---------|---------|---------------|
| finza-web/app/service/accounting/audit/page.tsx | 1, 10 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/audit" />` | redirect |
| finza-web/app/service/accounting/health/page.tsx | 1, 10 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/health" />` | redirect |
| finza-web/app/service/accounting/chart-of-accounts/page.tsx | 1, 10 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/chart-of-accounts" />` | redirect |
| finza-web/app/service/accounting/reconciliation/page.tsx | 1, 10 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/reconciliation" />` | redirect |
| finza-web/app/service/reports/trial-balance/page.tsx | 1, 10 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/reports/trial-balance" />` | redirect |
| finza-web/app/service/ledger/page.tsx | 1, 17 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/ledger" search={search} />` | redirect |
| finza-web/app/service/reports/profit-and-loss/page.tsx | 1, 7 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/reports/profit-and-loss" />` | redirect |
| finza-web/app/service/reports/balance-sheet/page.tsx | 1, 7 | `import RedirectToCanonicalAccounting`; `return <RedirectToCanonicalAccounting canonicalPath="/accounting/reports/balance-sheet" />` | redirect |
| finza-web/components/accounting/RedirectToCanonicalAccounting.tsx | 31 | `router.replace("/accounting")` | hard-coded redirect |
| finza-web/components/accounting/RedirectToCanonicalAccounting.tsx | 50 | `router.replace(\`${canonicalPath}?${q.toString()}\`)` (canonicalPath is /accounting/*) | hard-coded redirect |
| finza-web/components/accounting/RedirectToCanonicalAccounting.tsx | 67 | `onClick={() => router.push("/accounting")}` | hard-coded href (button) |
| finza-web/app/service/accounting/contribution/page.tsx | 8, 169 | `import { buildAccountingRoute }`; `const url = \`${buildAccountingRoute("/accounting/ledger", businessId)}&highlight=${journalEntryId}\`` then `router.push(url)` | route-builder + post-submit nav |
| finza-web/app/service/accounting/adjustment/page.tsx | 8, 186 | `import { buildAccountingRoute }`; same pattern as contribution | route-builder + post-submit nav |
| finza-web/app/service/expenses/activity/page.tsx | 11, 35, 36, 39, 42, 43 | `import { buildAccountingRoute }`; ledger/reconcilation links via buildAccountingRoute; fallback `"/accounting"` when no businessId (36, 43) | route-builder + hard-coded fallback |
| finza-web/components/Sidebar.tsx | 8, 174–179, 182, 183, 188 | `import { buildAccountingRoute }`; all Accounting menu items use `buildAccountingRoute("/accounting/...", accountingBusinessId ?? undefined)` | route-builder |
| finza-web/components/dashboard/service/ServiceActivityFeed.tsx | 72 | `href="/accounting/audit"` | hard-coded href |
| finza-web/components/dashboard/service/ServiceDashboardCockpit.tsx | 65, 67 | `cashBalance: q("/accounting/ledger")`; `trialBalance: q("/accounting/reports/trial-balance")` | string literal /accounting/ (route paths in getDashboardRoutes) |

---

## 2) SIDEBAR COUPLING AUDIT (Service industry)

**File:** finza-web/components/Sidebar.tsx

**A) How variables are computed**

- **businessIndustry:** Initial state from `getTabIndustryMode()` (sessionStorage) at lines 22–26. Updated by `loadIndustry(urlBusinessId)` (line 37): if `isAccountingPath && accountingBusinessId` (line 75), fetch `businesses.industry` for that business (74–88); else set from `getTabIndustryMode()` (91).
- **urlBusinessId:** `searchParams.get("business_id")?.trim() ?? null` (line 19).
- **serviceBusinessId:** State (line 29). Set only when NOT on accounting path, industry is "service", and NOT firm user (42–59): async `getCurrentBusiness(supabase, user.id)` → `setServiceBusinessId(business?.id ?? null)`.
- **sidebarBusinessId:** `urlBusinessId ?? (isAccountantFirmUser ? null : serviceBusinessId)` (line 35).
- **accountingBusinessId:** `isAccountantFirmUser ? sidebarBusinessId : (serviceBusinessId ?? urlBusinessId)` (line 167).
- **Accounting section shown when:** `businessIndustry === "service"` and `showAccountingSection === true` (line 168), i.e. `isAccountantFirmUser || accountingBusinessId != null`. So when industry is service, the Accounting section shows if the user is a firm user OR there is a business id (service or URL).

**B) Menu items linking to /accounting/* when industry is service**

| Menu label | Current href | Condition | Desired href (Option B) |
|------------|---------------|-----------|-------------------------|
| Service Accounting | /service/accounting | non-firm only | (unchanged) |
| General Ledger | buildAccountingRoute("/accounting/ledger", accountingBusinessId) → /accounting/ledger?business_id=... | both | /service/ledger?business_id=... (non-firm); keep /accounting/ledger for firm |
| Chart of Accounts | buildAccountingRoute("/accounting/chart-of-accounts", ...) | both | /service/accounting/chart-of-accounts?business_id=... (non-firm) |
| Trial Balance | buildAccountingRoute("/accounting/reports/trial-balance", ...) | both | /service/reports/trial-balance?business_id=... (non-firm) |
| Reconciliation | buildAccountingRoute("/accounting/reconciliation", ...) | both | /service/accounting/reconciliation?business_id=... (non-firm) |
| Accounting Periods | buildAccountingRoute("/accounting/periods", ...) | both | /service/accounting/periods?business_id=... (non-firm) |
| Accounting Activity | buildAccountingRoute("/accounting/audit", ...) | both | /service/accounting/audit?business_id=... (non-firm) |
| Health | buildAccountingRoute("/accounting/health", ...) | firm only (179–184) | keep /accounting/health |
| Control Tower | buildAccountingRoute("/accounting/control-tower") | firm only | keep /accounting/control-tower |
| Forensic Runs | /admin/accounting/forensic-runs | firm only | (unchanged) |
| Tenants | /admin/accounting/tenants | firm only | (unchanged) |
| Accounting Health | buildAccountingRoute("/accounting/health", ...) | non-firm only (186–188) | /service/accounting/health?business_id=... (non-firm) |

---

## 3) POST-SUBMIT NAVIGATION COUPLING

| File | Line(s) | Where highlight/journalEntryId created | Destination route | Recommended service-native destination |
|------|---------|----------------------------------------|--------------------|----------------------------------------|
| finza-web/app/service/accounting/contribution/page.tsx | 144–170 | 167: `data.journal_entry_id` from POST /api/accounting/journals/drafts response | `/accounting/ledger?business_id=...&highlight={journalEntryId}` (router.push at 170) | /service/ledger?business_id=...&highlight=... |
| finza-web/app/service/accounting/adjustment/page.tsx | 160–187 | 184: `data.journal_entry_id` from same POST | Same | /service/ledger?business_id=...&highlight=... |

**Expenses/activity (links, not post-submit):** finza-web/app/service/expenses/activity/page.tsx lines 35, 39, 42 — getViewLink returns ledger or reconciliation URL via buildAccountingRoute. Recommended service-native: /service/ledger?business_id=...&highlight=... and /service/accounting/reconciliation?business_id=...

---

## 4) WRAPPER PAGES (Service pages that only redirect)

| Service page path | Canonical accounting destination | Minimal service-native page needs |
|-------------------|----------------------------------|-----------------------------------|
| finza-web/app/service/accounting/audit/page.tsx | /accounting/audit | UI shell + GET /api/accounting/audit?businessId=... (business from URL or resolveServiceBusinessContext) |
| finza-web/app/service/accounting/health/page.tsx | /accounting/health | UI shell + GET /api/accounting/periods, GET /api/accounting/reconciliation/pending-approvals (same as current /service/health data) |
| finza-web/app/service/accounting/reconciliation/page.tsx | /accounting/reconciliation | UI shell + reconciliation APIs (mismatches, resolve, etc.) |
| finza-web/app/service/accounting/chart-of-accounts/page.tsx | /accounting/chart-of-accounts | UI shell + GET /api/accounting/coa?business_id=... |
| finza-web/app/service/reports/trial-balance/page.tsx | /accounting/reports/trial-balance | UI shell + trial balance API (accounting or reports route per existing contract) |
| finza-web/app/service/ledger/page.tsx | /accounting/ledger | UI shell + ledger/listing API; support ?business_id= and &highlight= (and optional search) |
| finza-web/app/service/reports/profit-and-loss/page.tsx | /accounting/reports/profit-and-loss | UI shell + P&amp;L report API |
| finza-web/app/service/reports/balance-sheet/page.tsx | /accounting/reports/balance-sheet | UI shell + balance sheet API |

---

## 5) SHARED API DEPENDENCY INVENTORY (service callers only)

| Caller file | Line(s) | API route | Method | Purpose | Auth in API route |
|-------------|---------|-----------|--------|---------|-------------------|
| finza-web/app/service/accounting/contribution/page.tsx | 76 | /api/accounting/coa | GET | Load COA | checkAccountingAuthority(..., "read"); owner allowed |
| finza-web/app/service/accounting/contribution/page.tsx | 120 | /api/accounting/periods/resolve | GET | Resolve period for date | checkAccountingAuthority(..., "read"); owner allowed |
| finza-web/app/service/accounting/contribution/page.tsx | 144 | /api/accounting/journals/drafts | POST | Create contribution draft | checkAccountingAuthority(..., "write"); firm branch uses getActiveEngagement/resolveAuthority; owner allowed via auth |
| finza-web/app/service/accounting/adjustment/page.tsx | 72 | /api/accounting/coa | GET | Load COA | same as coa above |
| finza-web/app/service/accounting/adjustment/page.tsx | 136 | /api/accounting/periods/resolve | GET | Resolve period | same as periods/resolve above |
| finza-web/app/service/accounting/adjustment/page.tsx | 160 | /api/accounting/journals/drafts | POST | Create adjustment draft | same as journals/drafts above |
| finza-web/app/service/health/page.tsx | 51 | /api/accounting/periods | GET | Load periods | checkAccountingAuthority(..., "read"); owner allowed |
| finza-web/app/service/health/page.tsx | 63 | /api/accounting/reconciliation/pending-approvals | GET | Pending approvals | checkAccountingAuthority(..., "read"); owner allowed |
| finza-web/components/dashboard/service/ServiceActivityFeed.tsx | 29 | /api/accounting/audit | GET | Audit logs | checkAccountingAuthority(..., "read"); owner allowed (app/api/accounting/audit/route.ts 36) |
| finza-web/components/dashboard/service/ServiceLedgerIntegrity.tsx | 20, 21 | /api/admin/accounting/forensic-runs, /api/admin/accounting/forensic-failures/summary | GET | Latest run, failure summary | Admin/firm context; not under app/api/accounting/* (under admin) |

**Summary:** All `/api/accounting/*` endpoints called from service use `checkAccountingAuthority`, which authorizes owner, business_users (admin/accountant), or firm via engine. No endpoint used by service is firm-only or accountant-only; owner is allowed.

---

## 6) ROUTING CONTRACTS

**Current accounting patterns:**

- `?business_id=...` (required for client-scoped pages).
- Optional `&highlight=...` (journal entry id for ledger).
- Optional `&entry_id=...` (some flows).
- Optional `search` (e.g. ledger search) passed through RedirectToCanonicalAccounting.

**Service-native contract (names only):**

- `/service/ledger?business_id=...&highlight=...` (and optional search)
- `/service/accounting/periods?business_id=...`
- `/service/accounting/audit?business_id=...`
- `/service/accounting/health?business_id=...`
- `/service/accounting/reconciliation?business_id=...`
- `/service/accounting/chart-of-accounts?business_id=...`
- `/service/reports/trial-balance?business_id=...`
- `/service/reports/profit-and-loss?business_id=...`
- `/service/reports/balance-sheet?business_id=...`

Firm-only routes remain `/accounting/control-tower`, `/accounting/health` (for firm menu), `/admin/accounting/*`. No implementation in this audit.

---

# REQUIRED OUTPUT FORMAT (STRICT)

## A) Coupling map

**1) Redirect components**

- finza-web/components/accounting/RedirectToCanonicalAccounting.tsx (19–20, 31, 50, 67): component that redirects to `/accounting` or `/accounting/*?business_id=...`; used by 8 service wrapper pages.
- finza-web/app/service/accounting/audit/page.tsx (10)
- finza-web/app/service/accounting/health/page.tsx (10)
- finza-web/app/service/accounting/chart-of-accounts/page.tsx (10)
- finza-web/app/service/accounting/reconciliation/page.tsx (10)
- finza-web/app/service/reports/trial-balance/page.tsx (10)
- finza-web/app/service/ledger/page.tsx (17)
- finza-web/app/service/reports/profit-and-loss/page.tsx (7)
- finza-web/app/service/reports/balance-sheet/page.tsx (7)

**2) Route-builder usage**

- finza-web/app/service/accounting/contribution/page.tsx (169): buildAccountingRoute("/accounting/ledger", businessId) then router.push
- finza-web/app/service/accounting/adjustment/page.tsx (186): same
- finza-web/app/service/expenses/activity/page.tsx (35, 39, 42): buildAccountingRoute("/accounting/ledger", ...), buildAccountingRoute("/accounting/reconciliation", ...)
- finza-web/components/Sidebar.tsx (174–179, 182, 183, 188): buildAccountingRoute("/accounting/ledger", ...), chart-of-accounts, reports/trial-balance, reconciliation, periods, audit, health, control-tower, health again
- finza-web/components/dashboard/service/ServiceDashboardCockpit.tsx (65, 67): path strings "/accounting/ledger", "/accounting/reports/trial-balance" in getDashboardRoutes

**3) Hard-coded hrefs**

- finza-web/components/accounting/RedirectToCanonicalAccounting.tsx (31, 67): router.replace("/accounting"), router.push("/accounting")
- finza-web/components/dashboard/service/ServiceActivityFeed.tsx (72): href="/accounting/audit"

**4) Post-submit navigations**

- finza-web/app/service/accounting/contribution/page.tsx (167–170): after POST journals/drafts, buildAccountingRoute("/accounting/ledger", businessId)&highlight=journalEntryId, router.push(url)
- finza-web/app/service/accounting/adjustment/page.tsx (184–187): same

**5) Wrapper pages**

- All 8 in table of section 4 above: audit, health, reconciliation, chart-of-accounts, trial-balance, ledger, profit-and-loss, balance-sheet under app/service/** — each body is only RedirectToCanonicalAccounting.

---

## B) Separation plan (minimal, ordered)

1. **New service routes to create (names only):**  
   `/service/ledger`, `/service/accounting/audit`, `/service/accounting/health`, `/service/accounting/reconciliation`, `/service/accounting/chart-of-accounts`, `/service/accounting/periods`, `/service/reports/trial-balance`, `/service/reports/profit-and-loss`, `/service/reports/balance-sheet`.

2. **Which wrapper pages become real pages:**  
   All 8 wrapper pages (audit, health, reconciliation, chart-of-accounts, trial-balance, ledger, profit-and-loss, balance-sheet): replace redirect with a service-native UI shell that calls the same shared APIs and uses business_id from URL or resolveServiceBusinessContext.

3. **Sidebar link swaps (exact menu items):**  
   In Sidebar when `businessIndustry === "service"` and **non–firm user**: change General Ledger, Chart of Accounts, Trial Balance, Reconciliation, Accounting Periods, Accounting Activity, Accounting Health to service-native routes (e.g. /service/ledger?business_id=..., /service/accounting/chart-of-accounts?business_id=..., etc.). When **firm user**: keep General Ledger, Chart of Accounts, Trial Balance, Reconciliation, Accounting Periods, Accounting Activity, Health, Control Tower, Forensic Runs, Tenants pointing to /accounting/* or /admin/accounting/*.

4. **Post-submit redirects mapping:**  
   Contribution page (169–170) and adjustment page (186–187): after successful POST, navigate to `/service/ledger?business_id=...&highlight={journalEntryId}` instead of accounting ledger. Expenses/activity getViewLink (35, 39, 42): use /service/ledger and /service/accounting/reconciliation with business_id (and highlight where applicable).

5. **Explicit statement of preserving firm access:**  
   Firms and accountants continue to use the Accounting workspace at `/accounting/*`. Sidebar when `isAccountantFirmUser === true` keeps all Accounting menu items pointing to `/accounting/*` (and /admin/accounting/*). No removal or replacement of accounting routes; service-native routes are for service (owner/employee) users only. Optionally add a single “Open in Accounting” link on service pages for firm users.

---

## C) Risk list (5–10 max)

1. **business_id resolution** — New service pages that call `/api/accounting/*` must have business_id (URL or resolveServiceBusinessContext). Missing or wrong business_id can cause 400/403 or wrong data. **File:** any new app/service/** page.

2. **RLS and auth** — All service calls go through same APIs; checkAccountingAuthority allows owner. If a new service page calls a different endpoint or omits business_id, RLS or auth can block or leak. **Files:** app/api/accounting/* routes; RLS on ledger, periods, accounts.

3. **Highlight on /service/ledger** — Ledger page must read `highlight` from query and scroll/focus that journal entry. If service ledger uses different data shape or component, deep-link may break. **File:** new app/service/ledger/page.tsx (or equivalent).

4. **Sidebar accountingBusinessId on /service/*** — serviceBusinessId is set only when not on accounting path (Sidebar 42–58). If user navigates to /service/ledger (or other /service/*) without business_id, sidebar may not have serviceBusinessId if getCurrentBusiness runs after path is already /service/*. **File:** components/Sidebar.tsx (42–59, 167).

5. **RedirectToCanonicalAccounting removal** — Replacing wrapper pages with real content must not break bookmarks or links that still point at /service/ledger etc.; those routes should render the new page, not redirect away. **Files:** app/service/**/page.tsx (8 wrapper pages).

6. **Dashboard/service components** — ServiceActivityFeed and ServiceLedgerIntegrity are used in dashboard; changing their links or APIs affects the dashboard when industry is service. **Files:** components/dashboard/service/ServiceActivityFeed.tsx (72), ServiceLedgerIntegrity.tsx (20–21).

7. **Firm vs non-firm branch in Sidebar** — If the condition that switches links (isAccountantFirmUser vs not) is wrong, firm users could get service links without context or owners could get accounting links and redirect. **File:** components/Sidebar.tsx (167, 169–189).

8. **Reports API choice** — Service may use /api/reports/* vs /api/accounting/reports/* for P&amp;L and balance sheet; confirming which is used and keeping service-native reports consistent avoids wrong or missing data. **Files:** app/accounting/reports/* vs app/reports/* and their API usage.

---

## D) Non-goals

- **No DB or RPC changes** — Database schema, triggers, and RPCs remain unchanged.
- **No /api/accounting/* changes** — All accounting API routes stay as-is; shared by both workspaces.
- **No removal of /accounting/*** — Accounting workspace routes remain; no deprecation or redirect of accounting URLs.
- **No firm engagement workflow changes** — Hybrid period close (engagement vs no-engagement), firm onboarding, and resolveAuthority logic are unchanged; separation is UI and routing only.
