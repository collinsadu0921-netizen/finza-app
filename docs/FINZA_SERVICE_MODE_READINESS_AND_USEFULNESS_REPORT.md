# FINZA SERVICE MODE READINESS & USEFULNESS REPORT

**Scope:** Read-only, evidence-based audit of Service Mode (business-owner / service-industry flows). No feature recommendations, no roadmap, no refactor suggestions.

**Definition of Service Mode:** Non-accounting, non-retail routes. Per `lib/accessControl.ts`, workspace is "service" for routes that do not start with `/accounting` or retail paths. Service Mode includes: customers, estimates, orders, invoices, payments, dashboard, and service-specific pages under `/service/*` (invitations, expenses/activity, ledger, reports). Operational data lives in `customers`, `estimates`, `orders`, `invoices`, `payments`, `credit_notes`; financial reporting and ledger posting depend on accounting bootstrap and ledger where indicated below.

---

## 1. WORKFLOW COMPLETENESS

| Stage | UI location | API location | DB tables used | Dependencies | Maturity |
|--------|-------------|--------------|-----------------|--------------|----------|
| **Customer management** | `/customers`, `/customers/new`, `/customers/[id]`, `/customers/[id]/statement`, `/customers/[id]/360` | `GET/POST /api/customers`, `GET /api/customers/[id]`, `GET /api/customers/[id]/statement`, `GET /api/customers/[id]/360`, `GET /api/customers/[id]/history` | `customers`, `businesses`, `business_users` | `getCurrentBusiness` for auth/scope | **Complete** |
| **Service job / order creation** | `/orders`, `/orders/new`, `/orders/[id]/view`, `/orders/[id]/edit` | `POST /api/orders/create`, `GET /api/orders/list`, `GET/PATCH /api/orders/[id]` | `orders`, `order_items`, `estimates`, `estimate_items`, `customers` | Order create: body `business_id` required (auth check commented in code). Estimate convert: `getCurrentBusiness`. | **Partial** (order create has auth bypass in code; requires `business_id` in body) |
| **Job execution tracking** | `/orders/[id]/view` (execution status badge, buttons to set pending/active/completed) | `PATCH /api/orders/[id]` (body `execution_status`) | `orders.execution_status` | None beyond order access | **Complete** |
| **Job completion** | Same as above; `execution_status` = `completed` | Same | Same | None | **Complete** |
| **Invoice creation** | `/invoices`, `/invoices/new`, `/invoices/create`, `/invoices/[id]/edit`, `/invoices/[id]/view`; order convert: `/orders/[id]/view` → convert to invoice | `POST /api/invoices/create`, `POST /api/orders/[id]/convert-to-invoice` | `invoices`, `invoice_items`, `invoices` (tax lines), `orders.invoice_id` | Invoice create: no `ensureAccountingInitialized`. Convert: no bootstrap in route. | **Complete** (draft creation independent of accounting) |
| **Invoice sending** | Invoice view → send (email/WhatsApp/copy link) | `POST /api/invoices/[id]/send` | `invoices` (status → sent, invoice_number, sent_at) | **ensureAccountingInitialized** before send; on failure returns 500. Trigger `trigger_auto_post_invoice` posts AR. | **Partial** (send blocks if accounting bootstrap fails) |
| **Payment recording** | Invoice view → mark paid; payments flow | `POST /api/invoices/[id]/mark-paid`, `POST /api/payments/create` | `payments`, `invoices` (status recalc via trigger), ledger via `post_invoice_payment_to_ledger` (trigger) | **ensureAccountingInitialized** in both routes; payment INSERT is in same transaction as trigger; migration 218: trigger fails = rollback. | **Partial** (payment blocks if bootstrap fails; if period locked, payment insert rolls back) |
| **Customer balance tracking** | `/customers/[id]/statement` | `GET /api/customers/[id]/statement` | `customers`, `invoices` (non-draft), `payments`, `credit_notes` | No accounting bootstrap; operational only. | **Complete** |
| **Basic reporting** | Dashboard: `/dashboard`; customer statement; service reports: `/service/reports/profit-and-loss`, `balance-sheet`, `trial-balance`; shared reports: `/reports/*` | Dashboard stats: direct Supabase `invoices`, `payments`, `credit_notes`; `/api/dashboard/ledger-expense-total` (RPC `get_ledger_expense_total`); `/api/reports/aging` → 410 deprecated; `/api/reports/sales-summary` → 410; service P&L uses ledger/periods | `invoices`, `payments`, `credit_notes` (dashboard); ledger for expense total and service P&L/BS/TB | Dashboard: operational + one ledger RPC (expense total). If RPC fails, dashboard sets totalExpenses = 0. Service reports (P&L, etc.) are ledger-based. | **Partial** (dashboard usable without accounting for revenue/outstanding; expense total and service reports depend on ledger/accounting) |

**Summary:** Customer management, order/job creation and execution tracking, draft invoice creation, and customer statement are complete and do not require accounting. Invoice send and payment recording require accounting bootstrap and (for payment) successful ledger posting; basic reporting is mixed (operational KPIs vs ledger-based expense and P&L).

---

## 2. DAILY BUSINESS OPERABILITY

**Evidence:**

- **Jobs (orders):** Orders can be created (with `business_id`), listed, edited; execution status can be set to pending → active → completed from `/orders/[id]/view`. No accounting dependency for order lifecycle.
- **Revenue tracking:** Dashboard computes total revenue, outstanding, overdue, collected this month, and recent invoices from operational tables (`invoices`, `payments`, `credit_notes`). No bootstrap call in dashboard stats; only expense total calls ledger RPC (and degrades to 0 on failure).
- **Customer history:** Customer statement and 360 view aggregate invoices (non-draft), payments, credit notes by customer. Single place per customer; no accounting required.
- **Staff workflows:** Order list and view, invoice list and view, payment recording, and mark-paid are available. If accounting bootstrap or period state fails, **sending** an invoice and **recording a payment** fail (500 or rollback); draft creation and viewing do not.
- **Hard blockers:** (1) **Send invoice** fails with 500 if `ensure_accounting_initialized` fails. (2) **Record payment / mark-paid** fail if bootstrap fails (500) or if ledger posting fails (payment INSERT rolled back, e.g. period locked). (3) **Service P&L/BS/TB** and **ledger expense total** depend on ledger; without accounting initialized, expense total shows 0 and service reports may fail or show empty.

**Rating: PARTIAL**

- Daily operations (customers, orders, draft invoices, customer statement, dashboard KPIs from operational data) can run without accounting.
- Issuing invoices and recording payments are blocked if accounting bootstrap or ledger posting fails. A business that has not run bootstrap (or has no open period) cannot send invoices or record payments through the app.

---

## 3. FINANCIAL PRACTICALITY (FROM SERVICE USER VIEW)

**Evidence:**

- **Invoice status:** List and view show status (draft, sent, partially_paid, paid, overdue). Status is derived from payments/credit notes via triggers; visible without accounting knowledge.
- **Payment tracking:** Payments are listed and linked to invoices; mark-paid and payment create record against invoice. User sees payment amount, date, method.
- **Customer outstanding balances:** Customer statement and dashboard show outstanding per invoice (invoice total − payments − applied credits). Calculated from operational tables; no accounting required for this view.
- **Revenue summaries:** Dashboard shows total invoiced (gross), outstanding amount, overdue count/amount, collected this month, and chart from payments. All from operational data except expense total.
- **Cash collected tracking:** Dashboard “collected this month” and payment list provide this; operational.
- **Profitability / cost tracking:** Expense total on dashboard comes from ledger (`get_ledger_expense_total`). Service P&L/BS/TB under `/service/reports/*` are ledger-based. Without accounting, owner sees revenue/outstanding/cash clearly; expense and P&L depend on ledger being populated.

**Grade:** **Useful for non-accountant owner** for receivables, cash collected, and customer balances. Expense and profit views require accounting to be initialized and ledger to be used (expenses, etc.); otherwise they are missing or zero.

---

## 4. ACCOUNTING DEPENDENCY LEVEL

**Evidence:**

- **Does Service Mode break if accounting bootstrap fails?**
  - **No** for: customer CRUD, order CRUD, execution status, draft invoice create/list/view, customer statement, dashboard (revenue, outstanding, overdue, collected; expense total degrades to 0 if RPC fails).
  - **Yes** for: invoice send (500 if bootstrap fails), payment create (500), mark-paid (500). So **issuing invoices and recording payments** break without bootstrap.
- **Financial workflows and ledger:** Invoice send triggers AR posting; payment insert trigger calls `post_invoice_payment_to_ledger` (migration 218: no exception swallowing; failure rolls back payment). So payment recording is tightly coupled to ledger posting and period state.
- **Meaningful operation before full accounting setup:** Yes for CRM, orders, draft invoices, and viewing operational KPIs. No for sending invoices and recording payments; those require successful bootstrap and (for payment) an open period.

**Rating: HIGH DEPENDENCY**

- Core revenue cycle (send invoice → record payment) depends on accounting bootstrap and ledger. Service Mode does not “break” entirely without it (drafts, customers, orders, dashboard operational stats work), but the business cannot complete the critical path of issuing and collecting without accounting being initialized and periods open.

---

## 5. FEATURE UTILIZATION REALISM

**Classification (evidence-based):**

| Area | Classification | Evidence |
|------|----------------|----------|
| Customers (list, add, view, statement) | **Core operational** | Required for invoicing and orders; single place for contact and balance. |
| Estimates (create, send, convert to order) | **Core operational** | Pre-invoice step; convert drives order/invoice creation. |
| Orders (create, list, view, edit, execution status, convert to invoice) | **Core operational** | Job/service tracking and path to invoice. |
| Invoices (create, list, view, edit, send) | **Core operational** | Central to billing and revenue. |
| Payments (record, mark-paid) | **Core operational** | Cash collection. |
| Dashboard (revenue, outstanding, overdue, collected, recent invoices, chart) | **Core operational** | Daily visibility. |
| Customer statement / 360 | **Supportive** | Single view of customer position. |
| Credit notes | **Supportive** | Adjustments to receivables; used in outstanding calc. |
| Recurring invoices | **Supportive** | Recurring billing. |
| Service reports (P&L, BS, TB under `/service/reports/*`) | **Advanced / rare** | Ledger-based; requires accounting; more analytical. |
| Service ledger page (`/service/ledger`) | **Advanced / rare** | Ledger view for owner. |
| Service invitations / engagements | **Supportive** | Accountant engagement lifecycle; not daily ops. |
| Service expenses activity | **Supportive** | Expense visibility. |
| Reconciliation (validate) in mark-paid/payment create | **Supportive** | Observe-only; does not block. |

No removal or addition suggested; classification only.

---

## 6. USER COMPLEXITY BURDEN

**Evidence:**

- **Steps to complete a service lifecycle:** Customer → Estimate (optional) → Order → (optional: order convert) → Invoice (create or from order) → Send invoice → Record payment(s). Multiple steps and concepts (estimate vs order vs invoice, draft vs sent, execution_status).
- **Concepts:** Customer, estimate, order, order status vs execution_status, invoice draft vs sent vs paid, payment method, credit notes. Distinction between “order” (commercial/execution) and “invoice” (billing) is present; convert-to-invoice links them.
- **Confusion risk:** Orders and invoices are separate; “convert to invoice” is explicit. Payment is tied to invoice; mark-paid creates a payment. Accounting workspace is separate (accounting routes, firm/client context); service user does not need to open Accounting for daily ops, but send/payment depend on accounting backend. If send or payment fails with “accounting” or “period” errors, user may not know why.

**Complexity grading: MODERATE**

- Lifecycle is clear (customer → order → invoice → payment) but multi-step. Order/invoice/estimate distinctions and execution_status add concepts. Dependency on accounting for send/payment is not user-facing in the UI copy; errors can increase perceived complexity.

---

## 7. FAILURE TOLERANCE & BUSINESS RISK

**Evidence:**

- **Accounting bootstrap fails:** Invoice send and payment create/mark-paid return 500 with message (e.g. “Unable to start accounting. Please try again.”). Operational data (drafts, customers, orders) unchanged. **Block:** User cannot send invoice or record payment until bootstrap succeeds.
- **Ledger posting fails (e.g. period locked):** Payment trigger `trigger_post_payment` (migration 218) calls `post_payment_to_ledger` with no exception handler; exception aborts transaction, so payment INSERT is rolled back. **Block:** Payment is not saved; user sees transaction failure. Invoice status is not updated (no payment row).
- **Invoice status transitions:** Send updates status to sent and assigns number; trigger posts AR. If send fails after bootstrap, invoice remains draft. No partial “sent but not posted” from the API (send is all-or-nothing).
- **Payment posting fails:** Same as above; no payment row and no ledger entry. No silent “payment recorded but not posted.”

**Conclusion:** Failures **block the affected operation** (send or record payment); they do not silently corrupt data. Operational integrity is preserved (no payment without ledger post, or invoice stuck “sent” without AR). Business risk: revenue cycle stalls until accounting is fixed or period is open; no partial or inconsistent state from these paths.

---

## 8. DATA RELIABILITY FROM SERVICE USER PERSPECTIVE

**Evidence:**

- **Operational truth:** Invoices (and status), payments, credit notes, and customer linkage are consistent for list, view, statement, and dashboard. Outstanding = invoice total − payments − applied credits; draft invoices excluded from financial calculations (invariant in code and comments).
- **Lifecycle tracking:** Order status and execution_status; invoice status (draft/sent/partially_paid/paid/overdue); payment and credit note application. Clear and queryable.
- **Customer financial position:** Customer statement and dashboard aggregates are from same operational tables; one source of truth for “what does this customer owe.”
- **Reporting for decisions:** Dashboard KPIs (revenue, outstanding, overdue, collected) are consistent with operational data. Expense total and P&L/BS/TB are ledger-derived; if ledger is not used or bootstrap failed, expense/profit views are missing or zero—reliability of **operational** data is high; **ledger-derived** data depends on accounting.

**Conclusion:** Operational data (invoices, payments, customers, orders) is consistent and suitable for daily decisions. Ledger-derived metrics (expense total, service reports) are reliable when accounting is in use and bootstrap has run.

---

## 9. REAL SMB FIT EVALUATION

**Evidence summary:**

- **Can run without accounting:** Customers, orders, draft invoices, execution tracking, customer statement, dashboard (except expense total). Useful for CRM and job tracking.
- **Cannot run without accounting:** Sending invoices and recording payments. These are required for a normal “issue invoice → collect cash” cycle.
- **Bootstrap is automatic on first use** of send/payment (API calls `ensureAccountingInitialized`); no separate “accounting setup” step in Service UI, but if the RPC fails (e.g. DB, permissions), the user is blocked with a generic error.
- **Order create** has commented-out auth and requires `business_id` in body in current code; production would typically use `getCurrentBusiness`. Some routes have “AUTH DISABLED FOR DEVELOPMENT” comments.
- **Deprecated reports:** Aging and sales-summary return 410; service user is directed to accounting reports or uses dashboard/customer statement for operational visibility.

**Grade: EARLY PRODUCTION**

- Service Mode is **past concept/dev**: full customer → order → invoice → payment lifecycle exists, with UI and API and clear data model. It is **not fully production-ready** for all SMBs because (1) send invoice and record payment are **critical path** and **depend on accounting bootstrap and ledger**, and (2) any bootstrap or period/ledger failure blocks revenue collection with no fallback. It is **usable in production** where accounting bootstrap and period setup are guaranteed (e.g. by onboarding or admin); otherwise it fits “early production” with a clear dependency and failure mode.

---

## 10. OVERALL MATURITY SCORECARD

| Category | Score (1–5) | Evidence |
|----------|-------------|----------|
| **Operational workflow** | 4 | Customer, estimate, order, invoice (draft), execution tracking, convert-to-invoice, and customer statement are implemented and coherent. Send and payment are gated by accounting. |
| **Financial usefulness** | 4 | Invoice status, payment tracking, customer balances, and dashboard KPIs (revenue, outstanding, collected) are visible and operational. Expense and P&L depend on ledger. |
| **Simplicity** | 3 | Single lifecycle is clear but multi-step; order vs invoice vs estimate and execution_status add concepts. Error messages on accounting/period failures may confuse non-technical users. |
| **Reliability** | 4 | No silent partial state; send and payment either succeed or fail cleanly. Operational data is consistent. Ledger-dependent features depend on accounting health. |
| **Independence from accounting** | 2 | Core revenue actions (send invoice, record payment) require accounting bootstrap and (for payment) successful ledger post. Dashboard and CRM work without it. |
| **Real SMB fit** | 3 | Usable for daily ops where accounting is initialized and periods open; blocking on bootstrap/period makes it “early production” for arbitrary SMBs. |

---

## FINAL OUTPUT SUMMARY

1. **Workflow completeness:** Complete for customers, orders, execution, draft invoices, customer balance. Partial for invoice send and payment (accounting-dependent) and for reporting (mix of operational and ledger-based).
2. **Daily operability:** **PARTIAL**—operational flows work; send and payment are blocked if accounting bootstrap or ledger posting fails.
3. **Financial practicality:** Strong for receivables and cash from a non-accountant view; expense and P&L require ledger.
4. **Accounting dependency:** **High**—revenue cycle (send + payment) depends on it; rest of Service Mode can run without it.
5. **Feature utilization:** Core (customers, orders, invoices, payments, dashboard); supportive (statements, credit notes, recurring, invitations); advanced (service P&L/BS/TB, ledger).
6. **Complexity burden:** **Moderate**—clear lifecycle with several concepts and steps; accounting-related errors can add confusion.
7. **Failure tolerance:** Failures block send/payment; no silent corruption; operational integrity maintained.
8. **Data reliability:** High for operational data; ledger-derived metrics depend on accounting.
9. **SMB fit:** **Early production**—viable where accounting is assured; critical path blocked otherwise.
10. **Scorecard:** Operational workflow 4, Financial usefulness 4, Simplicity 3, Reliability 4, Independence from accounting 2, Real SMB fit 3.

---

*End of report. No recommendations; evidence and ratings only.*
