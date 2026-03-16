# Audit: WhatsApp Send Flow (Service + Accounting)

**Mode: READ-ONLY. No fixes. No refactors.**

---

## 1. All WhatsApp-Related Code

| File | Line | Function / element | Description of behavior |
|------|------|--------------------|-------------------------|
| `components/Sidebar.tsx` | 220 | Menu item | Label "WhatsApp Integration", route `/settings/integrations/whatsapp`. |
| `app/api/recurring-invoices/generate/route.ts` | 203–239 | (inline) | If `auto_whatsapp`: loads customer `whatsapp_phone`/`phone`, builds message with invoice link, builds `whatsappUrl` with `encodeURIComponent(message)`, returns `whatsappInfo: { phone, message, url }`. |
| `app/api/invoices/[id]/send/route.ts` | 86, 99, 106, 139–276, 374 | POST body, select, send branch | Parses `sendWhatsApp`; loads invoice with `customers(whatsapp_phone, phone)`; checks `business.whatsapp_connected`; uses `customer?.whatsapp_phone \|\| customer?.phone`; builds `publicInvoiceUrl`, `payUrl`, `message`; `whatsappUrl = https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`; optional `sendWhatsAppMessage()`; returns `whatsappUrl`. |
| `app/api/estimates/[id]/send/route.ts` | 23, 88–164 | POST body, sendWhatsApp block | Uses `customer?.whatsapp_phone \|\| customer?.phone`; builds `cleanPhone` (+233), `publicEstimateUrl` (if `estimate.public_token`), message; `whatsappUrl = https://wa.me/${e164Phone.replace(/\+/g, "")}?text=${encodeURIComponent(message)}`; returns `whatsappUrl`. |
| `lib/communication/sendWhatsAppMessage.ts` | 2–262 | `normalizePhoneForWhatsApp`, `sendWhatsAppMessage`, `enqueueWhatsAppMessage` | Normalizes phone (strip spaces, leading 0 → defaultCountryCode 233); provider abstraction (twilio/meta/mock); send/enqueue. |
| `app/settings/integrations/whatsapp/page.tsx` | 9–318 | `WhatsAppSettingsContent`, page | Loads WhatsApp status, connect/disconnect UI, "Connect WhatsApp" / "Disconnect WhatsApp". |
| `app/api/whatsapp/status/route.ts` | 1–41 | GET | Returns `connected: business.whatsapp_connected`, phone_number, etc. for current business. |
| `app/api/whatsapp/connect/route.ts` | (exists) | — | Connect flow. |
| `app/api/whatsapp/disconnect/route.ts` | (exists) | — | Disconnect flow. |
| `app/api/whatsapp/callback/route.ts` | (exists) | — | Callback for OAuth/connect. |
| `app/estimates/[id]/view/page.tsx` | 184–205, 488–494 | `handleSend`, button | `handleSend("whatsapp")` → POST send with `sendWhatsApp: true`; if `data.whatsappUrl` then `window.open(data.whatsappUrl, "_blank")`. Button label "Send via WhatsApp". |
| `app/credit-notes/[id]/view/page.tsx` | 169–180, 506–507 | `sendViaWhatsApp`, Button | Builds message with `creditNote?.public_token`, `cleanPhone` (+233); `window.open(\`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}\`, "_blank")`. No API call; client-only. Button "Send via WhatsApp". |
| `app/invoices/[id]/view/page.tsx` | 230–252, 682–686, 734–747 | `sendReceiptViaWhatsApp`, WhatsApp link, SendInvoiceModal | Receipt: phone from invoice.customers, receipt URL from `payment.public_token`, `window.open(whatsappUrl, "_blank")`. Main send: "Finalize & Send" opens SendInvoiceModal (defaultMethod whatsapp); modal passes `invoice.public_token`, customers. |
| `components/invoices/SendInvoiceModal.tsx` | 55, 57–97, 301 | `publicInvoiceUrl`, `handleSendWhatsApp` | `publicInvoiceUrl = window.location.origin + /invoice-public/${invoice.public_token}`; checks `/api/whatsapp/status`; POST `/api/invoices/${invoiceId}/send` with `sendWhatsApp: true`; on success `window.open(data.whatsappUrl, "_blank")`. Link to Settings WhatsApp at 301. |
| `app/recurring/[id]/view/page.tsx` | 69–72, 230–231 | (inline) | If `whatsappInfo` from generate response, `window.open(whatsappInfo.url, "_blank")`. |
| `app/recurring/page.tsx` | 114–115 | (inline) | After generate, if `whatsappInfo?.url`, `window.open(whatsappInfo.url, "_blank")`. |
| `app/bills/[id]/view/page.tsx` | 128–138, 443–449 | `sendViaWhatsApp`, button | Builds `whatsappUrl` (wa.me + encoded text), `window.open(whatsappUrl, "_blank")`. Button "Send via WhatsApp". |
| `app/customers/[id]/statement/page.tsx` | 101–115, 201–207 | `sendStatementViaWhatsApp`, button | Builds message with statement summary, `window.open(whatsappUrl, "_blank")`. "Send via WhatsApp". |
| `app/suppliers/[name]/statement/page.tsx` | 91–101, 163–169 | `sendStatementViaWhatsApp`, button | Same pattern. "Send via WhatsApp". |
| `components/orders/SendOrderConfirmationModal.tsx` | 34–61, 81, 213–239, 279 | `checkWhatsAppStatus`, `handleSendWhatsApp` | Checks `/api/whatsapp/status`; POST order send with `sendWhatsApp: true`; `window.open(data.whatsappUrl, "_blank")`. |
| `app/invoices/new/page.tsx` | 785 | (inline) | On send, body includes `sendMethod`, `sendWhatsApp: method === "whatsapp" \|\| method === "both"`. |
| `app/settings/business-profile/page.tsx` | 34, 93, 243, 481–486 | Form field | `whatsapp_phone` on business profile (display/edit). |
| `app/api/business/profile/route.ts` | 62, 107, 216 | (inline) | Reads/updates `whatsapp_phone` for business. |
| `app/payroll/staff/[id]/page.tsx` | 15, 296–297 | Display | Shows `staff.whatsapp_phone`. |
| `app/settings/staff/page.tsx` | 607, 710 | Display / form | WhatsApp phone for member. |
| `supabase/migrations/051_fix_all_table_structures.sql` | 146, 163, 225, 352, 440 | Schema | `whatsapp_phone` on customers, businesses; `auto_whatsapp` on recurring_invoices. |
| `lib/auditLog.ts` | 76 | Comment | Ref to WhatsApp sends in audit. |
| `components/documents/FinancialDocument.ts` | 27, 38, 437 | Types, template | `whatsapp_phone` on customer/business; prints "WhatsApp: ..." in template. |

---

## 2. Intended Flow (Invoices)

- **Where is the WhatsApp button rendered?**
  - Invoice view: **"Finalize & Send"** (draft) opens **SendInvoiceModal**; modal has send method dropdown (WhatsApp / Email / Copy link) and triggers send. So the “WhatsApp” path is: **Finalize & Send** → modal → choose WhatsApp (or default) → Send → API returns `whatsappUrl` → `window.open(whatsappUrl, "_blank")`.
  - Invoice view (sent): per-payment **"WhatsApp"** link for receipt (client-side only, no send API).
- **What data does it use?**
  - **Invoice:** `invoice.id`, `invoice.invoice_number`, `invoice.total`, `invoice.currency_code`, `invoice.payment_terms`, `invoice.public_token`, `invoice.business_id` (from API load with `*`).
  - **Public invoice link:** `publicInvoiceUrl = ${NEXT_PUBLIC_APP_URL}/invoice-public/${invoice.public_token}` (API route line 136).
  - **Pay link:** `payUrl = ${NEXT_PUBLIC_APP_URL}/pay/${invoice.id}` (API route line 190).
  - **Total amount:** `Number(invoice.total).toFixed(2)` with `currencySymbol` from `getCurrencySymbol(invoice.currency_code)`.
  - **Customer:** `invoice.customers` → `whatsapp_phone` or `phone`, `name`.
  - **Modal:** `invoice.public_token` (passed as `invoice.public_token || ""`), `invoice.customers` (email, phone, whatsapp_phone). API does not receive `public_token` in body; it reads it from the invoice row.

**Exact variables in message (API):**

- `customer?.name`, `customer?.whatsapp_phone || customer?.phone`
- `invoice.invoice_number`, `invoice.total`, `invoice.currency_code` → symbol, `invoice.payment_terms`
- `publicInvoiceUrl`, `payUrl` (constructed as above)

---

## 3. Public Invoice Link Audit

- **Is there a public invoice route?**
  - **Yes.** Page: `app/invoice-public/[token]/page.tsx`. URL pattern: `/invoice-public/[token]` (e.g. `/invoice-public/abc123base64url`).
- **API:** `app/api/invoices/public/[token]/route.ts` (GET). Fetches invoice by `public_token` (eq), no auth. Returns invoice, business, settings, items.
- **How URL is constructed:**
  - Server (send route): `publicInvoiceUrl = ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/invoice-public/${invoice.public_token}`.
  - Modal (client): `publicInvoiceUrl = ${window.location.origin}/invoice-public/${invoice.public_token}` (for display/copy; actual message body is built on server).
- **Signed token system?**
  - **No.** Token is an opaque value from `generate_public_token()` (Supabase RPC): `encode(gen_random_bytes(32), 'base64url')`. No signature or HMAC; not time-bound.
- **Access without auth?**
  - **Yes.** Public page and API use token only; no session required. API uses `supabase` from `@/lib/supabaseClient` (server-side in route handler).
- **Does link expire?**
  - **No.** Token is not time-limited; no expiry field or check.
- **business_id or secret in URL?**
  - **No.** URL is `/invoice-public/{token}` only. Token is a random identifier; knowing it grants access to that invoice (and API returns full invoice/business/items).

---

## 4. Phone Number Source

- **Where stored:**
  - **Customer:** `customers.whatsapp_phone`, `customers.phone` (DB columns; see migration 051: `whatsapp_phone TEXT`, `phone`).
  - **Business:** `businesses.whatsapp_phone` (profile/settings).
- **Which field is used for WhatsApp (invoices):**
  - **Customer:** `customer?.whatsapp_phone || customer?.phone`. Same pattern for estimates, credit notes, recurring, orders.
- **Normalization:**
  - **Invoice send:** `cleanPhone = phone.replace(/\s+/g, "").replace(/^0/, "+233")` — no country code if already present; leading 0 replaced with +233 (Ghana).
  - **Estimate send:** `cleanPhone = phone.replace(/\s+/g, "").replace(/^0/, "+233")` then `e164Phone = cleanPhone.startsWith("+") ? cleanPhone : "+233" + cleanPhone`; wa.me uses `e164Phone.replace(/\+/g, "")`.
  - **Credit note (view):** `cleanPhone = String(phone).replace(/\s+/g, "").replace(/^0/, "+233")` (no stripping of + for wa.me).
  - **Lib:** `normalizePhoneForWhatsApp(phone, defaultCountryCode = "233")`: strip spaces, leading 0 → then `+${defaultCountryCode}${cleaned}` if not starting with +. Invoice send route does **not** use this lib; it uses inline replace. `sendWhatsAppMessage` uses the lib for the `to` passed to provider.
- **Validation:**
  - No DB CHECK or app-level regex for E.164 or country code. Only “phone required” and “WhatsApp connected” checks. Missing phone returns 400 with message "Customer phone number is not available...".

---

## 5. Current WhatsApp URL Format

- **Pattern:** `https://wa.me/{phone}?text={encoded_message}`.
- **Invoice send (API):**
  - `cleanPhone = phone.replace(/\s+/g, "").replace(/^0/, "+233")` (keeps `+` in number).
  - `whatsappUrl = \`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}\``.
  - So URL is `https://wa.me/+233...?text=...`. wa.me accepts numbers with or without + in practice; some docs show digits only.
- **Estimate send:** `https://wa.me/${e164Phone.replace(/\+/g, "")}?text=...` — plus stripped for wa.me.
- **Credit note (view):** `https://wa.me/${cleanPhone}?text=...` — cleanPhone includes + (same as invoice).
- **Message:** Yes, URL-encoded via `encodeURIComponent(message)` everywhere.
- **Invoice link in message:** Yes. Server-built message includes `View invoice: ${publicInvoiceUrl}` and `Pay Now: ${payUrl}`.

---

## 6. Gaps / Incomplete Areas

- **Message:** Templated in code (string literal with interpolated vars). No user-editable template or locale; currency symbol from code; "GHS" hardcoded in estimate message.
- **Currency:** Invoice uses `getCurrencySymbol(invoice.currency_code)`; if missing, API returns 400 "Currency symbol could not be determined". Estimate uses fixed "GHS" in message.
- **Link guaranteed to exist?**
  - **No.** Send route does not check `invoice.public_token` before building `publicInvoiceUrl`. If `public_token` is null/undefined, URL becomes `.../invoice-public/undefined` and the link is broken. Token is set on invoice create/convert; legacy or edge cases could leave it null.
- **Phone missing:** Handled: API returns 400 with message; modal shows error. No fallback (e.g. “Copy link only”).
- **Desktop:** `window.open(whatsappUrl, "_blank")` opens wa.me in a new tab; user completes send in WhatsApp (web or app). Works on desktop.
- **Mobile:** Same URL works; typically opens WhatsApp app if installed. No explicit mobile detection or app deep link beyond wa.me.
- **Other gaps:**
  - **Inconsistent phone for wa.me:** Invoice/credit note use `+233...` in URL; estimate strips `+`. wa.me is tolerant but spec is digits-only.
  - **Credit note send:** Purely client-side; no API, no audit log, no “WhatsApp connected” check. Public URL uses `creditNote?.public_token ?? ""` so can be `/credit-public/` if token missing.
  - **Recurring generate:** Returns `whatsappInfo` only when `auto_whatsapp`; message built with invoice link (from generated invoice’s public_token).
  - **Bills/customer/supplier statements:** Client-side only; build message and open wa.me; no send API or central template.
  - **SendInvoiceModal** uses `invoice.public_token || ""`; if empty, modal still allows send and server will embed `.../invoice-public/undefined` in the message.
  - **No expiry or revocation** of public token; once leaked, link is valid until token is changed (no UI for rotation).
  - **/api/invoices/public/[token]** uses `supabase` from `supabaseClient`; need to confirm this is server-safe (service role or anon with RLS). If anon, RLS must allow read by token only.

---

## 7. Do NOT Fix Yet

**READY FOR IMPLEMENTATION PLAN**

- No refactors or file changes have been made.
- This document is for audit and implementation planning only.
