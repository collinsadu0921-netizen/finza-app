# Service Workspace: Capabilities, Suggestions & Real-Life Ratings

## 1. All Capabilities of Service Workspace

### 1.1 SERVICE OPERATIONS (Core)

| Capability | Route / Entry | Description |
|------------|----------------|-------------|
| **Dashboard** | `/dashboard` | Service-focused dashboard: invoicing shortcuts, customers, products/services, expenses, reports, accounting links, reconciliation, assets, audit, recurring, payroll, settings. Uses `ServiceDashboardCockpit` with revenue/expenses/AR/AP/cash, timeline, health panel, activity feed, ledger integrity, accounting activity widget. |
| **Invoices** | `/invoices` | Create, list, view, and manage invoices. |
| **Payments** | `/payments` | Record and track payments. |
| **Quotes (Estimates)** | `/estimates` | Create and manage quotes/estimates; convert to invoice/order. |
| **Orders** | `/orders` | Manage orders (e.g. from estimates). |
| **Recurring Invoices** | `/recurring` | Create and manage recurring invoices. |
| **Customers** | `/customers` | Customer/contact management. |
| **Products & Services** | `/products` | Products and services catalog (service type emphasized; no variants in service workspace). |
| **Expenses** | `/expenses` | Create, list, and manage expenses; posts to ledger. |

### 1.2 FINANCE & REPORTING (Non–firm users)

| Capability | Route / Entry | Description |
|------------|----------------|-------------|
| **Accounting Portal** | `/portal/accounting` | Single-page portal: P&amp;L, Balance Sheet, Trial Balance, General Ledger by period; period selector; export. |
| **Profit & Loss** | `/reports/profit-loss` | P&amp;L report. |
| **Balance Sheet** | `/reports/balance-sheet` | Balance sheet report. |
| **VAT Returns** | `/vat-returns` | VAT return creation and management. |
| **Financial Reports** | `/reports` | General financial reports hub. |
| **Credit Notes** | `/credit-notes` | Create and manage credit notes. |
| **Supplier Bills** | `/bills` | Accounts payable; create/view bills. |
| **Assets** | `/assets` | Fixed assets and depreciation. |
| **Payroll** | `/payroll` | Payroll runs and staff payroll. |

### 1.3 SERVICE ACCOUNTING (Owner / single-business context)

| Capability | Route / Entry | Description |
|------------|----------------|-------------|
| **Service Accounting hub** | `/service/accounting` | Landing page with quick actions: **Record Adjustment** (manual journal entry), **Record Owner Contribution** (capital/contribution). |
| **Record Adjustment** | `/service/accounting/adjustment` | Post a manual journal entry to the ledger (owner-mode; uses drafts + `post_manual_journal_draft_to_ledger`). |
| **Record Owner Contribution** | `/service/accounting/contribution` | Record owner money invested in the business (contribution posting). |
| **Financial Health** | `/service/health` | Read-only: period summary (open/soft closed/locked), “Next period to close”, reconciliation pending-approvals count. No close button here; close is via Accounting Periods. |
| **Expenses → Ledger activity** | `/service/expenses/activity` | Service-scoped expense activity: lines from journal entries (expense, bill, adjustment_journal, reconciliation) with links to expense, bill, ledger, or reconciliation. |
| **Service home** | `/service` (or linked from nav) | Service landing: business name, service/product counts, recent services list. |

### 1.4 ACCOUNTING (Canonical routes with `business_id`)

Sidebar links build `/accounting/...?business_id=...` from current service business (or URL). Same pages as firm/accounting workspace; RLS/API allow owner.

| Capability | Route / Entry | Description |
|------------|----------------|-------------|
| **General Ledger** | `/accounting/ledger?business_id=...` | Ledger view by business. |
| **Chart of Accounts** | `/accounting/chart-of-accounts?business_id=...` | COA management. |
| **Trial Balance** | `/accounting/reports/trial-balance?business_id=...` | Trial balance by period. |
| **Reconciliation** | `/accounting/reconciliation?business_id=...` | Bank/mobile money reconciliation. |
| **Accounting Periods** | `/accounting/periods?business_id=...` | Period list, close/lock/reopen (after 301 owner RLS). |
| **Accounting Activity** | `/accounting/audit?business_id=...` | Audit trail of accounting actions. |
| **Accounting Health** | `/accounting/health?business_id=...` | Accounting health view (or redirect with business_id). |
| **System Activity** | `/audit-log` | App-wide audit log. |

### 1.5 LEGACY REDIRECTS (Service path → canonical accounting)

These resolve current business and redirect to the canonical accounting URL with `business_id`:

- `/service/accounting/audit` → `/accounting/audit?business_id=...`
- `/service/accounting/health` → `/accounting/health?business_id=...`
- `/service/accounting/reconciliation` → `/accounting/reconciliation?business_id=...`
- `/service/accounting/chart-of-accounts` → `/accounting/chart-of-accounts?business_id=...`
- `/service/ledger` → `/accounting/ledger?business_id=...`
- `/service/reports/trial-balance` → `/accounting/reports/trial-balance?business_id=...`
- `/service/reports/profit-and-loss` → `/accounting/reports/profit-and-loss?business_id=...`
- `/service/reports/balance-sheet` → `/accounting/reports/balance-sheet?business_id=...`

### 1.6 SETTINGS

| Capability | Route / Entry | Description |
|------------|----------------|-------------|
| **Accountant Requests** | `/service/invitations` | View pending/active accountant firm engagements; accept or reject firm access. |
| **Business Profile** | `/settings/business-profile` | Business details. |
| **Invoice Settings** | `/settings/invoice-settings` | Invoice configuration. |
| **Payment Settings** | `/settings/payments` | Payment methods/config. |
| **WhatsApp Integration** | `/settings/integrations/whatsapp` | WhatsApp integration. |
| **Automations** | `/settings/automations` | Automations. |
| **Staff Management** | `/settings/staff` | Staff/roles (service-specific behavior where applicable). |

### 1.7 API SURFACE (Service-specific)

- `GET /api/service/invitations` — Pending/active engagements for current business.
- `PATCH /api/service/engagements/[id]` — Accept/reject engagement (owner-only).
- `GET /api/service/expenses/activity` — Expense-related journal lines for service business.
- `GET /api/dashboard/service-timeline` — Dashboard timeline (when used).
- `GET /api/dashboard/service-analytics` — Service analytics (when `SERVICE_ANALYTICS_V2`).

---

## 2. Real-Life Feature Ratings (Current State)

Scale: **1 = Not usable / missing**, **5 = Production-ready for typical small service business**.

| Area | Rating | Notes |
|------|--------|------|
| **Invoicing & quotes** | 4/5 | Invoices, quotes, recurring, payments are central and usable. Convert quote→invoice/order. Minor: PDF/branding and multi-currency can vary by market. |
| **Customers & CRM** | 3/5 | Basic customer list and links; 360 view exists. Lacks pipeline, stages, or deep CRM. Adequate for simple B2B/service. |
| **Products & services** | 4/5 | Catalog with service type; no variants in service workspace (intentional). Good for fixed-fee and time-based services. |
| **Expenses & bills** | 4/5 | Expenses and supplier bills with ledger posting; activity view in service. Receipt/OCR and categorisation can be improved. |
| **Service Accounting hub** | 4/5 | Clear owner path: adjustment + owner contribution. Manual draft flow and RLS fixes make it reliable. |
| **Period close (owner)** | 4/5 | After 301 RLS, owners can close periods from Accounting Periods; no service-only close UI but same flow. |
| **Reports (P&amp;L, BS, TB)** | 4/5 | Portal and dedicated report pages; period-based. Good for year-end and management. |
| **VAT / tax** | 3/5 | VAT returns and related reports exist; jurisdiction coverage and filing workflows vary. |
| **Reconciliation** | 3/5 | Reconciliation exists in canonical accounting; service users reach it with business_id. UX can feel firm-oriented. |
| **Payroll** | 3/5 | Payroll runs and staff; jurisdiction-specific (e.g. Zambia). Needs localisation and compliance depth. |
| **Assets** | 3/5 | Fixed assets and depreciation; useful for small businesses with few assets. |
| **Accountant collaboration** | 4/5 | Invitations, accept/reject, engagement model. Clear owner-only actions. |
| **Dashboard & health** | 4/5 | Service dashboard with metrics, timeline, health, activity; health page read-only but informative. |
| **Audit & compliance** | 4/5 | Audit log, accounting activity, period close audit trail. Good for accountability. |
| **Settings & integrations** | 3/5 | Business profile, invoice/payment settings, WhatsApp, automations, staff. Breadth is there; depth per integration varies. |

**Overall (real-life use for a small service business):** **~3.8/5** — Solid core (invoicing, accounting, reports, accountant link). Gaps: CRM depth, reconciliation UX, tax/payroll localisation, and a single “service-native” place for period close and bank rec.

---

## 3. Suggestions: Features That Would Make Service Workspace Much Better

### High impact

1. **Service-native “Close period” entry point**  
   Add a clear “Close period” (or “Month-end”) action on `/service/health` or `/service/accounting` that either runs in-place or redirects to `/accounting/periods?business_id=...` with a clear CTA. Reduces confusion that close “belongs” only to the accounting workspace.

2. **Bank/cash reconciliation from Service**  
   A dedicated “Reconcile” card or page under Service (e.g. under Service Accounting or Dashboard) that resolves business and opens canonical reconciliation with `business_id`. Improves discoverability for owners who don’t think “accounting” first.

3. **Cash flow view for service business**  
   A simple cash-in/cash-out and runway view (e.g. next 3–6 months) using existing revenue/expense/AR/AP data. Complements P&amp;L and balance sheet for day-to-day decisions.

4. **Customer pipeline / deal stages (light CRM)**  
   Optional pipeline (e.g. Lead → Quote → Won/Lost) with amounts and link to estimates/invoices. Would significantly improve real-life use for sales-led service businesses without full CRM.

5. **One-click “Month-end checklist”**  
   Single page or modal: “Reconcile bank”, “Close period”, “Download P&amp;L”, “Send to accountant”. Guides owners through a repeatable month-end routine.

### Medium impact

6. **Service dashboard widgets for overdue invoices and upcoming recurring**  
   Prominent “Overdue invoices” and “Recurring next 7 days” on dashboard to improve collections and awareness.

7. **Owner contribution vs draw tracking**  
   Dedicated view or report: contributions and draws over time (already in ledger); surface as “Owner funding” for clarity.

8. **Simplified “Books for my accountant” export**  
   One action: package (e.g. PDF/Excel) of P&amp;L, BS, TB, and optionally ledger for a chosen period. Reduces back-and-forth with the firm.

9. **Reminders and notifications**  
   Configurable reminders: quote expiring, invoice overdue, period not closed, reconciliation pending. Email or in-app.

10. **Multi-currency for service**  
    Clear handling of multi-currency invoices and expenses (display, FX, reporting) so service businesses with foreign clients/suppliers are fully supported.

### Nice to have

11. **Time tracking → invoice**  
    Optional time entries linked to projects/customers and optional “Create invoice from time” for professional services.

12. **Recurring expense templates**  
    Templates for rent, subscriptions, etc., with optional auto-create or reminder.

13. **Service-specific KPIs**  
    E.g. utilisation, average deal size, quote-to-invoice conversion, displayed on dashboard or reports.

14. **Mobile-friendly “quick actions”**  
    From phone: “Log expense”, “Send invoice”, “Record payment”, “Record contribution” with minimal steps.

15. **Guided onboarding for service**  
    Short wizard: business type, chart of accounts preset, first period, first invoice or contribution. Reduces setup friction.

---

## 4. Summary

- **Capabilities:** Service workspace covers **invoicing, quotes, orders, recurring, customers, products/services, expenses, bills, credit notes, assets, payroll, VAT**, plus a **service accounting hub** (adjustments, owner contribution), **financial health**, **expense activity**, and **full accounting** (ledger, COA, trial balance, reconciliation, periods, audit) via canonical routes with `business_id`. **Accountant invitations** and **settings** round it out.
- **Ratings:** Core operations and accounting are **4/5**; CRM, tax, payroll, and reconciliation UX are **3/5**. **Overall ~3.8/5** for real-life small service use.
- **Suggestions:** Highest impact: **service-native close period entry**, **reconciliation from Service**, **cash flow view**, **light pipeline/CRM**, and **month-end checklist**. Then dashboard widgets, owner funding view, accountant export, reminders, and multi-currency; then time tracking, recurring expense templates, KPIs, mobile quick actions, and onboarding.
