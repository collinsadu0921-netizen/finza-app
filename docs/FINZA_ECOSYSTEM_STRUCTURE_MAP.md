# FINZA ECOSYSTEM STRUCTURE MAP (READ-ONLY)

Structural map of the Finza ecosystem. No opinions, no fixes, no refactors.

---

## SECTION A — Workspace Types

**Workspace types (by `business.industry`):**
- **service** — Invoices, estimates, orders, customers, products & services, expenses, bills, credit notes. Default for non-retail.
- **retail** — POS, sales, inventory, registers, stores, purchase orders, low stock, analytics.
- **logistics** — Referenced in onboarding and industry validation; rider/route flows.
- **rider** — Referenced in migration/backfill (060); not in current industry constraint.
- **professional** — Removed; converted to `service` (migration 202). References remain in some docs/audits.

**How workspace type is determined:**
- Stored on `businesses.industry`. Constraint: `industry IN ('retail', 'service', 'logistics')` (migration 202).
- UI/API: `getCurrentBusiness()` or URL/session; `business.industry` drives menu, redirects, and data source (e.g. `products_services` vs `products`).

**Routes that define each workspace (from `lib/accessControl.ts` — `getWorkspaceFromPath`):**
- **accounting:** `/accounting`, `/accounting/*`, `/admin/accounting/*`. Firm/accountant-only for control-tower, firm, admin accounting.
- **retail:** `/pos`, `/inventory`, `/sales`, `/retail`, `/admin/retail`. Store context required for `/pos`, `/inventory`, `/admin/retail/inventory-dashboard`, `/admin/retail/analytics`.
- **service:** All other paths (default when path is not accounting or retail). Includes `/dashboard`, `/invoices`, `/estimates`, `/orders`, `/customers`, `/expenses`, `/bills`, `/reports`, `/portal/accounting`, `/service/*`, etc.

**Workspace–industry enforcement (accessControl):**
- `workspace === "retail"` and `businessIndustry !== "retail"` → block, redirect to `/dashboard`.
- `workspace === "service"` and `businessIndustry === "retail"` → block, redirect to `/retail/dashboard`.

**Service-specific routes (industry === "service", owner context):**
- `/service/accounting`, `/service/ledger`, `/service/reports/trial-balance`, `/service/reports/balance-sheet`, `/service/reports/profit-and-loss`, `/service/accounting/chart-of-accounts`, `/service/accounting/reconciliation`, `/service/accounting/periods`, `/service/accounting/audit`, `/service/accounting/health`, `/service/accounting/adjustment`, `/service/accounting/contribution`, `/service/expenses/activity`, `/service/invitations`, `/service/health` — built via `buildServiceRoute()` with business id.

---

## SECTION B — Core Accounting Engine

**Ledger tables:**
- `accounts` — Chart of accounts (business_id, name, code, type: asset|liability|equity|income|expense, is_system, etc.). Migration 043, 051.
- `chart_of_accounts` — CoA template/definition table. Migration 097.
- `chart_of_accounts_control_map` — Maps control keys (e.g. AR, Revenue, VAT) to account codes per business. Migration 097.
- `journal_entries` — Header (business_id, date, description, reference_type, reference_id, period_id, source_type, source_draft_id, input_hash, accounting_firm_id, posted_by, etc.). Migration 043, 148.
- `journal_entry_lines` — Lines (journal_entry_id, account_id, debit, credit, description). Migration 043.
- `period_opening_balances` — Opening balance per account per period (period_id, account_id, business_id, opening_balance). Migration 086.

**Journal / posting functions (DB):**
- `post_invoice_to_ledger(p_invoice_id)` — Triggered by `trigger_auto_post_invoice` on `invoices` (AFTER INSERT OR UPDATE OF status). Migrations 043, 100, 130, 190, 226, 228, 252.
- `post_payment_to_ledger(p_payment_id)` / `post_invoice_payment_to_ledger(p_payment_id)` — Triggered by `trigger_auto_post_payment` on `payments`. Migrations 043, 072, 073, 075, 218.
- `post_expense_to_ledger(p_expense_id)` — Triggered by `trigger_auto_post_expense` on `expenses` (AFTER INSERT). Migration 043, 099, 190, 233.
- `post_credit_note_to_ledger(p_credit_note_id)` — Triggered by `trigger_auto_post_credit_note` on `credit_notes` (AFTER INSERT OR UPDATE OF status). Migration 043, 100.
- `post_bill_to_ledger(p_bill_id)` — Triggered by `trigger_auto_post_bill` on `bills`. Migration 043, 100.
- `post_bill_payment_to_ledger(p_bill_payment_id)` — Triggered by `trigger_auto_post_bill_payment` on `bill_payments` (AFTER INSERT). Migration 043.
- `post_sale_to_ledger(p_sale_id, p_posted_by_accountant_id)` — Called from app `app/api/sales/create/route.ts` (no DB trigger). Migrations 099, 100, 162, 175, 179, 182, 189.
- `post_manual_journal_draft_to_ledger(draft_id, user_id)` — Called from API when posting approved manual draft. Migrations 148, 294, 297, 298.
- `post_opening_balance_import_to_ledger` — Opening balance apply path. Referenced in period/audit migrations.

**Period locking:**
- Table: `accounting_periods` (business_id, period_start, period_end, status, etc.).
- Status values: `open`, `closing`, `soft_closed`, `locked`. Valid transitions (migration 303): open → soft_closed or open → closing; closing → open or closing → soft_closed; soft_closed → locked.
- `assert_accounting_period_is_open(business_id, date)` — Called inside posting functions; raises if period is not open. `ensure_accounting_period` find-or-creates period for date.
- Lock: `enforce_period_state_transitions` trigger on `accounting_periods`. Locked is immutable.
- Soft close / lock: Owner path (open → soft_closed); firm path (open → closing → soft_closed; then soft_closed → locked). API: `/api/accounting/periods` (close, approve_close, lock, reopen).

**Snapshot / reporting system:**
- `generate_trial_balance(p_period_id, ...)` — Builds trial balance from `period_opening_balances` + `journal_entry_lines`; persists snapshot (e.g. trial_balance_snapshots or equivalent). Migration 169, 240.
- `get_trial_balance_from_snapshot` — Reads from snapshot. Reports (P&L, balance sheet, general ledger) consume ledger/snapshot data via API routes under `/api/accounting/reports/`, `/api/accounting/trial-balance`, etc.

**Tax engine (VAT / NHIL / GETFund / COVID):**
- **Library:** `lib/taxEngine/` — `index.ts`, `types.ts`, `adapters.ts`, `serialize.ts`, `errors.ts`, `helpers.ts`; jurisdictions: `ghana.ts`, `ghana-shared.ts`, `nigeria.ts`, `kenya.ts`, `zambia.ts`, `east-africa.ts`.
- **Ghana:** `lib/taxEngine/jurisdictions/ghana.ts` — NHIL 2.5%, GETFund 2.5%, COVID 1% (pre-2026) / 0% (≥2026), VAT 15% on (taxable + NHIL + GETFund + COVID). Ledger metadata (account codes 2100, 2110, 2120, 2130) for VAT/NHIL/GETFund/COVID. Versioned by effective date.
- **Legacy / UI:** `lib/taxes/readTaxLines.ts` — Reads `invoice.tax_lines` / legacy columns for display.
- **Retail:** `lib/vat.ts` — Retail VAT helpers; COVID levy 0 for retail. Tax used in sales and posting.

---

## SECTION C — Service Workspace

**Main entities:**
- **Customers** — `customers` table. No ledger posting by themselves.
- **Invoices** — `invoices`. Post to ledger when status becomes sent (trigger `trigger_auto_post_invoice` → `post_invoice_to_ledger`). Uses `tax_lines` (or legacy nhil, getfund, covid, vat) for tax control postings.
- **Invoice items** — `invoice_items`. Not posted directly; invoice totals and tax drive journal lines.
- **Payments** — `payments`. Post via `trigger_auto_post_payment` → `post_invoice_payment_to_ledger` (settlement: AR, Cash/Bank/Momo).
- **Estimates** — `estimates`. Do not post to ledger.
- **Orders** — `orders`. Do not post to ledger until converted to invoice; then invoice posting applies.
- **Recurring invoices** — `recurring_invoices`; generation creates invoices which post when sent.
- **Expenses** — `expenses`. Post via `trigger_auto_post_expense` → `post_expense_to_ledger`.
- **Bills** — `bills`. Post via `trigger_auto_post_bill` → `post_bill_to_ledger`.
- **Bill payments** — `bill_payments`. Post via `trigger_auto_post_bill_payment`.
- **Credit notes** — `credit_notes`. Post via `trigger_auto_post_credit_note` → `post_credit_note_to_ledger`.
- **Products & services** — `products_services` (service industry); used on invoice lines. No direct ledger posting.
- **Assets** — `assets`; asset creation/depreciation can post (e.g. fixed assets, depreciation). API `app/api/assets/create/route.ts`, `app/api/assets/[id]/depreciation/route.ts`.

**What posts to ledger (service):**
- Invoices (on status → sent).
- Payments (invoice payment settlement).
- Expenses (on insert).
- Credit notes (on insert/update status).
- Bills (on insert/update status).
- Bill payments (on insert).
- Manual journal drafts (when approved and posted via API).
- Opening balance imports (when applied).

**What does NOT post to ledger (service):**
- Estimates.
- Orders (until converted to invoice; then the invoice posts).
- Draft invoices.
- Customers, products_services (catalog only).

---

## SECTION D — Retail Workspace

**Sales flow:**
- **Create sale:** `POST /api/sales/create` — Creates `sales` row and `sale_items`; then calls `post_sale_to_ledger(p_sale_id, p_posted_by_accountant_id)` with `business.owner_id`. Failure to post rolls back sale creation (deletes sale_items and sale).
- **Void:** Override/void flow (e.g. `app/api/override/void-sale/route.ts`) — Reversal journal, stock movement (service role client). No automatic trigger for void; app-driven.

**POS structure:**
- **Routes:** `/pos` (main POS page — `app/(dashboard)/pos/page.tsx` or `app/pos/`), `/sales/open-session`, `/sales/close-session`. Register session and store context from `lib/storeSession.ts`, `lib/cashierSession.ts`.
- **Tables:** `sales`, `sale_items`, `registers`, `register_sessions` (or equivalent; migration 199 references `register_id` on sales). Stores: `stores` table; registers belong to a store.

**Register logic:**
- `registers` — store_id, is_default (one default per store). Migration 027, 127.
- Open/close session routes under `/sales/`. Store context required for POS and inventory/analytics (accessControl).

**Inventory tables:**
- **Retail products:** `products` (not `products_services`). `products_stock`, stock movements (e.g. void-sale creates stock movement). Low stock, bulk import, inventory dashboard, stock transfers — `app/admin/retail/` and `app/inventory/`.
- **Purchase orders:** `app/admin/retail/purchase-orders/` — Purchase orders for retail.

**How sales post to ledger:**
- `post_sale_to_ledger` — Called explicitly from `app/api/sales/create/route.ts` after sale and sale_items are created. Posts revenue, tax (from sale tax_lines), COGS (from sale_items), inventory. Uses `chart_of_accounts_control_map` (e.g. CASH, Revenue, tax accounts). Requires open accounting period; uses `p_posted_by_accountant_id` (business owner as system accountant).

---

## SECTION E — Accountant-Oriented Capabilities

**Multi-business support:**
- **Accounting workspace:** Access via firm membership (`accounting_firm_users`). Routes `/accounting/*` use `business_id` from URL/query or firm context. `resolveAccountingContext`, `getCurrentBusiness`, firm clients list.
- **Firm routes:** `/accounting/firm/`, `/accounting/control-tower`, `/admin/accounting` — firm-only. Control tower, engagements, clients, bulk ops, forensic runs, tenants.
- **Service owner:** Can use `/service/*` accounting routes for own business (ledger, CoA, trial balance, periods, reconciliation, audit, health) or be linked to firm engagement.

**Period management:**
- **API:** `/api/accounting/periods` — List, create (if any), close (soft_close), approve_close, lock, reopen. Period status transitions enforced in DB.
- **UI:** `app/accounting/periods/page.tsx`, `app/service/accounting/periods/page.tsx`. Carry-forward: `/api/accounting/carry-forward/`, `/api/accounting/carry-forward/apply/`.

**Manual journals:**
- **Drafts:** `manual_journal_drafts` (or equivalent). Create: `/api/accounting/journals/drafts`, review/approve, post: `POST /api/accounting/journals/drafts/[id]/post` → `post_manual_journal_draft_to_ledger`. Ledger immutability and idempotency (input_hash, source_draft_id) in migrations 148, 294, 297, 298.

**Adjustments:**
- **Routes:** `/accounting/adjustments`, `/accounting/adjustments/review`, `/service/accounting/adjustment`. Opening balances: `/api/accounting/opening-balances/`, apply/approve flows. Controlled adjustments in soft_closed periods (migration 166).

**Reports:**
- **Accounting reports:** Trial balance, general ledger, profit & loss, balance sheet, AFS (annual financial statement) — under `/api/accounting/reports/`, `/api/accounting/trial-balance`, etc. Export CSV/PDF for some.
- **Shared reports hub:** `/reports` — Used by both service and retail; P&L, balance sheet, VAT returns. `app/reports/page.tsx` — retail-specific links when `industry === "retail"`.

**Audit logs:**
- **Table / RPC:** `audit_logs` (or equivalent); `create_audit_log` RPC. `lib/auditLog.ts` — `createAuditLog` / `logAudit` for app-level actions.
- **List API:** `/api/audit-logs/list` — Filter by action_type, entity_type, etc.
- **UI:** `app/audit-log/page.tsx` — System Activity; filter options include e.g. `invoice.sent_whatsapp`.
- **Accounting audit API:** `/api/accounting/audit` — Query by businessId, actionType, entityType, userId, entityId, startDate, endDate.

---

## SECTION F — Communication Layer

**Invoice send:**
- **API:** `POST /api/invoices/[id]/send` — Body: sendEmail, sendWhatsApp, copyLink, sendMethod, email. Generates public link, template message, `buildWhatsAppLink`; returns `whatsappUrl`. Can send email (TODO implementation note in code). Updates invoice status/sent_at/sent_via_method; triggers `trigger_auto_post_invoice` when status becomes sent.
- **UI:** Invoice view "Finalize & Send" → `SendInvoiceModal`; invoice edit/new also use send modal or choice modal.

**Public invoice:**
- **URL pattern:** `/invoice-public/[token]`. Page: `app/invoice-public/[token]/page.tsx` — fetches `GET /api/invoices/public/[token]`. No auth; access by token only.
- **API:** `app/api/invoices/public/[token]/route.ts` — Selects invoice by `public_token`, `deleted_at` null; returns invoice, business, settings, items. Token from `invoice.public_token` (generated by RPC or on send).

**WhatsApp:**
- **Link build:** `lib/communication/whatsappLink.ts` — `normalizePhoneForWaMe`, `buildWhatsAppLink` → `https://wa.me/${digits}?text=${encodeURIComponent(message)}`.
- **Template:** `lib/communication/renderWhatsAppTemplate.ts` — Replaces `{{key}}` with variables; used in invoice/estimate/order send APIs. Template per business/type: `getBusinessWhatsAppTemplate(supabase, business_id, "invoice"|"estimate"|"order")`.
- **Send entry points:** Invoice send API, estimate send API, order send API, credit note view, customer statement, supplier statement, recurring generate (auto_whatsapp), reminders (overdue). Settings: `/settings/integrations/whatsapp`; status: `GET /api/whatsapp/status`.

**Email:**
- **Invoice/estimate/order send:** Send APIs accept sendEmail; email path updates sent metadata. Actual email sending noted as TODO in invoice send route.
- **Credit note:** `app/api/credit-notes/[id]/send/route.ts` — Email send; audit `credit_note.sent_email`.

**Logging of sent documents:**
- **Audit log:** `createAuditLog` with actionType e.g. `invoice.sent_whatsapp`, `invoice.sent_email`, `estimate.sent_whatsapp`, `estimate.sent_email`, `order.confirmation_sent_whatsapp`, `order.confirmation_sent_email`, `credit_note.sent_email`. Stored in `audit_logs` via RPC `create_audit_log`.
- **Entity fields:** Invoices: `sent_at`, `sent_via_method`. Orders: `confirmation_sent_at`, `confirmation_sent_via`. Estimates: status/sent tracking in send route.

**Other public document links:**
- **Receipt:** `/receipt-public/[token]` — `app/receipt-public/[token]/page.tsx`; API `app/api/receipts/public/[token]/route.ts`.
- **Estimate:** `/estimate-public/[token]` — Built in estimate send route.
- **Order:** `/order-public/[token]` — Built in order send route.
- **Credit note:** `/credit-public/[token]` — Referenced in credit note view; API `app/api/credit-notes/public/[token]/route.ts`.
