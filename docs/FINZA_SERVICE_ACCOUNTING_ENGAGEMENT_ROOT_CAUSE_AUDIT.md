# FINZA SERVICE ↔ ACCOUNTING ENGAGEMENT AUDIT REPORT

**READ-ONLY AUDIT.** No fixes, refactors, or design recommendations. Evidence only.

---

## 1. FLOW TRACE

### A. Service Order / Job Creation

**UI:** Orders are created and managed in the **main app (service workspace)**, not under `/service/*`.

- **Create:** `app/orders/new/page.tsx` (new order form).
- **List:** `app/orders/page.tsx` (orders list; links to invoice view when `order.invoice_id` exists).
- **View/Edit:** `app/orders/[id]/view/page.tsx`, `app/orders/[id]/edit/page.tsx`.

**API:**

- GET/PATCH `app/api/orders/[id]/route.ts` — load/update order. PATCH blocks if `order.status === "converted" || order.status === "cancelled" || order.invoice_id` (line 174).
- POST `app/api/orders/[id]/send/route.ts` — send order confirmation (no invoice creation).
- No order creation API found under `/api/orders` for POST (create); creation likely via Supabase client or another route (e.g. list then create pattern).

**DB:**

- Tables: `orders` (e.g. `id`, `customer_id`, `estimate_id`, `invoice_id`, `status`, `business_id`, `subtotal`, `total_tax`, `total_amount`, `notes`); `order_items` (`order_id`, `product_service_id`, `quantity`, `unit_price`, etc.).
- Status model: `orders.status` IN (`draft`, `issued`, `converted`, `cancelled`) per convert-to-invoice route comment (migration 208). Execution status separate.

**Flow summary:**

```
Service Order Creation Flow:
UI → /orders/new, /orders/[id]/view, /orders/[id]/edit
API → GET/PATCH /api/orders/[id], POST /api/orders/[id]/send
DB → orders, order_items
Status model → draft | issued | converted | cancelled (execution_status: pending | active | completed)
```

**Financial fields on order:** `subtotal`, `total_tax`, `total_amount` stored on `orders`; no ledger or journal fields. No “job profit” or margin stored at order level.

---

### B. Order → Invoice Conversion

**Trigger:** User action on Order View page: “Convert to Invoice” button. Confirmation via `useConfirm` then `fetch(\`/api/orders/${orderId}/convert-to-invoice\`, { method: 'POST', ... })`.  
**Location:** `app/orders/[id]/view/page.tsx` (lines 144–157, 382–390).

**Owner:** Conversion is performed by the **same workspace** that owns orders (service/business owner). Not accounting-only.

**Automatic vs manual:** **Manual.** One-time POST; no automatic conversion on order completion.

**Validation:**  
`app/api/orders/[id]/convert-to-invoice/route.ts`:

- Order must exist, not already converted (`status !== 'converted'`, `!order.invoice_id`), not cancelled.
- Business must have `address_country` and `default_currency`; country-currency asserted via `assertCountryCurrency`.
- Order must have items; tax recomputed from invoice date (not order date).
- Invoice number generated when creating as `sent` (body `status === 'sent'`); default creation is **draft** (line 442: `status: "draft"`).

**Invoice builder:** Same route builds payload (invoice + invoice_items) from order/order_items; maps `order_items.quantity` → `invoice_items.qty`; tax from `getCanonicalTaxResultFromLineItems` with effective date from issue/sent.

**Validation guards:** Business country/currency required; no invoice creation without them (400). No explicit “accounting bootstrap” or period check in this route.

**Database writes:** Insert into `invoices` (with `source_type: 'order'`, `source_id: orderId`), insert into `invoice_items`, update `orders` set `invoice_id`, `status = 'converted'`. Audit log and activity log written. No ledger write in this route.

**Flow summary:**

```
Conversion Trigger → Order View "Convert to Invoice" → POST /api/orders/[id]/convert-to-invoice
API → convert-to-invoice/route.ts (validates order, business, items; builds invoice from order)
Validation Guards → country/currency, no double-convert, no cancelled order
Database Writes → invoices, invoice_items, orders.invoice_id + status
```

---

### C. Invoice → Ledger Posting

**Trigger:** **Database trigger**, not API. When `invoices.status` is updated (or inserted) and becomes one of `sent`, `paid`, `partially_paid` (and previous status was `NULL` or `draft`), trigger runs.

**Definition:** `supabase/migrations/043_accounting_core.sql` (lines 929–952):

- `trigger_post_invoice()`: IF `NEW.status IN ('sent','paid','partially_paid')` AND `(OLD.status IS NULL OR OLD.status = 'draft')` AND no existing `journal_entries` with `reference_type = 'invoice'` AND `reference_id = NEW.id`, then `PERFORM post_invoice_to_ledger(NEW.id)`.
- Trigger: `trigger_auto_post_invoice` AFTER INSERT OR UPDATE OF `status` ON `invoices`.

**Posting engine:** `post_invoice_to_ledger(p_invoice_id)` (current logic in `226_accrual_ar_posting_invoice_finalisation.sql`, guards in `228_revenue_recognition_guards.sql`). Draft invoices raise in `post_invoice_to_ledger`; posting date = `COALESCE(sent_at::date, issue_date)`.

**Ledger write path:** `post_invoice_to_ledger` → `post_journal_entry(...)` with `reference_type = 'invoice'`, `reference_id = p_invoice_id`; creates `journal_entries` row and `journal_entry_lines` (AR, revenue, tax as per 226).

**Posting status storage:** No separate “posting status” column on `invoices`. “Posted” is inferred by existence of a `journal_entries` row with `reference_type = 'invoice'` and `reference_id = invoice.id`. Immutability of `sent_at` after posting enforced by trigger `prevent_invoice_sent_at_change_after_posting` (migration 252).

**Flow summary:**

```
Posting Trigger → DB trigger_auto_post_invoice (AFTER INSERT OR UPDATE OF status ON invoices)
Posting Engine → post_invoice_to_ledger(p_invoice_id) → post_journal_entry(...)
Ledger Write Path → journal_entries + journal_entry_lines (reference_type=invoice, reference_id=invoice.id)
Posting Status Storage → No column; inferred from journal_entries; sent_at immutable after posting (trigger 252)
```

**Synchronous:** Yes. Trigger runs in the same transaction as the invoice update. If `post_invoice_to_ledger` or `ensureAccountingInitialized` (called before send in API) fails, the send/update can fail (e.g. 500 from bootstrap).

---

## 2. EDIT AUTHORITY AUDIT

### 1. Can Service Workspace edit invoices after creation?

**Yes, only while draft.**

- **UI:** `app/invoices/[id]/edit/page.tsx` exists; invoice view shows edit only when allowed by document state.
- **API:** PATCH `app/api/invoices/[id]/route.ts`. Edit is blocked unless `canEditInvoice(existingInvoice.status)` is true.  
  **Evidence:** `lib/documentState.ts` line 221–223: `canEditInvoice(status: InvoiceStatus): boolean { return status === "draft" }`.  
  API returns 400 with message: “Cannot edit invoice with status \"...\". Invoices are immutable after being issued. Only draft invoices can be edited.” (lines 321–331.)
- **DB:** No application-level “posting” check in the edit route. Immutability is status-based. After status is `sent`/`paid`/etc., PATCH does not allow edits. DB trigger 252 prevents changing `sent_at` once a journal entry exists for that invoice.
- **Conclusion:** Service can edit invoices **only when status is draft**. After “issued” (sent), no further edits.

### 2. Can Service Workspace edit invoices AFTER ledger posting?

**No.** Edit is already blocked by status (only draft editable). Once sent, the invoice has been posted by the trigger, and the UI/API do not allow editing. So effectively: **no edit after posting**. The DB additionally prevents `sent_at` change after posting (trigger 252).

### 3. Can Accounting Workspace modify Service orders / job data / operational service metadata?

**No evidence of any Accounting UI or API that modifies orders or service operational data.**

- **Evidence:** Grep for `orders` / `order_items` under `app/accounting/` returns only reconciliation/periods pages (references to invoices/payments in context of reconciliation/periods), not order CRUD.
- **Accounting routes:** `app/accounting/` contains ledger, reports, periods, reconciliation, chart of accounts, journals, adjustments, firm, health, audit, etc. No `/accounting/orders` or equivalent. `Sidebar.tsx` for service industry shows “Orders” under “SERVICE OPERATIONS” pointing to `/orders`, not under accounting.
- **Conclusion:** Accounting workspace **cannot** create or edit orders, job data, or operational service metadata; no such UI or API in the accounting app.

---

## 3. VISIBILITY AUDIT

### A. Payment status visibility (Service Workspace)

- **Order views:** Order view (`app/orders/[id]/view/page.tsx`) receives `order.invoices` with `id`, `invoice_number`, `status`. It does **not** load payments or outstanding amount. So on the order page the user sees only the **invoice status** (e.g. sent/paid), not payment list or amount paid. **Data source for that status:** GET `app/api/orders/[id]/route.ts` selects `invoices(id, invoice_number, status)`.
- **Service dashboards:** Dashboard `app/dashboard/page.tsx` computes `outstandingAmount`, `totalPaid` per invoice from `invoices` + `payments` + `credit_notes` (operational data, not ledger). Stats include `outstandingInvoices`, `outstandingAmount`, `collectedThisMonth`, etc. So **payment/outstanding is visible on the main dashboard**.
- **Customer pages:** Customer statement `app/customers/[id]/statement/page.tsx` loads from API (e.g. `app/api/customers/[id]/statement/route.ts`) and shows `totalInvoiced`, `totalPaid`, `totalCredits`, `totalOutstanding`, `totalOverdue`. So **payment status and outstanding are visible at customer level** in the main app.
- **Conclusion:** Payment status and outstanding are visible in **dashboard** and **customer statement**. They are **not** shown on the **order view**; user must open the linked invoice to see payment details.

### B. Customer balance visibility

- **Outstanding balance:** Yes — via dashboard and customer statement (see above). Source: operational tables (invoices, payments, credit_notes), not ledger.
- **AR status:** Not exposed as “AR” in Service UI; “outstanding” and “overdue” are.
- **Customer credit state:** Credit notes and totals appear on customer statement; no separate “credit state” flag traced.

### C. Job profit / margin visibility

- **Revenue per job:** Orders do not store revenue or link to ledger by job. Revenue is at **invoice** level (and then in ledger via `post_invoice_to_ledger`). No “revenue per order/job” or “job profit” computed or displayed in Service workspace.
- **Cost tracking:** No cost or cost-of-service fields on orders or order_items in the traced flows.
- **Margin visibility:** Not present. No margin or profit calculation in order or service job UI.
- **Conclusion:** Service workspace does **not** surface job-level profit, cost, or margin; only order totals and invoice-level totals.

---

## 4. STATE OWNERSHIP + SOURCE OF TRUTH

| Object              | Authority layer / source of truth | Evidence |
|---------------------|------------------------------------|----------|
| **Orders**          | Service (business owner)           | CRUD under `/orders` and `/api/orders`; no accounting UI for orders. `orders.invoice_id` set by convert-to-invoice (service flow). |
| **Invoices**        | Service for create/send; shared read | Created/sent from service routes (`/invoices`, `/api/invoices`, `/api/orders/.../convert-to-invoice`). Edit only when draft (documentState + API). Accounting can read (ledger, reports) via same DB. |
| **Payments**        | Service (business owner)          | Created via `/api/invoices/[id]/mark-paid` or `/api/payments/create`; both use `getCurrentBusiness` and are used from main app. Posting is trigger on `payments` → `post_payment_to_ledger` (alias to `post_invoice_payment_to_ledger`). |
| **Ledger**          | System (DB triggers + RPCs)       | `journal_entries` / `journal_entry_lines` written only by `post_invoice_to_ledger`, `post_payment_to_ledger`, etc., invoked by triggers or accounting RPCs. No direct write from Service UI. |
| **Customer balance** | Derived (operational)             | Dashboard and statement compute from invoices + payments + credit_notes. Ledger has AR via `get_ar_balances_by_invoice` RPC but that is not the source for Service “outstanding” display. |

---

## 5. WORKSPACE SWITCH FRICTION

User journey:

```
Create Job     → /orders/new (service)
Complete Job   → /orders/[id]/view – Issue, execution status (service)
Invoice        → Same page: “Convert to Invoice” → then /invoices/[id]/view (service)
Payment        → From invoice view “Mark as paid” or /payments (service)
Reporting      → /reports/*, /ledger, /trial-balance (service) OR /service/reports/*, /service/ledger (service)
```

**Required workspace transitions:**

- **None** for the above lifecycle if the user stays in the main app (service industry menu: Orders, Invoices, Payments, Customers, then Finance & Reporting / Accounting (Advanced)). The same user (business owner) can complete create job → complete → convert → pay → reports without switching to `/accounting/*`.
- **Strict boundary:** `lib/accessControl.ts`: if workspace is `service`, access to `/accounting` is **denied** and redirect is to `/dashboard`. So a **business owner cannot use Accounting workspace**; they use “Accounting (Advanced)” under the same sidebar (General Ledger, Trial Balance, Health, Audit, Reconciliation) which are **non-accounting routes** (e.g. `/ledger`, `/trial-balance`), or `/service/ledger`, `/service/reports/*` when in service context.
- **Accounting workspace** (`/accounting/*`) is **firm-only**: only users in `accounting_firm_users` can access; business owners are redirected. So for a business owner there is **no** “switch to accounting” — they are confined to service + shared “Accounting (Advanced)” routes.

**Friction points:**

- Order view does not show payment/outstanding; user must open the invoice (one extra navigation).
- To see “ledger” view of the same business, the owner uses `/ledger` or `/service/ledger` (same API `/api/ledger/list`); no switch of workspace but **two possible entry points** (main app vs `/service/*`).
- If the business uses an accounting firm, the **firm** sees the client’s data in `/accounting/*` (client selector); the **owner** never enters `/accounting/*`. So completing “one service lifecycle” does not require the owner to switch workspaces; the split is **owner vs firm**, not “service vs accounting” for the same user.

---

## 6. DATA MODEL TRACE

**Linkage:**

- **Service Order → Invoice:** `orders.invoice_id` → `invoices.id` (set by convert-to-invoice). `invoices.source_type = 'order'`, `invoices.source_id = order.id` (migration 077).
- **Invoice → Payment:** `payments.invoice_id` → `invoices.id` (FK).
- **Invoice → Ledger:** `journal_entries.reference_type = 'invoice'`, `journal_entries.reference_id = invoice.id` (no FK; logical link). Created by `post_invoice_to_ledger`.
- **Payment → Ledger:** `journal_entries.reference_type = 'payment'`, `journal_entries.reference_id = payment.id`. Created by trigger on `payments` → `post_payment_to_ledger(NEW.id)` (218).
- **Snapshots / reports:** Trial balance and P&amp;L use `journal_entries` / `journal_entry_lines` and/or trial balance snapshots; reports APIs read from ledger or snapshots.

**Confirmed:** Order → Invoice (FK + source_type/source_id), Invoice → Payment (FK), Invoice/Payment → Ledger (reference_type/reference_id). No FK from `journal_entries` to `invoices` or `payments`; linkage is by convention and RPCs.

---

## 7. POSTING RESPONSIBILITY CLARITY

- **Module guaranteeing ledger integrity:** **Database triggers and RPCs.** Invoice posting: `trigger_auto_post_invoice` → `post_invoice_to_ledger`. Payment posting: `trigger_post_payment` → `post_payment_to_ledger` (218). Both run in the same transaction as the row insert/update. Period and draft checks live inside `post_invoice_to_ledger` and `post_invoice_payment_to_ledger` (e.g. 227 draft-invoice guard).
- **Silent failure:** Payment trigger was historically wrapped in exception handling (073/075); migration 218 restores **fail-fast**: exception from `post_payment_to_ledger` aborts the transaction, so payment row is not committed if posting fails. Invoice posting has no such wrapper in 043; trigger propagates errors, so invoice update rolls back if posting fails.
- **When posting is enforced:** Invoice: when status becomes `sent` (or `paid`/`partially_paid`) via any path that updates `invoices.status` (e.g. send route, or PATCH with status). Payment: when a row is inserted into `payments` (and invoice is not draft per 227). So posting is **enforced at event time** (status change / payment insert), not “optional” at the API level — the API does not “choose” to skip posting.
- **Service user understanding of posting state:** UI does not show “posted” vs “not posted”. User sees invoice status (draft/sent/paid) and payment list. So **posting state is not explicitly surfaced** to Service users; they infer from status and payments.

**Enforcement location:** Inside DB (triggers + `post_invoice_to_ledger`, `post_payment_to_ledger`). API enforces **preconditions** (e.g. `ensureAccountingInitialized` before send) so that when the trigger runs, bootstrap (periods, control accounts) already exists; otherwise send fails with 500.

---

## 8. SERVICE VS PROFESSIONAL (ACCOUNTING) OVERLAP

- **Workflows:** **Different.** Service: create order → issue → convert to invoice → send invoice → record payment (all in main app). Accounting: select client → view ledger, reports, periods, reconciliation, journals, adjustments. No order or invoice creation in accounting UI.
- **APIs shared:** Yes. Ledger list: `/api/ledger/list` (used by both `/ledger` and `/service/ledger` with `business_id`). Reports: e.g. `/api/accounting/reports/trial-balance`, `/api/accounting/reports/balance-sheet`, `/api/accounting/reports/profit-and-loss` called by both accounting and service report pages (e.g. `app/service/reports/trial-balance/page.tsx` with `?business_id=`). Authority: `checkAccountingAuthority(supabase, user.id, businessId, "read")` allows owner, employee, or firm with effective engagement.
- **Invoice flows duplicated:** No. Invoice create/send/edit live only in main app; accounting does not duplicate invoice creation or send.
- **UI routes:** Separate: `/invoices`, `/orders` vs `/accounting/ledger`, `/accounting/reports/*`. Service also has `/service/ledger`, `/service/reports/*` that call the **same** reporting/ledger APIs with the current business id. So **same backend, different entry points** (main app “Accounting (Advanced)” vs `/service/*` vs `/accounting/*` for firms).

| Aspect           | Service (owner)     | Accounting (firm)        |
|-----------------|----------------------|---------------------------|
| Orders          | Full CRUD            | No UI                     |
| Invoices        | Create, send, edit draft, mark paid | Read (via ledger/reports) |
| Payments        | Create (mark-paid, payments)       | Read                      |
| Ledger          | Read (same API)      | Read                      |
| Reports         | Read (same APIs, business_id)      | Read (client selector)    |
| Periods / close | No                   | Yes                       |
| Reconciliation  | Read (main app route) | Yes                       |

---

## 9. EVENT TIMING + AUTOMATION AUDIT

- **Manual:** Create order, issue order, convert to invoice, send invoice (email/WhatsApp/copy link), mark invoice as paid, create payment from payments page. Edit invoice (draft only). Edit order (draft or issue → revision).
- **Automatic:** On invoice status transition to sent/paid/partially_paid → `trigger_auto_post_invoice` → `post_invoice_to_ledger`. On payment insert → `trigger_post_payment` → `post_payment_to_ledger`. Invoice status recalculated from payments/credits via `recalculate_invoice_status` (trigger on payments/credit_notes). So **posting and status recalc are automatic** when the user performs the sending/payment actions.
- **Real-time:** Status and posting happen in the same transaction; no async job for posting. Dashboard and statement recalc on load (no live push).
- **Async/background:** Recurring invoice generation (e.g. `app/api/recurring-invoices/generate/route.ts`) can create invoices with status `sent` (if `auto_send`), which then triggers posting. No other background posting path identified.

---

## 10. ROOT CAUSE RANKING (TOP 5 — NO SOLUTIONS)

1. **Single lifecycle split across two mental models (order vs invoice) with no payment visibility on order**  
   **Location:** Order view only shows `invoices.status`; no payments or outstanding on order.  
   **Evidence:** `app/orders/[id]/view/page.tsx` uses `order.invoices` with `id`, `invoice_number`, `status`; GET `app/api/orders/[id]/route.ts` does not join payments or compute outstanding.  
   **Impact:** Service user must leave the order context and open the invoice to see payment status, increasing friction and obscuring “is this job paid?”

2. **Posting is implicit and invisible to Service users**  
   **Location:** No “posted” indicator or explanation in invoice/payment UI; posting is trigger-driven.  
   **Evidence:** `canEditInvoice` and API message refer to “issued” and “draft,” not “posted.” `prevent_invoice_sent_at_change_after_posting` and unsent route do not explain “posted” in user-facing errors.  
   **Impact:** Users may not understand why an invoice cannot be reverted or why send/mark-paid can fail (e.g. bootstrap/period), leading to perceived engagement friction.

3. **Two parallel “ledger/reports” entry points for the same business (main app vs /service)**  
   **Location:** `/ledger` and `/service/ledger` both call `/api/ledger/list`; `/reports/*` and `/service/reports/*` call same accounting report APIs.  
   **Evidence:** `app/ledger/page.tsx` (no business_id in params), `app/service/ledger/page.tsx` (resolveServiceBusinessContext, passes business_id). Sidebar: “General Ledger” under “Accounting (Advanced)” vs “Accountant Requests” under Settings linking to `/service/invitations`.  
   **Impact:** Redundant navigation and possible confusion about where to view “their” ledger vs “service” view, especially with engagement/invitation flow.

4. **Unsent flow does not pre-check ledger posting; failure is at DB write**  
   **Location:** Mark-unsent API updates invoice to draft and clears sent_at without checking for existing journal entry.  
   **Evidence:** `app/api/invoices/[id]/unsent/route.ts` checks payments and credit notes only; no check for `journal_entries` with reference_type=invoice. Trigger `prevent_invoice_sent_at_change_after_posting` (252) raises when sent_at is changed and a JE exists.  
   **Impact:** User gets a generic update failure (500) instead of a clear “invoice already posted to ledger” message, increasing support burden and confusion.

5. **Accounting workspace has no authority over operational documents (orders/invoices); firm is read-only on client’s transactions**  
   **Location:** Accounting app has no order or invoice creation/edit UI; authority over orders/invoices stays in service (business owner).  
   **Evidence:** No `orders` or `order_items` CRUD under `app/accounting/`; invoice/payment creation only in main app; `checkAccountingAuthority` grants read/write for ledger/reports but operational document creation is not in accounting routes.  
   **Impact:** Any correction or follow-up that requires changing an order or re-issuing an invoice must be done by the business owner in the main app; the firm cannot complete the lifecycle on behalf of the client, creating dependency and handoff friction.

---

**Single deepest structural cause (synthesis):**  
The **lifecycle is owned by the Service (business owner) side** (order → invoice → payment) while **ledger and reporting are shared** (same APIs, different entry points) and **Accounting (firm) has no write over operational documents**. Friction arises from (1) **visibility gaps** in the order context (no payment/outstanding on order), (2) **implicit posting** with no user-facing “posted” state, (3) **duplicate entry points** for ledger/reports for the same business, and (4) **firm’s read-only role** over client orders/invoices, so the firm cannot close the loop without the owner. The deepest structural cause is that **authority and visibility are split across order vs invoice vs ledger without a single place where “this job, its invoice, its payments, and its ledger state” are presented together, and the accounting side has no ability to mutate the operational chain.**

---

*End of audit. No recommendations or fixes included.*
