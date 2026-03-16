# Cursor Audit — Service Workspace Onboarding Readiness (Real Business)

**Mode:** Read-only. No code changes, refactors, or UI improvements.  
**Scope:** Service workspace only.  
**Goal:** Can a real business onboard end-to-end and operate (invoices, payments, expenses, bills, reports, exports) without blockers, dead links, or firm-only context leaks?

---

## A) Readiness verdict

**NOT READY** — One blocker (expense list fix is in place but must be verified in deployment); several gates depend on migration order and runtime verification. See Blockers and Gates below.

*(If the expense list API fix is deployed and verified, and migrations 265/267 are applied, verdict can be elevated to READY with the listed non-blocking issues.)*

---

## B) Blockers (must-fix before onboarding a real business)

### B1. Expense list empty despite ledger post (FIX DEPLOYED — VERIFY)

- **Symptom:** User creates an expense; it posts to the ledger (journal entry exists) but the expense list page shows no rows.
- **Repro:** Service workspace → Expenses → Add Expense → save → Expenses list; list is empty.
- **Root cause:** `app/api/expenses/list/route.ts` previously used `supabase` from `@/lib/supabaseClient` (browser client). In a Next.js API route that client has no session → `auth.uid()` null → RLS on `expenses` blocks all rows.
- **Fix applied:** List route now uses `createSupabaseServerClient()` and enforces auth + business context (`getUserRole` / `getCurrentBusiness`). File: `app/api/expenses/list/route.ts`.
- **Why it blocked onboarding:** Users assume data is missing or broken; undermines trust.
- **Minimal fix surface:** Already changed (server client + auth). **Action:** Confirm in staging/production that after creating an expense, the list shows it.

### B2. None other identified

No additional blockers were identified from the repo scan. Remaining risks are migration ordering (bills.tax_lines) and runtime checks (balanced JE, export chrome hiding).

---

## C) Non-blocking issues (can ship later)

1. **Activity feed “View all” → accounting workspace**  
   `ServiceActivityFeed.tsx` links “View all” to `/accounting/audit`. Service business owners hitting that route are subject to access control (accounting workspace is firm-only except reconciliation). They may be redirected or see an inappropriate context. Prefer linking to a Service-scoped activity/audit view if one exists, or clarifying that “View all” is for firm users.

2. **Dashboard “General Ledger” vs Service ledger**  
   Main dashboard cards (Service) and Sidebar “General Ledger” use route `/ledger` (root). Service cockpit “Cash Balance” correctly uses `/service/ledger`. `/ledger` uses `/api/ledger/list`, which falls back to `getCurrentBusiness` when `business_id` is not sent, so it works for owners but is inconsistent with the cockpit’s explicit `/service/ledger` link. Consider aligning Service dashboard/Sidebar to `/service/ledger` for consistency.

3. **Export UI for reports**  
   P&L/Balance Sheet/Trial Balance/GL export APIs allow owner via `checkAccountingAuthority`, but the in-app export **UI** (buttons) lives in the accounting workspace (firm-only). Service owners can call export APIs directly but have no export buttons on `/reports/*` or `/service/reports/*`. Document or add export actions to business report pages.

4. **Logo on invoices**  
   Sidebar uses `BusinessLogoDisplay` with `logo_url`. Invoice view/print and preview-draft output should be verified to use business logo where intended (e.g. header); not confirmed in this audit.

5. **VAT returns route**  
   Service Sidebar has “VAT Returns” → `/vat-returns`. Confirm that `/vat-returns` exists and is correct for Service (route exists under `app/vat-returns/`).

---

## D) Smoke-test checklist (exact UI steps, &lt;30 min)

Tester should use a **Service** business (industry = service), not retail and not accountant firm.

1. **Onboarding**
   - Log in as new user → complete business creation and industry selection (Service).
   - Confirm business lands on dashboard and sidebar shows Service menu (Invoices, Expenses, Customers, etc.).

2. **Settings**
   - Open Business Profile / Business Settings; set currency and country if required.
   - Open Invoice Settings and Payment Settings; confirm no errors.

3. **Customer**
   - Customers → Add Customer; save. Confirm it appears in the list.

4. **Product/Service**
   - Products & Services → Add; create one product or service item; save. Confirm it appears.

5. **Invoice and preview**
   - Invoices → Create Invoice; add customer, add line item(s), set date; click **Preview Invoice** before saving. Confirm preview opens (modal or new view) with no broken layout and no requirement to save first.
   - Save invoice; confirm it appears in list. Open it and use “Preview Invoice” again; confirm it works.

6. **Payment**
   - Open a sent/issued invoice → Record Payment; enter amount and date; save. Confirm payment appears and outstanding updates.

7. **Expense and list**
   - Expenses → Add Expense; fill required fields (business, supplier, amount, date); save.
   - Go to Expenses list (same workspace). **Confirm the new expense appears in the list.**
   - (Optional) In accounting/ledger or service ledger, confirm a journal entry exists for that expense (reference_type = expense).

8. **Supplier bill**
   - Bills → Add Bill (or create); fill required fields; save as draft or mark open. Confirm no SQL or “missing column” errors (e.g. tax_lines). Open the bill view; confirm it loads.

9. **Service reports from dashboard**
   - From dashboard, open: Profit & Loss (tile or sidebar → /reports/profit-loss). Confirm P&L loads for current business (no “Firm-Only Context” banner).
   - Open Balance Sheet (/reports/balance-sheet). Same check.
   - Open Service ledger: use “Cash Balance” tile → /service/ledger (or Sidebar “General Ledger” → /ledger). Confirm ledger loads and is not 404.

10. **Export / print**
    - From an invoice view, use Print or Export (if available). Confirm layout hides sidebar and main nav (no buttons/chrome in the printed/exported content). If the app uses ?print=true or /preview/*, confirm export-hide behavior.

11. **No firm-only leak**
    - As Service business owner, click only Service tiles and /reports/* and /service/*. Confirm you never see “Firm-Only Context” or “No client selected” on these pages. (If you click “View all” in Activity and go to /accounting/audit, redirect or firm context is expected.)

12. **Logo**
    - If business has a logo (e.g. uploaded in onboarding or settings), confirm it appears in sidebar and (if applicable) on invoice preview/print.

---

## Hard PASS/FAIL gates (explicit grade)

| # | Gate | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Can create invoice and preview BEFORE saving (no broken preview button) | **PASS** | `app/invoices/new/page.tsx`: Preview button builds `previewData` from form and opens `InvoicePreviewModal` with `previewData` or calls POST `/api/invoices/preview-draft`. `InvoicePreviewModal` supports draft preview via `previewData` / `invoiceId === "preview"`. No requirement to save before preview. |
| 2 | Can create expense and it shows in expenses list afterwards (no “posted but invisible”) | **PASS** (post-fix) | `app/api/expenses/list/route.ts` uses `createSupabaseServerClient()`, enforces auth and business_id (validated via `getUserRole` / `getCurrentBusiness`), and applies `.eq("business_id", businessId)`. RLS sees valid `auth.uid()`. Fix documented in `FORENSIC_AUDIT_EXPENSE_LEDGER_VS_LIST_UI.md`. **Must be verified in deployment.** |
| 3 | Can create supplier bill and mark open WITHOUT SQL errors (no missing column tax_lines) | **PASS** (if migrations applied) | `supabase/migrations/265_add_tax_engine_to_bills.sql` adds `bills.tax_lines JSONB DEFAULT '[]'`. `post_bill_to_ledger` in 267 reads `b.tax_lines` (267, 62). If 265 is applied before 267, no missing column. |
| 4 | Bill posting produces balanced JE (no Debit != Credit) | **PASS** | `post_bill_to_ledger` (267) builds `journal_lines` (expense + tax + AP), then calls `post_journal_entry`, which enforces balance (043 and later). Fallback tax logic keeps total = subtotal + tax = AP. |
| 5 | Service dashboard tiles route to correct Service/business report pages (no firm-only banner) | **PASS** | `ServiceDashboardCockpit.tsx` `DASHBOARD_ROUTES`: revenue/netProfit → `/reports/profit-loss`, expenses → `/service/expenses/activity`, AR/AP/balanceSheet → `/reports/balance-sheet`, cashBalance → `/service/ledger`, trialBalance → `/service/reports/trial-balance`. All are business reports or service routes. `ClientContextWarning` and `AccountingBreadcrumbs` render only when `pathname?.startsWith('/accounting')` (ProtectedLayout 138–146). |
| 6 | Service ledger link works and is not a 404 | **PASS** | `app/service/ledger/page.tsx` exists. Cockpit cashBalance → `/service/ledger`. Page uses `resolveServiceBusinessContext` and fetches ledger via API with business_id. |
| 7 | Export/preview routes hide UI chrome (buttons not visible in export) | **PASS** (implementation) | `lib/exportMode.ts`: export mode when path is `/preview`, `/export`, `/print`, `/pdf` or query has `?print=true` / `?export=true` / `?pdf=true`. `ProtectedLayout` sets `data-export-mode={isExportMode}` and wraps sidebar/nav in `export-hide print-hide`. `app/globals.css`: `[data-export-mode="true"] .export-hide { display: none !important; }`. Invoice view uses `export-hide print-hide` on action areas. **Tester should confirm in browser.** |
| 8 | No hook-order runtime errors in ProtectedLayout/useExportMode | **PASS** | `useExportMode()` is called unconditionally at top level in `ProtectedLayout` and in `ToastProvider`. No conditional or post-early-return hook use. `lib/hooks/useExportMode.ts` uses `usePathname()`, `useSearchParams()`, `useMemo` — standard Next/React hooks. |
| 9 | No duplicate React key warnings on key finance pages | **PASS** (sampled) | `app/expenses/page.tsx`: table rows `key={expense.id}`. `app/reports/profit-loss/page.tsx`: sections `key={section.key}`, rows `key={\`${section.key}-${idx}\`}`. No duplicate key patterns found in sampled files. Full app scan not performed. |
| 10 | Logos uploaded in onboarding render where intended (business header/sidebar/invoice) | **VERIFY** | Sidebar uses `BusinessLogoDisplay` with `sidebarBusiness?.logo_url` from businesses (Sidebar 28, 64–71, 333–334). Invoice preview/print and document header logo usage not fully traced; recommend smoke-test with uploaded logo. |

---

## Repo scan summary

- **Firm-Only Context / resolveAccountingBusinessContext:** Used only under `/accounting/*` (reports, ledger, periods, adjustments, audit, health, exceptions, AFS). Not used by `/reports/*` or `/service/*`. Business reports use `getCurrentBusiness` (e.g. `app/reports/profit-loss/page.tsx`, `app/reports/balance-sheet/page.tsx`).
- **Service dashboard tile routes:** `components/dashboard/service/ServiceDashboardCockpit.tsx` → `DASHBOARD_ROUTES`: all point to `/reports/*` or `/service/*`; none to `/accounting/*`.
- **/service/ledger:** Implemented at `app/service/ledger/page.tsx`; uses `resolveServiceBusinessContext` and ledger API with business_id.
- **useExportMode:** `lib/hooks/useExportMode.ts`; used in `ProtectedLayout` and `ToastProvider`; no conditional hook order.
- **window.alert:** No matches in `app/`; toasts/modals used instead.
- **tax_lines (bills):** Column added in migration 265; `post_bill_to_ledger` (267, 190, etc.) reads `b.tax_lines`; fallback to legacy columns when tax_lines empty.
- **post_bill_to_ledger / trigger_post_bill:** Trigger and function present; balanced JE via `post_journal_entry`.
- **Business reports vs accounting portal:** P&L at `/reports/profit-loss` and Balance Sheet at `/reports/balance-sheet` are business reports (getCurrentBusiness). Accounting portal P&L/BS are under `/accounting/reports/*` and use `resolveAccountingBusinessContext`.

---

**End of audit.**
