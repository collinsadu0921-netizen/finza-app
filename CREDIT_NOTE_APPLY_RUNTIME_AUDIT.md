# Credit Note Apply — Runtime Audit (Read-Only)

**Purpose:** Identify the real code path and data cause of "Credit note amount exceeds invoice balance" when credit equals outstanding. No code changes.

---

## 1. Exact error-string source(s) and route(s)

**Exact phrase (as shown to user):** `"Credit note amount exceeds invoice balance"` (no currency symbol, no "cannot").

| Location | File | Line | Route / context |
|----------|------|------|------------------|
| **Only API source** | `app/api/credit-notes/[id]/route.ts` | 233 | `PUT` handler, inside apply balance-check block |

**Other occurrences in repo (not the same message):**

- `app/api/credit-notes/create/route.ts` line 219:  
  `Credit note amount (₵...) cannot exceed invoice balance (₵...)` — different text (create flow).
- `app/credit-notes/create/page.tsx` line 285:  
  Same create-flow message with ₵ (client-side).
- `app/api/payments/create/route.ts` line 200:  
  `"Payment amount exceeds invoice balance"` — payments, not credit notes.
- All other hits are in `.md` audit/fix docs.

**Conclusion:** The user-facing message "Credit note amount exceeds invoice balance" is thrown only by **PUT `/api/credit-notes/[id]`** in `app/api/credit-notes/[id]/route.ts` at line 233. There is no other route or duplicate file throwing this exact string.

---

## 2. Exact endpoint the UI calls

**File:** `app/credit-notes/[id]/view/page.tsx`

**Apply flow:**

- User clicks "Apply Credit Note" → `handleApply()` (lines 80–87) → confirm dialog → on confirm `runApply()` (lines 91–109).
- **Fetch call (lines 94–98):**

```ts
const response = await fetch(`/api/credit-notes/${id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "applied" }),
})
```

- **URL:** `PUT /api/credit-notes/[id]` where `[id]` is the credit note id from the page params.
- **Body:** `{ status: "applied" }` only.
- **Error display:** On `!response.ok`, body is parsed and `errorData.error` is thrown; the toast shows `err.message` (line 108), so the user sees the API’s `error` string — i.e. "Credit note amount exceeds invoice balance" when that’s what the PUT route returns.

**Conclusion:** The UI definitely calls **PUT `/api/credit-notes/[id]`** and shows the error string returned by that route. No other endpoint is used for Apply.

---

## 3. Full outstanding formula in the throwing path

**File:** `app/api/credit-notes/[id]/route.ts`  
**Block:** Lines 175–235 (when `status === "applied"` and `existingCreditNote.status !== "applied"`).

**Step-by-step (as implemented):**

1. **Invoice gross**
   - `rawTotal = Number(invoice?.total || 0)`
   - `derivedGross = Math.round((Number(invoice?.subtotal || 0) + Number(invoice?.total_tax || 0)) * 100) / 100`
   - `invoiceGross = rawTotal > 0 ? rawTotal : derivedGross`  
   So: if `invoice.total` is present and > 0, use it; otherwise use rounded `subtotal + total_tax`. If invoice is null (e.g. fetch failed), all of these are 0.

2. **totalPaid**
   - From `existingPayments`: `payments` where `invoice_id = existingCreditNote.invoice_id` and `deleted_at IS NULL`.
   - No status filter (table has no status column).
   - `totalPaid = (existingPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)`

3. **totalCredits**
   - From `existingCredits`: `credit_notes` where `invoice_id = existingCreditNote.invoice_id`, `status = 'applied'`, `deleted_at IS NULL`.
   - Then in JS: `.filter((c) => c.id !== creditNoteId)` so the **current** credit note is excluded.
   - `totalCredits = (existingCredits ?? []).filter(...).reduce((sum, c) => sum + Number(c.total), 0)`

4. **Outstanding (cents → currency)**
   - `invoiceCents = Math.round(invoiceGross * 100)`
   - `paidCents = Math.round(totalPaid * 100)`
   - `creditsCents = Math.round(totalCredits * 100)`
   - `outstandingCents = Math.max(0, invoiceCents - paidCents - creditsCents)`
   - `outstanding = outstandingCents / 100`

5. **Credit amount**
   - `creditAmount = Number(creditNote?.total ?? 0)`
   - `creditRounded = Math.round(creditAmount * 100) / 100`

6. **Reject condition**
   - `TOLERANCE = 0.01`
   - Reject when `creditNote && creditRounded > outstanding + TOLERANCE`  
   So reject only if credit is **more than 0.01** above outstanding.

**Proof that updated logic (cents + tolerance) is present:**

- Cents-based math: lines 211–216 (`Math.round(...* 100)`, `outstandingCents`, `outstanding = outstandingCents / 100`).
- Tolerance: line 220 `const TOLERANCE = 0.01`, line 221 `creditRounded > outstanding + TOLERANCE`.

So the **running code path** in this file uses the intended formula and tolerance. If the app still throws, either a stale build is serving an older bundle, or the **data** entering this formula makes `creditRounded > outstanding + 0.01` true (see §4).

---

## 4. Concrete mismatch causing `credit > outstanding`

The rejection happens when:

`creditRounded > outstanding + 0.01`

So we need **outstanding** to be **low** (or **credit** high). With the current formula, that occurs in these cases:

### 4.1 Invoice gross is 0 or far too low (primary)

- **How:**  
  - `rawTotal = Number(invoice?.total || 0)` and `invoiceGross = rawTotal > 0 ? rawTotal : derivedGross`.  
  - If **invoice fetch fails** (e.g. RLS, not found, network), `invoice` is null: then `rawTotal = 0`, `derivedGross = 0`, so **invoiceGross = 0**.  
  - If **invoice.total** is 0 or null in DB and **subtotal + total_tax** is 0 or wrong, again **invoiceGross = 0** (or very small).

- **Effect:**  
  - `invoiceCents = 0` (or small), so `outstandingCents = 0` (or small) and **outstanding = 0** (or tiny).  
  - Any positive **creditRounded** (e.g. 500) then satisfies `creditRounded > outstanding + 0.01` → **reject**.

- **Proof (snippets):**

```ts
// No check for invoice fetch error; invoice can be null
const { data: invoice } = await supabase
  .from("invoices")
  .select("total, subtotal, total_tax")
  .eq("id", existingCreditNote.invoice_id)
  .single()

const rawTotal = Number(invoice?.total || 0)           // 0 if invoice null
const derivedGross = Math.round((Number(invoice?.subtotal || 0) + Number(invoice?.total_tax || 0)) * 100) / 100  // 0 if null
const invoiceGross = rawTotal > 0 ? rawTotal : derivedGross  // 0
// → outstanding = 0 → any positive credit fails
```

So: **wrong or missing invoice total (including failed invoice fetch) → outstanding = 0 → "Credit note amount exceeds invoice balance".**

### 4.2 Stale build (no tolerance / no cents)

- If the **deployed or dev bundle** is an older version of the route (strict `creditRounded > remainingRounded` and float math), the same user scenario can still reject due to rounding.  
- **Proof:** The **only** route that returns this exact message is this file; the **current** file on disk has cents + tolerance. So if the error persists, either the build is stale or the data path in §4.1 applies.

### 4.3 Overcount of credits (theoretical)

- If **totalCredits** were too high, outstanding would be too low and we could reject.  
- Current logic: **current CN is excluded** by `.filter((c) => c.id !== creditNoteId)`. The current CN is not yet applied, so it is not in `existingCredits` (status = 'applied'). So we do not double-count the current CN.  
- Overcount would require either duplicate rows for other credit notes or a bug in the filter (e.g. id type mismatch). Not observed in code; RLS could only add visibility of **more** rows; if anything, that would overcount credits and understate outstanding, consistent with §4.1.

### 4.4 credit_notes.total type / NaN

- `creditAmount = Number(creditNote?.total ?? 0)`. If `total` is a string or null, Number() still yields a number; if it’s invalid, we get NaN.  
- For **reject** we need `creditRounded > outstanding + 0.01`. If `creditRounded` is NaN, the comparison is false in JS, so we would not reject. So **reject** is not caused by NaN on the credit side.  
- So the main data cause remains **invoiceGross = 0** (or too low) and thus **outstanding = 0** (or too low).

---

## 5. Proof snippets and query filters

**UI call:**

```ts
// app/credit-notes/[id]/view/page.tsx lines 94–98
const response = await fetch(`/api/credit-notes/${id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "applied" }),
})
```

**Error thrown only here:**

```ts
// app/api/credit-notes/[id]/route.ts lines 231–234
return NextResponse.json(
  { error: "Credit note amount exceeds invoice balance" },
  { status: 400 }
)
```

**Invoice query (no error handling):**

```ts
const { data: invoice } = await supabase
  .from("invoices")
  .select("total, subtotal, total_tax")
  .eq("id", existingCreditNote.invoice_id)
  .single()
```

**Payments query:**

```ts
.eq("invoice_id", existingCreditNote.invoice_id)
.is("deleted_at", null)
// No status filter; table has no status column
```

**Credit notes query (other applied only; current excluded in JS):**

```ts
.eq("invoice_id", existingCreditNote.invoice_id)
.eq("status", "applied")
.is("deleted_at", null)
// Then: .filter((c) => c.id !== creditNoteId)
```

**Outstanding and reject condition:**

```ts
const outstandingCents = Math.max(0, invoiceCents - paidCents - creditsCents)
const outstanding = outstandingCents / 100
const TOLERANCE = 0.01
if (creditNote && creditRounded > outstanding + TOLERANCE) { ... reject ... }
```

---

## 6. RLS / visibility (concise)

- **API client:** `createSupabaseServerClient()` uses anon key + user cookies; RLS applies.
- **payments:** Migration 157 — SELECT allowed only if `EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = payments.business_id AND bu.user_id = auth.uid())`. So the API sees only payments for businesses the user is a member of. That can **reduce** visible payments (undercount totalPaid) → **higher** outstanding → **allow** more credit, not reject. So RLS on payments is not the cause of a false reject.
- **credit_notes / invoices:** 051 adds `allow_all_select_*` for several tables including `credit_notes`; 157 does not override credit_notes or invoices in the searched migrations. So visibility for credit_notes/invoices may be permissive. If the **invoice** row were not visible (e.g. stricter RLS elsewhere), the invoice fetch would return null → invoiceGross = 0 → outstanding = 0 → reject. So **invoice not visible (or fetch error) is consistent with the concrete mismatch in §4.1.**

---

## 7. Summary table

| Item | Finding |
|------|--------|
| **Exact error source** | `app/api/credit-notes/[id]/route.ts` line 233 only. |
| **Endpoint UI calls** | `PUT /api/credit-notes/${id}` with `{ status: "applied" }`. |
| **Cents + tolerance in code** | Present (lines 211–216, 220–221). |
| **Cause of credit > outstanding** | **invoiceGross = 0** (or too low): failed invoice fetch, or `invoice.total` 0/null and derived gross 0/wrong → outstanding = 0 → any positive credit triggers reject. |
| **RLS** | Payments: business-scoped (reduces visibility → undercount payments → allows more credit). Invoice null/fail (e.g. RLS or missing row) → outstanding = 0 → reject. |

**Recommended next step (no fix in this audit):** In the throwing route, add a guard when the invoice fetch fails or when `invoiceGross === 0` and the credit note total is positive: either return a distinct error (e.g. "Invoice not found or invoice total is zero") or ensure invoice is loaded and total is correct before computing outstanding. Also verify at runtime (logs or debugger) the values of `invoice`, `invoiceGross`, `totalPaid`, `totalCredits`, `outstanding`, and `creditRounded` when the error occurs.

---

*End of runtime audit. No code was changed.*
