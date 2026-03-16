# Credit Note Apply Validation — Ex-Tax Basis Audit (Evidence Only)

**Scope:** `app/api/credit-notes/create/route.ts`, `app/api/credit-notes/[id]/route.ts` (apply), `app/credit-notes/create/page.tsx`  
**Goal:** Identify exactly which field is used as invoice gross, confirm tax-inclusive vs ex-tax basis, and where behaviour diverges. No fixes in this document.

---

## 1) Field used as “invoice gross”

### 1.1 `app/api/credit-notes/create/route.ts`

| Location | Code | Field used as invoice gross |
|----------|------|-----------------------------|
| Invoice fetch | L44–50 | `invoice.total`, `invoice.subtotal`, `invoice.total_tax` (all selected) |
| Gross / remaining | L195–197 | `rawTotal = Number(invoice.total \|\| 0)`; `derivedGross = round((invoice.subtotal + invoice.total_tax) * 100) / 100`; `invoiceGross = rawTotal > 0 ? rawTotal : derivedGross` |

**Conclusion:** Invoice gross is **`invoice.total`** when `invoice.total > 0`, otherwise **`invoice.subtotal + invoice.total_tax`**. Both are gross (tax-inclusive).

---

### 1.2 `app/api/credit-notes/[id]/route.ts` (PUT, apply)

| Location | Code | Field used as invoice gross |
|----------|------|-----------------------------|
| Invoice fetch | L139–144 | `.select("total")` only |
| Apply balance | L164–172 | `invoiceGross = Number(invoice?.total \|\| 0)` |

**Conclusion:** Apply uses **only `invoice.total`** as invoice gross. No subtotal or total_tax, no fallback.

---

### 1.3 `app/credit-notes/create/page.tsx`

| Location | Code | Field used as invoice gross |
|----------|------|-----------------------------|
| Data source | L76–86 | `fetch(\`/api/invoices/${invoiceId}\`)` → `data.invoice`, `data.items`; **no** `data.payments` / `data.creditNotes` stored in state |
| Gross / remaining | L186–196 | `rawTotal = Number(invoice?.total \|\| 0)`; `derivedGross = round((invoice?.subtotal + invoice?.total_tax) * 100) / 100`; `invoiceGross = rawTotal > 0 ? rawTotal : derivedGross`; `remainingGross = invoiceGross - paymentsGross - creditsGross` |
| Payments/credits | L190–195 | `paymentsGross = (invoice?.payments ?? []).reduce(...)`; `creditsGross = (invoice?.creditNotes ?? []).filter(cn => cn.status === "applied").reduce(...)` |

**Conclusion:** Invoice gross uses **`invoice.total`** or **`invoice.subtotal + invoice.total_tax`** (same as create API).  
**But:** `invoice` is `data.invoice`. The invoices API returns `{ invoice, items, payments, creditNotes }` (siblings). The page never assigns `data.payments` or `data.creditNotes` into state, so **`invoice.payments` and `invoice.creditNotes` are always undefined**. Thus `(invoice?.payments ?? [])` and `(invoice?.creditNotes ?? [])` are always `[]`, so **`paymentsGross = 0`** and **`creditsGross = 0`**, and **`remainingGross = invoiceGross`** (full invoice gross, not true remaining).

---

## 2) Credit note total — which basis

### 2.1 Create API

- **Source:** Request body `items` (qty, unit_price, discount_amount).
- **Logic:** `getCanonicalTaxResultFromLineItems(lineItems, { taxInclusive: true })` (L129–134).
- **Value:** `creditNoteTotal = taxResult.total_amount` (tax-inclusive).

**Conclusion:** Credit note total is **tax-inclusive**.

---

### 2.2 Apply (PUT [id])

- **Source:** `credit_notes.total` from DB (set at create).
- **Conclusion:** Same basis as create → **tax-inclusive**.

---

### 2.3 Create page

- **Source:** Form `items` (prefilled from `data.items` = invoice_items: qty, unit_price, discount_amount).
- **Logic:** `grossTotal = sum(qty * unit_price - discount)` (L140–144). Then `taxResult.grandTotal = grossTotal` (L160 or L169). Validation uses `taxResult.grandTotal` (L198–200).
- **Interpretation:** The page treats `grossTotal` as the credit total. That is **tax-inclusive only if** the prefilled `unit_price` / line totals from the invoice are stored as tax-inclusive. If invoice_items hold **ex-tax** unit_price or ex-tax line_subtotal, then `grossTotal` is **ex-tax** and the page compares an ex-tax “credit total” to a gross “remaining”.

**Conclusion:** Credit note total on the page is **whatever the invoice line totals are** — tax-inclusive if invoice was stored in tax-inclusive mode; ex-tax if invoice items are ex-tax.

---

## 3) Confirmation of bases

| Question | Answer | Evidence |
|----------|--------|----------|
| Is `invoice.total` tax-inclusive? | **Yes** | Invoices PUT uses `taxCalculationResult.total_incl_tax` and `updateData.total = invoiceTotal`; create/update semantics treat `total` as gross. |
| Is credit note total (create API) tax-inclusive? | **Yes** | Create route uses `getCanonicalTaxResultFromLineItems(..., { taxInclusive: true })` and `creditNoteTotal = taxResult.total_amount`. |
| Is remaining computed on the same basis as invoice gross? | **Create API & Apply:** yes. **Create page:** no — remaining uses wrong inputs (see below). | Create API: `remainingGross = invoiceGross - paymentsGross - creditsGross` with gross sources. Apply: `remainingGross = invoiceGross - totalPaid - totalCredits`, `invoiceGross = invoice.total`. Create page: same formula but with `paymentsGross = creditsGross = 0` because `invoice.payments` / `invoice.creditNotes` are undefined. |

---

## 4) Where it diverges

### 4.1 Create page “remaining” uses full invoice gross (not true remaining)

- **Current behaviour:** `invoice?.payments` and `invoice?.creditNotes` are undefined (API returns `payments` and `creditNotes` as siblings of `invoice`). So `remainingGross = invoiceGross - 0 - 0 = invoiceGross`.
- **Effect:** Remaining is **full invoice gross**, so the page allows credit up to the full invoice. True remaining (after payments and applied credits) is smaller. User can pass page validation and then be rejected by the create API when `creditTotalRounded > remainingGrossRounded` there (create API uses real payments/credits).

---

### 4.2 Create page “credit total” can be ex-tax

- **Current behaviour:** `grossTotal = sum(qty * unit_price - discount)` from prefilled invoice items. `taxResult.grandTotal = grossTotal` is used as the credit total. No separate tax engine run for the “total” — only `calculateBaseFromTotalIncludingTaxes(grossTotal, ...)` for display.
- **Effect:** If invoice_items hold **ex-tax** unit_price/line_subtotal (e.g. legacy or alternate flow), then `grossTotal` is ex-tax. The page then compares:
  - **Remaining** = (incorrectly) full invoice gross, or
  - **Remaining** = invoice gross − payments − credits (if payments/credits were fixed),
  and **credit total** = ex-tax sum.
- So validation can “behave like it uses ex-tax amounts” when the **credit total** is ex-tax while **remaining** is gross (or vice versa if remaining were ever subtotal-based elsewhere).

---

### 4.3 Apply route — no ex-tax in evidence

- Apply uses **only `invoice.total`** and **`credit_notes.total`**. No use of subtotal or derived ex-tax. Comment L137–138: “Invoice balances are always computed from invoice.total (gross). Never recompute balance using subtotal or extracted tax.”

---

## 5) Short report summary

| Item | Finding |
|------|--------|
| **Current basis** | **Create API:** invoice gross = `invoice.total` or `subtotal + total_tax`; remaining = that minus payments and applied credits; credit total = tax engine `total_amount` (tax-inclusive). **Apply:** invoice gross = `invoice.total`; remaining = that minus payments and other applied credits; credit total = `credit_notes.total`. **Create page:** invoice gross = same as create API; “remaining” = invoice gross − `invoice.payments` − `invoice.creditNotes` → in practice **invoice gross** because those are undefined; credit total = `grossTotal` = sum(invoice item line totals) → tax-inclusive only if invoice items are gross. |
| **Expected basis** | All comparisons should be gross (tax-inclusive): invoice gross = `invoice.total` (or subtotal+total_tax when total is missing), remaining = invoice gross − payments − applied credits, credit total = tax-inclusive. |
| **Where it diverges** | (1) **Create page remaining:** Uses `invoice?.payments` / `invoice?.creditNotes`, which are never set (API returns `payments` and `creditNotes` next to `invoice`). So remaining = full invoice gross. (2) **Create page credit total:** Uses sum of invoice line totals; if those are stored ex-tax, the credit total is ex-tax and “behaves like ex-tax” vs a gross remaining. |
| **Minimum fix (evidence-only, not applied here)** | (1) Create page: Use `data.payments` and `data.creditNotes` when computing remaining (e.g. keep them in state from `loadInvoiceData` and use in the “credit note would exceed invoice balance” check). (2) Create page credit total: Ensure the value compared to remaining is on the same basis as invoice gross — either guarantee invoice items are always stored/returned as tax-inclusive, or compute credit total via the same tax-inclusive path as the create API (e.g. same engine/config) so both sides are gross. |

---

## 6) Evidence references

- Create route invoice gross: `app/api/credit-notes/create/route.ts` L195–202.  
- Apply route invoice gross: `app/api/credit-notes/[id]/route.ts` L139–144, L164–172.  
- Create page gross/remaining: `app/credit-notes/create/page.tsx` L186–198; data loading L84–86 (no `payments`/`creditNotes` stored).  
- Invoices API response shape: `app/api/invoices/[id]/route.ts` L216–221 (`{ invoice, items, payments, creditNotes }`).  
- Create route credit total: `app/api/credit-notes/create/route.ts` L122–134 (`getCanonicalTaxResultFromLineItems`, `creditNoteTotal = taxResult.total_amount`).  
- Create page credit total: `app/credit-notes/create/page.tsx` L140–144, L160, L198 (`grossTotal`, `taxResult.grandTotal`).
