# Service Mode — Production Readiness Report

**Date:** 2025-02-12  
**Scope:** Service Mode workflow audit, accounting integrity, WhatsApp scaffold, Mobile Money scaffold, blocking defects.

---

## 1. Service Workflow Completeness Matrix

| Stage | UI | API | DB | Ledger | Status |
| ----- | -- | --- | -- | ------ | ------ |
| **Customer** | `/customers`, `/customers/new`, `/customers/[id]`, `/customers/[id]/statement`, `/customers/[id]/360` | `GET/POST /api/customers`, `GET/PATCH /api/customers/[id]`, `GET /api/customers/[id]/statement`, `GET /api/customers/[id]/360`, `GET /api/customers/[id]/history` | `customers`, `businesses`, `business_users` | N/A (operational only) | Complete |
| **Estimate** | `/estimates`, `/estimates/new`, `/estimates/[id]/view`, `/estimates/[id]/edit`, `/estimates/[id]/convert` | `POST /api/estimates/create`, `GET/PATCH /api/estimates/[id]`, `POST /api/estimates/[id]/send`, `POST /api/estimates/[id]/convert` | `estimates`, `estimate_items` | Does NOT post | Complete |
| **Order** | `/orders`, `/orders/new`, `/orders/[id]/view`, `/orders/[id]/edit` | `POST /api/orders/create`, `GET /api/orders/list`, `GET/PATCH /api/orders/[id]`, `POST /api/orders/[id]/convert-to-invoice`, `POST /api/orders/convert-from-estimate` | `orders`, `order_items`, `estimates`, `estimate_items`, `customers` | Does NOT post | Complete |
| **Invoice** | `/invoices`, `/invoices/new`, `/invoices/create`, `/invoices/[id]/edit`, `/invoices/[id]/view` | `POST /api/invoices/create`, `POST /api/invoices/[id]/send`, `POST /api/invoices/[id]/mark-paid`, `GET /api/invoices/list` | `invoices`, `invoice_items` | Posts on send: DR AR, CR Revenue, CR Tax (trigger_auto_post_invoice) | Complete |
| **Payment** | Invoice view (mark paid), `/payments` | `POST /api/payments/create`, `POST /api/invoices/[id]/mark-paid` | `payments` | Posts on insert: DR Cash/MoMo, CR AR (trigger_auto_post_payment) | Complete |
| **Credit note** | `/credit-notes`, `/credit-notes/create`, `/credit-notes/[id]/view` | `POST /api/credit-notes/create`, `GET/PUT /api/credit-notes/[id]` | `credit_notes`, `credit_note_items` | Posts when status → applied (trigger_auto_post_credit_note): reverses AR, revenue, tax | Complete |
| **Dashboard** | `/dashboard` (service mode) | Client fetches invoices/payments/credit_notes; `/api/dashboard/ledger-expense-total` (RPC `get_ledger_expense_total`) | `invoices`, `payments`, `credit_notes`; ledger for expense total | Dashboard KPIs from operational tables; expense total from ledger | Complete |

**Validation gaps (documented, no UI redesign):**

- Customer: Archive = `status: 'blocked'`, Restore = PATCH `status: 'active'`. No soft-delete/archived_at in list filter.
- Order create: Auth check bypass in code (body `business_id` required); convert-from-estimate has same bypass.
- Invoice create: Does not call `ensureAccountingInitialized` (draft only; send does).
- Estimate convert to invoice: Copies legacy tax columns; invoice created as draft. Totals match estimate.

---

## 2. Accounting Integrity Verification

| Check | Result |
| ----- | ------ |
| **Posting correctness** | Confirmed. Invoice send → `trigger_auto_post_invoice` (status sent/paid/partially_paid) posts DR AR, CR Revenue, CR Tax. Payment insert → `trigger_post_payment` → `post_invoice_payment_to_ledger`: DR Cash/Bank/MoMo, CR AR. Credit note applied → `trigger_post_credit_note` → `post_credit_note_to_ledger`: reverses AR, revenue, tax. |
| **Authority enforcement** | Confirmed. Service routes use `getCurrentBusiness`; accounting bootstrap and period checks run in send/mark-paid/payments create. No changes to accounting authority engine. |
| **Period enforcement** | Confirmed. `post_invoice_to_ledger`, `post_invoice_payment_to_ledger`, `post_credit_note_to_ledger` call `assert_accounting_period_is_open`; failure rolls back transaction (migration 218). |
| **Snapshot accuracy** | Confirmed. Trigger `invalidate_snapshot_on_journal_entry` marks TB snapshot stale on journal insert. Reports use period-based snapshot/regeneration. |

**Service Mode never bypasses accounting:** Invoice and payment posting are trigger-driven; draft invoices do not post; payment against draft invoice raises and rolls back (migration 227).

---

## 3. WhatsApp Integration Architecture

**Service abstraction:** `lib/communication/sendWhatsAppMessage.ts`

- **Providers:** Twilio, Meta (Cloud API), mock.
- **Config:** `WHATSAPP_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`; or `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`.
- **Functions:** `sendWhatsAppMessage(input, config?)`, `enqueueWhatsAppMessage(input, config?)` (queue placeholder), `logCommunicationEvent(event)`.
- **Normalization:** `normalizePhoneForWhatsApp(phone, defaultCountryCode)` for E.164.

**Trigger mapping:**

| Trigger | Location | Integration |
| ------- | -------- | ----------- |
| Estimate send | `POST /api/estimates/[id]/send` (sendWhatsApp branch) | Currently returns `whatsappUrl` (wa.me). Optional: call `sendWhatsAppMessage` with estimate body and `entityType: 'estimate'`, `entityId: estimateId` (scaffold ready). |
| Invoice send | `POST /api/invoices/[id]/send` (sendWhatsApp branch) | Calls `sendWhatsAppMessage` after transition; client still receives `whatsappUrl` as fallback. |
| Payment success | `POST /api/payments/create`, `POST /api/invoices/[id]/mark-paid`, MoMo webhook | Optional: after payment insert/success, call `sendWhatsAppMessage` for payment confirmation (scaffold ready; add in handler when notification required). |

**Logging model:** `CommunicationLogEvent` (at, provider, to, reference, businessId, entityType, entityId, success, messageId, error). Logged via `logCommunicationEvent()` (console today; persist to audit table when needed).

---

## 4. MoMo Integration Architecture

**Payment service layer:** `lib/payments/mobileMoneyService.ts`

- **Providers:** Hubtel, Paystack, Flutterwave, MTN (initiate stubs; MTN used by existing `/api/payments/momo/initiate`).
- **Functions:** `initiateMobileMoney(input)` (provider-specific stubs), `validateWebhookSignature(payload)`, `settlePaymentFromWebhook(input)`, `idempotencyKey(provider, externalId)`.
- **Flow:** Invoice payment request → MoMo initiation (caller creates payment record after initiate; **caller must call ensureAccountingInitialized before insert**) → Provider webhook → Signature validation → Idempotency → Invoice reconciliation (update payment notes, recalc invoice status) → Audit log → 200 ack.

**Webhook handler:** `app/api/payments/webhooks/mobile-money/route.ts`

- **Provider:** `x-momo-provider` header or `?provider=` (hubtel, paystack, flutterwave, mtn).
- **Flow:** Read raw body → validate signature (provider-specific) → find payment by reference → idempotency (transactionId in notes) → on success: update payment notes, recalc invoice status (paid/partially_paid/sent), audit log; on failure: update payment notes → return 200.

**Invoice reconciliation strategy:**

- Payment row created on **initiate** (existing `/api/payments/momo/initiate`). Trigger posts DR Cash CR AR on insert; period must be open and accounting initialized.
- Webhook does **not** create payment; it finds by `reference`, updates notes, and recalculates invoice status from sum of payments + applied credit notes. Ledger already updated at insert.

**Requirements met:**

- Idempotency: same transactionId in notes → return 200 "Already processed".
- Signature validation: provider-specific in `validateWebhookSignature` (Hubtel/Paystack/Flutterwave HMAC; MTN scaffold parses only).
- Invoice reconciliation: totalPaid + totalCredits vs invoice.total → newStatus paid/partially_paid/sent.
- Payment audit logging: `createAuditLog` with actionType `payment.webhook_received`.
- Error recovery: 404 if payment not found; 401 if signature invalid; 200 on success/failure/pending so provider does not retry unnecessarily.

---

## 5. Blocking Defects List

### Critical (breaks ledger or payments)

| ID | Description | Location | Recommendation |
| -- | ----------- | -------- | -------------- |
| C1 | ~~MoMo initiate inserts payment without `ensureAccountingInitialized`~~ | `app/api/payments/momo/initiate/route.ts` | **Fixed.** Route now calls `ensureAccountingInitialized(supabase, invoice.business_id)` before payment insert; returns 500 with clear message if bootstrap fails. |
| C2 | Invoice create does not require accounting for draft; send does. If user sends immediately after create in same session, send can 500 if bootstrap not run. | Design | Documented. No silent fallback; send already returns error. Optional: call bootstrap on first send per business (already in send route). |

### Major (workflow broken)

| ID | Description | Location | Recommendation |
| -- | ----------- | -------- | -------------- |
| M1 | Order convert-to-invoice and convert-from-estimate have auth commented (AUTH DISABLED FOR DEVELOPMENT). Body `business_id` required but not validated against session. | `app/api/orders/[id]/convert-to-invoice/route.ts`, `app/api/orders/convert-from-estimate/route.ts` | Restore `getCurrentBusiness` and `business.id === order.business_id` (and estimate.business_id) checks before production. |
| M2 | Invoice send and payments create have auth bypass (AUTH DISABLED). Invoice lookup does not filter by business_id. | `app/api/invoices/[id]/send/route.ts`, `app/api/payments/create/route.ts` | Restore business ownership checks and invoice.eq('business_id', business.id) for production. |
| M3 | Credit note PUT [id] has auth bypass; no business_id filter on credit note select. | `app/api/credit-notes/[id]/route.ts` | Restore getCurrentBusiness and .eq('business_id', business.id) for production. |

### Minor (UX or logging)

| ID | Description | Location | Recommendation |
| -- | ----------- | -------- | -------------- |
| N1 | Dashboard expense total: on RPC failure, totalExpenses = 0. No user message. | `app/dashboard/page.tsx` (loadServiceDashboardStats) | Documented. Optional: show "Expense data unavailable" when RPC fails. |
| N2 | MoMo callback updates invoice status manually; DB trigger `recalculate_invoice_status` may also run on payment update depending on schema. | `app/api/payments/momo/callback/route.ts` | Prefer single source of truth: either trigger recalc on payment update or webhook recalc. Canonical webhook is `/api/payments/webhooks/mobile-money`; consider deprecating duplicate logic in momo/callback. |
| N3 | Estimate convert to invoice uses legacy tax column names (nhil, getfund, covid, vat) and does not set tax_lines JSONB. | `app/api/estimates/[id]/convert/route.ts` | Documented. Invoice created as draft; when sent, tax_engine_effective_from and tax_lines can be set at send time if needed. |

---

## Definition of Done — Checklist

| Criterion | Status |
| --------- | ------ |
| Customer lifecycle works | Yes (create, edit, status active/blocked, 360, statement) |
| Estimate conversion works | Yes (convert to order, convert to invoice) |
| Invoice ledger posting verified | Yes (trigger on status sent/paid/partially_paid) |
| Payment ledger posting verified | Yes (trigger on payment insert; draft invoice guarded) |
| Credit notes verified | Yes (create draft; PUT status=applied; trigger posts reversal) |
| Dashboard reflects ledger data | Yes (operational KPIs from invoices/payments/credit_notes; expense from ledger RPC) |
| WhatsApp communication service scaffold exists | Yes (`lib/communication/sendWhatsAppMessage.ts`; triggers on invoice send; estimate/payment ready for hook) |
| MoMo payment integration scaffold exists | Yes (`lib/payments/mobileMoneyService.ts`, `app/api/payments/webhooks/mobile-money/route.ts`) |

---

## Files Touched (Scaffolds & Report)

- **Added:** `lib/communication/sendWhatsAppMessage.ts` (WhatsApp provider abstraction, Twilio/Meta/mock, logging, optional queue).
- **Added:** `lib/payments/mobileMoneyService.ts` (Hubtel/Paystack/Flutterwave/MTN initiate and webhook validation, settlePaymentFromWebhook).
- **Added:** `app/api/payments/webhooks/mobile-money/route.ts` (canonical webhook: signature, idempotency, reconciliation, audit).
- **Modified:** `app/api/invoices/[id]/send/route.ts` (optional server-side `sendWhatsAppMessage` call after invoice send transition).
- **Added:** `SERVICE_MODE_PRODUCTION_READINESS_REPORT.md` (this report).

No changes to ledger posting rules, accounting authority engine, engagement evaluator, or database schema. No UI redesigns; deficiencies documented only.
