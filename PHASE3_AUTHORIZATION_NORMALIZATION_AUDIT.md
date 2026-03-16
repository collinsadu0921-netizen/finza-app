# PHASE 3 — Authorization Normalization Audit (Mechanical)

**Audit type:** Principal authorization systems auditor. Mechanical compliance checking against Phase 2 contract. No fixes, refactors, new logic, or opinions.

**Date:** 2025-01-31.  
**Inputs:** Phase 2 — Canonical Authority & Context Model (Locked); all accounting-related APIs under /api/accounting/** and /api/reports/**; shared auth helpers (getUserRole, requireBusinessRole, can_accountant_access_business, isUserAccountantReadonly, firm + engagement checks).

**Objective:** Produce a complete diff between the Phase 2 Authorization Contract and the actual authorization logic used by every in-scope accounting API. Answer only: Does this endpoint obey the contract? If not, how exactly does it deviate?

**Scope:** APIs that read ledger, write ledger, resolve periods, produce reports, reconcile, adjust, carry forward, manage COA / AFS / opening balances. Excluded: Retail operational RPCs; non-accounting APIs; firm management routes (firm/clients, firm/onboarding, firm/engagements, firm/ops, firm/metrics, firm/firms, firm/activity, firm/bulk, firm/clients/add).

---

## 1. ENDPOINT INVENTORY TABLE

| Endpoint | Action | Requires business_id | Auth mechanism used | Contract-compliant? |
|----------|--------|----------------------|---------------------|---------------------|
| GET /api/accounting/reports/profit-and-loss | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/profit-and-loss/export/csv | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/profit-and-loss/export/pdf | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/balance-sheet | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/balance-sheet/export/csv | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/balance-sheet/export/pdf | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/trial-balance | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/trial-balance/export/csv | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/trial-balance/export/pdf | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/general-ledger | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/general-ledger/export/csv | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reports/general-ledger/export/pdf | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/periods | Read | Yes (query) | can_accountant_access_business | Yes |
| POST /api/accounting/periods/close | Write | Yes (body) | can_accountant_access_business + is_user_accountant_write + firm engagement (when firmId) | Yes |
| GET /api/accounting/periods/readiness | Read | Yes (query) | can_accountant_access_business (after firm onboarding check) | Yes |
| GET /api/accounting/periods/audit-readiness | Read | Yes (query) | can_accountant_access_business | Yes |
| GET /api/accounting/periods/resolve | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| POST /api/accounting/periods/reopen | Write | Yes (body) | checkFirmOnboarding + getActiveEngagement + resolveAuthority (firm path) OR getUserRole (owner path) | Yes |
| GET /api/accounting/trial-balance | Read | Yes (query) | can_accountant_access_business | Yes |
| GET /api/accounting/reconciliation/mismatches | Read | Yes (query) | requireBusinessRole → getUserRole + isUserAccountantReadonly | No |
| POST /api/accounting/reconciliation/resolve | Write | Yes (body) | requireBusinessRole → getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/reconciliation/pending-approvals | Read | Yes (query) | requireBusinessRole → getUserRole | No |
| GET /api/accounting/reconciliation/policy | Read | Yes (query) | requireBusinessRole → getUserRole | No |
| GET /api/accounting/reconciliation/resolution-history | Read | Yes (query) | requireBusinessRole → getUserRole | No |
| GET /api/accounting/reconciliation/[scopeType]/[id] | Read | Yes (query) | requireBusinessRole → getUserRole | No |
| GET /api/accounting/adjustments | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| POST /api/accounting/adjustments/apply | Write | Yes (body) | getUserRole + isUserAccountantReadonly first; firm path (checkFirmOnboarding + getActiveEngagement + resolveAuthority) only after owner/employee pass — firm user 403s at getUserRole | No |
| GET /api/accounting/carry-forward | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| POST /api/accounting/carry-forward/apply | Write | Yes (body) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/coa | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/opening-balances | Read | Yes (query) | None (auth: user only) | No |
| POST /api/accounting/opening-balances | Write | Yes (body) | checkFirmOnboarding + getActiveEngagement (firm path) OR owner check (else) | Yes |
| POST /api/accounting/opening-balances/apply | Write | Yes (body) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/opening-balances/[id] | Read | Implicit (id) | checkFirmOnboarding + getActiveEngagement (firm path) for GET/PATCH | Yes |
| PATCH /api/accounting/opening-balances/[id] | Write | Implicit (id) | Same | Yes |
| POST /api/accounting/opening-balances/[id]/approve | Write | Implicit (id) | checkFirmOnboarding + getActiveEngagement + resolveAuthority | Yes |
| POST /api/accounting/opening-balances/[id]/post | Write | Implicit (id) | checkFirmOnboarding + getActiveEngagement | Yes |
| GET /api/accounting/afs/runs | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/afs/runs/[id] | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/afs/runs/[id]/export/csv | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/afs/runs/[id]/export/pdf | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/afs/runs/[id]/export/json | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| POST /api/accounting/afs/[run_id]/finalize | Write | Yes (body) | getUserRole + isUserAccountantReadonly then checkFirmOnboarding + getActiveEngagement + resolveAuthority (firm path) | Yes |
| GET /api/accounting/afs/documents/[run_id] | Read | Yes (query) | getUserRole + isUserAccountantReadonly | No |
| GET /api/accounting/exports/transactions | Read | Yes (query) | can_accountant_access_business | Yes |
| GET /api/accounting/exports/levies | Read | Yes (query) | can_accountant_access_business | Yes |
| GET /api/accounting/exports/vat | Read | Yes (query) | can_accountant_access_business | Yes |
| GET /api/accounting/journals/drafts | Read | Yes (query: firm_id, client_business_id) | accounting_firm_users + getActiveEngagement + resolveAuthority | No |
| POST /api/accounting/journals/drafts | Write | Yes (body) | checkFirmOnboarding + getActiveEngagement + resolveAuthority | Yes |
| GET /api/accounting/journals/drafts/[id] | Read | Implicit (id) | checkFirmOnboarding + getActiveEngagement + resolveAuthority | Yes |
| PATCH /api/accounting/journals/drafts/[id] | Write | Implicit (id) | Same | Yes |
| POST /api/accounting/journals/drafts/[id]/post | Write | Implicit (id) | checkFirmOnboarding + getActiveEngagement + resolveAuthority | Yes |
| GET /api/accounting/drafts | Read | Yes (query: firm_id, client_business_id) | accounting_firm_users + getActiveEngagement + resolveAuthority | No |
| GET /api/reports/profit-loss | — | — | Returns 410; no business-scoped auth | N/A |
| GET /api/reports/balance-sheet | — | — | Returns 410; no business-scoped auth | N/A |
| GET /api/reports/trial-balance | — | — | Returns 410; no business-scoped auth | N/A |
| GET /api/reports/vat-control | — | — | Returns 410; no business-scoped auth | N/A |
| GET /api/reports/registers | — | — | Returns 410; no business-scoped auth | N/A |
| GET /api/reports/sales-summary | — | — | Returns 410; no business-scoped auth | N/A |
| GET /api/reports/tax-summary | — | — | Returns 410; no business-scoped auth | N/A |
| GET /api/reports/aging | — | — | Returns 410; no business-scoped auth | N/A |

**Notes:**  
- “Requires business_id”: request must supply business_id (or equivalent scope) in query/body or via resource id; 400 if missing where required.  
- “Contract-compliant?”: request is authorized iff (owner OR employee via business_users OR firm user with valid delegation for that business_id) + workspace + read vs write; business_id from request.

---

## 2. DEVIATION CLASSIFICATION

For each **non-compliant** endpoint, the deviation is classified below. Endpoints marked N/A (legacy 410) have no business-scoped auth and are not classified.

---

### GET /api/accounting/reports/profit-and-loss  
- **DELEGATION VIOLATION:** Auth uses getUserRole + isUserAccountantReadonly only. Firm users acting on client business_id have no business_users row; getUserRole returns null → 403. Contract requires owner OR employee OR firm with valid delegation; firm path is not checked.

### GET /api/accounting/reports/profit-and-loss/export/csv  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/profit-and-loss/export/pdf  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/balance-sheet  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/balance-sheet/export/csv  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/balance-sheet/export/pdf  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/trial-balance  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/trial-balance/export/csv  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/trial-balance/export/pdf  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/general-ledger  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/general-ledger/export/csv  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reports/general-ledger/export/pdf  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/periods/resolve  
- **DELEGATION VIOLATION:** Auth uses getUserRole + isUserAccountantReadonly only. Firm path not checked.

### GET /api/accounting/reconciliation/mismatches  
- **DELEGATION VIOLATION:** requireBusinessRole calls getUserRole only. Firm path not checked.

### POST /api/accounting/reconciliation/resolve  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reconciliation/pending-approvals  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reconciliation/policy  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reconciliation/resolution-history  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/reconciliation/[scopeType]/[id]  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/adjustments  
- **DELEGATION VIOLATION:** getUserRole + isUserAccountantReadonly only. Firm path not checked.

### POST /api/accounting/adjustments/apply  
- **DELEGATION VIOLATION:** Firm path (checkFirmOnboarding + getActiveEngagement + resolveAuthority) is only evaluated after owner/employee path passes (getUserRole). Firm user has no business_users row for client → getUserRole returns null → 403 before firm check. Firm path is unreachable for firm-only user.

### GET /api/accounting/carry-forward  
- **DELEGATION VIOLATION:** Same as above.

### POST /api/accounting/carry-forward/apply  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/coa  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/opening-balances  
- **AUTHORITY SCOPE VIOLATION:** No business-scoped authorization. Request requires business_id (query) and checks only that user is authenticated. Any authenticated user can read opening balance import for any business_id. Contract requires owner OR employee OR firm with valid delegation for that business_id.

### POST /api/accounting/opening-balances/apply  
- **DELEGATION VIOLATION:** getUserRole + isUserAccountantReadonly only. Firm path not checked.

### GET /api/accounting/afs/runs  
- **DELEGATION VIOLATION:** getUserRole + isUserAccountantReadonly only. Firm path not checked.

### GET /api/accounting/afs/runs/[id]  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/afs/runs/[id]/export/csv  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/afs/runs/[id]/export/pdf  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/afs/runs/[id]/export/json  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/afs/documents/[run_id]  
- **DELEGATION VIOLATION:** Same as above.

### GET /api/accounting/journals/drafts  
- **DELEGATION VIOLATION:** Auth uses accounting_firm_users + getActiveEngagement + resolveAuthority only. Owner or employee acting on own/assigned business cannot use this endpoint; it requires firm_id and client_business_id and firm membership. Contract requires owner OR employee OR firm with valid delegation; owner/employee path for “list drafts for my business” is not supported (only firm path).

### GET /api/accounting/drafts  
- **DELEGATION VIOLATION:** Same as above. Owner/employee path not supported; only firm path (firm_id + client_business_id).

---

## 3. VIOLATION HEATMAP

**Total endpoints audited (in scope):** 58  
- Accounting: 50 endpoints (GET/POST/PATCH per route as applicable).  
- Legacy /api/reports/*: 8 endpoints (410 only; counted in total but N/A for compliance).

**Counts for compliance and deviation (accounting endpoints only, 50):**

| Metric | Count |
|--------|--------|
| **Compliant** | 20 |
| **Non-compliant** | 30 |
| **N/A (410 only)** | 8 (excluded from compliance %) |

**Compliance rate (50 accounting endpoints):** 19 / 50 = **38% compliant.**

**Deviation type (non-compliant endpoints may have more than one):**

| Deviation type | Endpoints with this violation | % of 50 accounting |
|----------------|------------------------------|----------------------|
| **DELEGATION VIOLATION** | 30 | 60% |
| **AUTHORITY SCOPE VIOLATION** | 1 | 2% |
| **CONTEXT VIOLATION** | 0 | 0% |
| **WORKSPACE LEAKAGE** | 0 | 0% |

**Summary:**

- **Total endpoints audited:** 58 (50 accounting + 8 legacy 410).
- **% compliant (of 50 accounting):** 38%.
- **% violating context:** 0%.
- **% violating delegation:** 60% (30 endpoints use only owner/employee path or only firm path, or firm path is unreachable; contract requires both paths where applicable).
- **% violating authority scope:** 2% (1 endpoint: GET opening-balances has no business-scoped auth).
- **% violating workspace boundaries:** 0%.

---

## 4. ZERO-FIX RULE

No fixes, refactors, or “should” statements have been proposed. This phase ends with facts only.

---

**End of Phase 3. Mechanical audit only.**
