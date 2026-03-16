# Enabled Routes v1 — Retail + Service Only

Definitive list of API **write** endpoints (POST, PUT, PATCH, DELETE) that are reachable and intended for production for **Retail** and **Service** workspaces.

**Scope:** customers, invoices, payments, sales, products/products_services, orders, estimates, stock/register flows, WhatsApp/receipt sending.  
**Excluded:** admin-only, cron, forensic, dev/test, accounting firm bulk, logistics/rider, payroll, firm accounting.

---

| Method | Route | File | Auth? | Role Check? | Industry Gated? |
|--------|-------|------|-------|-------------|-----------------|
| POST | /api/customers | app/api/customers/route.ts | Yes | No | No |
| PATCH | /api/customers/[id] | app/api/customers/[id]/route.ts | Yes | No | No |
| POST | /api/customers/[id]/notes | app/api/customers/[id]/notes/route.ts | Yes | No | No |
| PUT | /api/customers/[id]/tags | app/api/customers/[id]/tags/route.ts | Yes | No | No |
| POST | /api/invoices/create | app/api/invoices/create/route.ts | No (dev bypass) | No | No |
| PUT | /api/invoices/[id] | app/api/invoices/[id]/route.ts | No (dev bypass) | No | No |
| DELETE | /api/invoices/[id] | app/api/invoices/[id]/route.ts | No (dev bypass) | No | No |
| POST | /api/invoices/[id]/send | app/api/invoices/[id]/send/route.ts | Yes | No | No |
| POST | /api/invoices/[id]/mark-paid | app/api/invoices/[id]/mark-paid/route.ts | Yes | No | No |
| POST | /api/invoices/[id]/unsent | app/api/invoices/[id]/unsent/route.ts | Yes | No | No |
| POST | /api/invoices/preview-draft | app/api/invoices/preview-draft/route.ts | Optional | No | No |
| POST | /api/invoices/preview | app/api/invoices/preview/route.ts | Optional | No | No |
| POST | /api/payments/create | app/api/payments/create/route.ts | Yes | No | No |
| PUT | /api/payments/[id] | app/api/payments/[id]/route.ts | Yes | No | No |
| DELETE | /api/payments/[id] | app/api/payments/[id]/route.ts | Yes | No | No |
| POST | /api/payments/momo | app/api/payments/momo/route.ts | No | No | No |
| POST | /api/payments/momo/initiate | app/api/payments/momo/initiate/route.ts | Yes | No | No |
| POST | /api/payments/momo/callback | app/api/payments/momo/callback/route.ts | No (webhook) | No | No |
| POST | /api/payments/hubtel | app/api/payments/hubtel/route.ts | No | No | No |
| POST | /api/payments/webhooks/mobile-money | app/api/payments/webhooks/mobile-money/route.ts | No (webhook) | No | No |
| POST | /api/sales/create | app/api/sales/create/route.ts | No (body trust) | No | No |
| POST | /api/sales/park | app/api/sales/park/route.ts | No | No | No |
| POST | /api/override/refund-sale | app/api/override/refund-sale/route.ts | Yes (supervisor) | Yes (REFUND) | No |
| POST | /api/override/void-sale | app/api/override/void-sale/route.ts | Yes (supervisor) | Yes (VOID) | No |
| POST | /api/override/discount | app/api/override/discount/route.ts | Yes (supervisor) | Yes (DISCOUNT_OVERRIDE) | No |
| POST | /api/products/create-service | app/api/products/create-service/route.ts | Yes | No | No |
| POST | /api/products/sync-to-services | app/api/products/sync-to-services/route.ts | No (dev bypass) | No | Yes (service only) |
| POST | /api/orders/create | app/api/orders/create/route.ts | No (dev bypass) | No | No |
| PATCH | /api/orders/[id] | app/api/orders/[id]/route.ts | No (dev bypass) | No | No |
| POST | /api/orders/[id]/convert-to-invoice | app/api/orders/[id]/convert-to-invoice/route.ts | Yes | No | No |
| POST | /api/orders/[id]/send | app/api/orders/[id]/send/route.ts | No (dev bypass) | No | No |
| POST | /api/orders/convert-from-estimate | app/api/orders/convert-from-estimate/route.ts | No (dev bypass) | No | No |
| POST | /api/estimates/create | app/api/estimates/create/route.ts | Yes | No | No |
| PUT | /api/estimates/[id] | app/api/estimates/[id]/route.ts | No | No | No |
| POST | /api/estimates/[id]/send | app/api/estimates/[id]/send/route.ts | No | No | No |
| POST | /api/estimates/[id]/convert | app/api/estimates/[id]/convert/route.ts | Yes | No | No |
| POST | /api/stock-transfers | app/api/stock-transfers/route.ts | Yes | No | No |
| POST | /api/stock-transfers/[id]/receive | app/api/stock-transfers/[id]/receive/route.ts | Yes | No | No |
| POST | /api/stock-transfers/[id]/send | app/api/stock-transfers/[id]/send/route.ts | Yes | No | No |
| POST | /api/stock-transfers/[id]/cancel | app/api/stock-transfers/[id]/cancel/route.ts | Yes | No | No |
| POST | /api/register/close | app/api/register/close/route.ts | No | No | No |
| POST | /api/register/override | app/api/register/override/route.ts | Yes (supervisor) | Yes (REGISTER_VARIANCE) | No |
| POST | /api/offline/sync | app/api/offline/sync/route.ts | Yes | No | No |
| POST | /api/settings/whatsapp-template | app/api/settings/whatsapp-template/route.ts | Yes | No | No |
| POST | /api/whatsapp/disconnect | app/api/whatsapp/disconnect/route.ts | Yes | No | No |
| POST | /api/receipts/send | app/api/receipts/send/route.ts | Yes | No | No |
| POST | /api/recurring-invoices/create | app/api/recurring-invoices/create/route.ts | Yes | No | No |
| PUT | /api/recurring-invoices/[id] | app/api/recurring-invoices/[id]/route.ts | Yes | No | No |
| DELETE | /api/recurring-invoices/[id] | app/api/recurring-invoices/[id]/route.ts | Yes | No | No |
| POST | /api/recurring-invoices/generate | app/api/recurring-invoices/generate/route.ts | Yes | No | No |
| POST | /api/credit-notes/create | app/api/credit-notes/create/route.ts | Yes | No | No |
| PUT | /api/credit-notes/[id] | app/api/credit-notes/[id]/route.ts | Yes | No | No |
| POST | /api/credit-notes/[id]/send | app/api/credit-notes/[id]/send/route.ts | Yes | No | No |
| POST | /api/layaway/payments | app/api/layaway/payments/route.ts | Yes | No | No |

---

## Notes

- **Auth?** — Yes = `getUser()` (or equivalent) and 401 if missing; Optional = auth used only to resolve business when body omits it; No = no session check (body trust, webhook, or dev bypass).
- **Role Check?** — Yes = `requireBusinessRole`, `getUserRole` for access, or `hasAuthority` (supervisor override flows); No = no role gating.
- **Industry Gated?** — Yes = explicit `business.industry` check (e.g. service-only); No = no industry restriction in route.
- **Dev bypass** — Route has “AUTH DISABLED FOR DEVELOPMENT” or equivalent; auth logic present but commented out.
- **Webhook** — Callback from payment provider; no user session; may use signature validation.
- **Body trust** — Route accepts `business_id` (or similar) from body without validating against session (e.g. sales/create, payments/momo, register/close).
