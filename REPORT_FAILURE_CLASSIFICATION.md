# Report Failure Classification

**Audit type:** Principal accounting systems architect — evidence only.  
**Scope:** Accounting report APIs and legacy report APIs; classification of failure causes. No fixes, evidence only.

---

## 1. Accounting report endpoints (canonical)

Endpoints under `/api/accounting/reports/*` and their possible failure responses:

| Endpoint | Failure cause | HTTP | Response body / message | Classification |
|----------|----------------|------|-------------------------|-----------------|
| GET /api/accounting/reports/profit-and-loss | Missing business_id | 400 | "Missing required parameter: business_id" | CONFIGURATION |
| GET /api/accounting/reports/profit-and-loss | Missing period_start | 400 | "PHASE 10: period_start is required. Canonical P&L requires an accounting period." | CONFIGURATION |
| GET /api/accounting/reports/profit-and-loss | User not admin/owner/accountant | 403 | "Unauthorized. Only admins, owners, or accountants can view profit & loss." | AUTHORIZATION |
| GET /api/accounting/reports/profit-and-loss | ensure_accounting_period or refetch failed | 500 | "Accounting period could not be resolved" | DATA ABSENCE (period not found/created) |
| GET /api/accounting/reports/profit-and-loss | RPC get_profit_and_loss_from_trial_balance error | 500 | rpcError.message or "Failed to fetch profit & loss" | DATA ABSENCE / RLS/DB |
| GET /api/accounting/reports/balance-sheet | Missing business_id | 400 | "Missing required parameter: business_id" | CONFIGURATION |
| GET /api/accounting/reports/balance-sheet | Missing period_start | 400 | "PHASE 10: period_start is required. Canonical Balance Sheet requires an accounting period." | CONFIGURATION |
| GET /api/accounting/reports/balance-sheet | 403 | Same role message | AUTHORIZATION |
| GET /api/accounting/reports/balance-sheet | ensure/refetch failed | 500 | "Accounting period could not be resolved" | DATA ABSENCE |
| GET /api/accounting/reports/balance-sheet | Balance sheet unbalanced (invariant) | 500 | "Balance Sheet is unbalanced", balancingDifference, etc. | DATA ABSENCE (integrity) |
| GET /api/accounting/reports/trial-balance | Missing business_id | 400 | "Missing required parameter: business_id" | CONFIGURATION |
| GET /api/accounting/reports/trial-balance | Missing period_start | 400 | "PHASE 10: period_start is required. Canonical Trial Balance requires an accounting period." | CONFIGURATION |
| GET /api/accounting/reports/trial-balance | 403 | Role message | AUTHORIZATION |
| GET /api/accounting/reports/trial-balance | ensure/refetch failed | 500 | "Accounting period could not be resolved" | DATA ABSENCE |
| GET /api/accounting/reports/trial-balance | Trial balance unbalanced | 500 | "Trial Balance is unbalanced", imbalance, etc. | DATA ABSENCE (integrity) |
| GET /api/accounting/reports/general-ledger | Missing business_id or account_id | 400 | "Missing required parameter: business_id" / "account_id" | CONFIGURATION |
| GET /api/accounting/reports/general-ledger | Neither period_start nor start_date+end_date | 400 | "Either period_start or both start_date and end_date must be provided" | CONFIGURATION |
| GET /api/accounting/reports/general-ledger | 403 | Role message | AUTHORIZATION |
| GET /api/accounting/reports/general-ledger | Account not found / wrong business | 404 | "Account not found or does not belong to business" | DATA ABSENCE |
| GET /api/accounting/reports/general-ledger | period_start used and ensure/refetch failed | 500 | "Accounting period could not be resolved" | DATA ABSENCE |
| GET /api/accounting/trial-balance | Missing business_id or period (YYYY-MM) | 400 | "business_id parameter is required" / "Period parameter is required (format: YYYY-MM)" | CONFIGURATION |
| GET /api/accounting/trial-balance | No period for YYYY-MM (no ensure) | 404 | "Accounting period not found for period: {periodParam}" | DATA ABSENCE |
| GET /api/accounting/periods/resolve | Missing business_id or from_date | 400 | "Missing required parameter: business_id" / "from_date" | CONFIGURATION |
| GET /api/accounting/periods/resolve | No period covers dates (including after ensure) | 404 | "No accounting period covers the selected dates." | DATA ABSENCE |
| GET /api/accounting/periods/resolve | User no access to business | 403 | "Unauthorized. No access to this business." | AUTHORIZATION |

---

## 2. Legacy report endpoints (Service / non-Accounting)

Endpoints under `/api/reports/*` that use ledger data. Evidence: these return **410 Gone** with message directing to accounting workspace.

| Endpoint | Failure cause | HTTP | Classification |
|----------|----------------|------|-----------------|
| GET /api/reports/profit-loss | Ledger-based report | 410 | INTENTIONAL BLOCK |
| GET /api/reports/balance-sheet | Ledger-based report | 410 | INTENTIONAL BLOCK |
| GET /api/reports/trial-balance | Ledger-based report | 410 | INTENTIONAL BLOCK |
| GET /api/reports/vat-control | Ledger-based report | 410 | INTENTIONAL BLOCK |
| GET /api/reports/registers | Ledger-based report | 410 | INTENTIONAL BLOCK |
| GET /api/reports/sales-summary | Ledger-based report | 410 | INTENTIONAL BLOCK |
| GET /api/reports/tax-summary | Ledger-based report | 410 | INTENTIONAL BLOCK |
| GET /api/reports/aging | Ledger-based report | 410 | INTENTIONAL BLOCK |

Evidence: `app/api/reports/profit-loss/route.ts`, `balance-sheet/route.ts`, `trial-balance/route.ts`, `vat-control/route.ts`, `registers/route.ts`, `sales-summary/route.ts`, `tax-summary/route.ts`, `aging/route.ts` — return 410 with message that report uses ledger data and to use accounting workspace reports.

---

## 3. Failure classification definitions

| Classification | Meaning | Example |
|----------------|---------|--------|
| **CONFIGURATION** | Missing or invalid required parameters (business_id, period_start, account_id, date range). | 400 missing period_start / business_id. |
| **CONTEXT** | Caller context wrong (e.g. Service workspace calling report without first resolving period; wrong business/period for user). | Service not calling resolve first (mitigated by current flow: resolve then report). |
| **AUTHORIZATION** | User lacks role or access (not admin/owner/accountant or no access to business). | 403 Unauthorized. |
| **DATA ABSENCE** | Period does not exist or cannot be created; snapshot/ledger empty or RPC fails; invariant violation (unbalanced). | 500 "Accounting period could not be resolved"; 404 no period; 500 unbalanced. |
| **INTENTIONAL BLOCK** | API designed to reject request (e.g. legacy ledger report returns 410). | 410 from /api/reports/*. |

---

## 4. Per-failing-report classification summary

### 4.1 P&L (Accounting)

- Missing period_id → API uses **period_start**; missing period_start → **CONFIGURATION** (400).
- Missing business_id → **CONFIGURATION** (400).
- Workspace context mismatch → No explicit workspace check on report API; same auth (admin/owner/accountant). If Service calls with wrong business/period, **CONTEXT** or **AUTHORIZATION** depending on access.
- RLS → Can cause empty data or RPC error → **DATA ABSENCE** or 500.
- API guard → 403 for wrong role → **AUTHORIZATION**.
- ensure_accounting_period / refetch failure → **DATA ABSENCE** (500 "Accounting period could not be resolved").

### 4.2 Balance Sheet (Accounting)

- Same as P&L for period/business/guard/ensure. Plus: unbalanced balance sheet → **DATA ABSENCE** (500).

### 4.3 Trial Balance (Accounting reports + YYYY-MM route)

- Reports route: same as P&L; plus unbalanced → **DATA ABSENCE**.
- YYYY-MM route: no ensure; period not found → **DATA ABSENCE** (404).

### 4.4 General Ledger (Accounting)

- Missing account_id or business_id or both period_start and start_date/end_date → **CONFIGURATION**.
- Account not found → **DATA ABSENCE** (404).
- Period resolution failure when period_start used → **DATA ABSENCE** (500 "Accounting period could not be resolved").

### 4.5 Service-embedded P&L / Balance Sheet

- Failure to load report after resolve: if resolve returned 404, Service shows "No accounting period covers the selected dates" (no report call) → **DATA ABSENCE** (handled as message).
- If resolve 200 but report 500 "Accounting period could not be resolved" → **DATA ABSENCE** (ensure/refetch failed server-side).
- If report 400 period_start required → **CONTEXT** (bug if Service should always pass period_start from resolve).

### 4.6 Legacy /api/reports/* (profit-loss, balance-sheet, trial-balance, vat-control, registers, etc.)

- All return **410** with message to use accounting workspace → **INTENTIONAL BLOCK**.

---

## 5. Accounting Workspace Declaration (Step 5 — document only)

> **Accounting workspace is the canonical authority for:**  
> ledger, periods, reconciliation, adjustments, and reports.  
> Other workspaces may only read via explicit, resolved context.

- **Ledger:** Posting and reads are governed by Accounting APIs and RPCs; report data comes from Trial Balance snapshot or general ledger functions.
- **Periods:** Resolution, close, reopen, and readiness are Accounting workspace; Service (or other workspaces) may call resolve and read-only report endpoints with explicit business_id and period_start (or resolved period).
- **Reconciliation / Adjustments:** Only Accounting workspace can post adjustments and reconciliation resolutions.
- **Reports:** Canonical P&L, Balance Sheet, Trial Balance, General Ledger live under `/api/accounting/reports/*` and require explicit business and period (or date range where allowed). Legacy `/api/reports/*` ledger reports are intentionally blocked (410).

No enforcement implemented in this audit — documentation only.

---

*End of Report Failure Classification. No code or behavior changes.*
