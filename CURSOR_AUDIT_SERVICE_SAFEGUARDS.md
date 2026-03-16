# Cursor Audit — Service Safeguards Sanity Pass (Read-Only)

**Scope:** Service workspace. Evidence-based; file path + line numbers + snippets (max ~8 lines).  
**Constraints:** READ-ONLY. No code changes.

---

## Step 1 — Accounting period bootstrap call sites

| Call site | File:line | Who calls it | Gate/industry check | Notes |
|-----------|-----------|--------------|----------------------|-------|
| `initialize_business_accounting_period` (RPC) | `app/api/onboarding/retail/finalize/route.ts` **197** | Retail onboarding finalize POST | **Retail-only:** `if (business.industry !== "retail")` → 400 at **50–55** | Only app call. Service never hits this route. |
| `ensure_accounting_period(p_business_id, p_date)` | `supabase/migrations/094_accounting_periods.sql` **59–93** | DB only: used inside `assert_accounting_period_is_open` (094:107, 166:114, 165:31) | N/A (no industry in DB) | Finds or creates period for date; never called from app. |
| `ensure_accounting_period` | `supabase/migrations/166_controlled_adjustments_soft_closed.sql` **114** | `assert_accounting_period_is_open` body | N/A | `SELECT * FROM ensure_accounting_period(p_business_id, p_date)` |
| `INSERT INTO accounting_periods` | `supabase/migrations/094_accounting_periods.sql` **86** | Inside `ensure_accounting_period` | N/A | `INSERT INTO accounting_periods (business_id, period_start, period_end, status) VALUES (...)` |
| `INSERT INTO accounting_periods` | `supabase/migrations/177_retail_accounting_period_initialization.sql` **78** | Inside `initialize_business_accounting_period` | N/A | Creates one period when business has none; invoked only by retail finalize. |

**App-level period creation:** Only `app/api/onboarding/retail/finalize/route.ts` calls `initialize_business_accounting_period`, and that route returns 400 for non-retail at **50–55**:

```ts
// app/api/onboarding/retail/finalize/route.ts 50-55
    // Verify business is Retail
    if (business.industry !== "retail") {
      return NextResponse.json(
        { error: "Invalid business type: This endpoint is for Retail businesses only" },
        { status: 400 }
      )
```

`app/api/accounting/periods/route.ts` **47–52**: only **reads** `accounting_periods` (`.select("*")`); no insert, no RPC to bootstrap. No `/api/service/` routes exist; no other app path creates periods for service.

---

## Step 2 — Payments write paths and pre-insert guards

| Entry point | File:line | Writes payments? | Checks period open? | Checks invoice posted? | Notes |
|-------------|-----------|------------------|---------------------|------------------------|-------|
| POST /api/payments/create | `app/api/payments/create/route.ts` **184–199** | Yes: `.from("payments").insert({...})` | **No** | **No** | Validates invoice exists, amount > 0, amount ≤ remaining; no period or JE check. |
| POST /api/invoices/[id]/mark-paid | `app/api/invoices/[id]/mark-paid/route.ts` **96–110** | Yes: `.from("payments").insert({...})` | **No** | **No** | Same: no period open, no “invoice has JE” check. |
| DB trigger → post_payment_to_ledger | `supabase/migrations/043_accounting_core.sql` **965** | N/A (trigger invokes posting) | **No** | **No** | `PERFORM post_payment_to_ledger(NEW.id);` — trigger runs on INSERT. |
| post_invoice_payment_to_ledger | `supabase/migrations/190_fix_posting_source_default_bug.sql` **998–1122** | Writes JEs | **No** | **No** | No `assert_accounting_period_is_open`. Goes from `business_id_val := payment_record.business_id` (1045) to COA guards then `post_journal_entry` (1089). |

**Snippet — payment create insert (no period/JE check):**

```ts
// app/api/payments/create/route.ts 184-199
    // Create payment
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        business_id,
        invoice_id,
        amount: Number(amount),
        date,
        method,
        ...
      })
```

**Snippet — post_invoice_payment_to_ledger has no period assert:**  
190 uses `assert_accounting_period_is_open` only in `post_invoice_to_ledger` (399), `post_bill_to_ledger` (568), `post_expense_to_ledger` (735), `post_credit_note_to_ledger` (1321). **Not** in `post_invoice_payment_to_ledger` (998–1122).

**Conclusion:** No application route checks “accounting period open” or “invoice has journal entry” before inserting a payment. No guard in payment posting function.

---

## Step 3 — Report blocking and alternate report endpoints

| Endpoint / symbol | File:line | Calls P&L/BS RPC? | Role check | Reachable from service without workspace switch? |
|-------------------|-----------|--------------------|------------|--------------------------------------------------|
| GET /api/reports/profit-loss | `app/api/reports/profit-loss/route.ts` **5–14** | **Blocked:** returns 410 before any logic | N/A | Yes (service sidebar can point here), but returns **410** |
| GET /api/reports/balance-sheet | `app/api/reports/balance-sheet/route.ts` **5–14** | **Blocked:** same | N/A | Yes, returns **410** |
| GET /api/reports/trial-balance | `app/api/reports/trial-balance/route.ts` **9** | **Blocked:** `code: "LEDGER_READ_BLOCKED"` | N/A | Same |
| GET /api/accounting/reports/profit-and-loss | `app/api/accounting/reports/profit-and-loss/route.ts` **45–59, 89** | Yes: `get_profit_and_loss_from_trial_balance` | **Yes:** `getUserRole` / `isUserAccountantReadonly`; allow admin/owner/accountant(**49–59**) | Only via accounting UI / URL; owner allowed. |
| GET /api/accounting/reports/balance-sheet | `app/api/accounting/reports/balance-sheet/route.ts` **73–79, 87** | Yes: `get_balance_sheet_from_trial_balance` | Same | Same |
| /api/service/… profit or balance | — | **N/A** | — | **None:** `app/api/service/` does not exist. |

**Snippet — operational P&L 410:**

```ts
// app/api/reports/profit-loss/route.ts 5-14
export async function GET(request: NextRequest) {
  // INVARIANT 2: Block ledger reads from operational Financial Reports
  return NextResponse.json(
    {
      code: "LEDGER_READ_BLOCKED",
      error: "This report uses ledger data. Use accounting workspace reports.",
      canonical_alternative: "/api/accounting/reports/profit-and-loss",
    },
    { status: 410 }
  )
```

**Snippet — accounting P&L role check and RPC:**

```ts
// app/api/accounting/reports/profit-and-loss/route.ts 45-53, 89
    const userRole = await getUserRole(supabase, user.id, businessId)
    ...
    const hasAccess = 
      userRole === "admin" || 
      userRole === "owner" ||
      userRole === "accountant" ||
      isReadonlyAccountant
    ...
    const { data: pnlData, error: rpcError } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
      p_period_id: period.id,
    })
```

**Conclusion:** No unblocked P&L/BS endpoint for “service-only” usage. Operational routes return 410; the only live P&L/BS calls are under `/api/accounting/reports/` with role checks. Service can use those only by navigating to accounting routes (no `/api/service/reports/`).

---

## Step 4 — Invoice number assignment: convert → send flow

| Location | File:line | When invoice_number is set | Can status=sent exist without number? |
|----------|-----------|----------------------------|----------------------------------------|
| Send (WhatsApp) | `app/api/invoices/[id]/send/route.ts` **151–170** | Before update: if `!invoice.invoice_number` then RPC `generate_invoice_number_with_settings`, set `updateData.invoice_number`; else 500 | **No** — 500 if RPC returns nothing. |
| Send (Email) | `app/api/invoices/[id]/send/route.ts` **266–271, 362–370** | Same pattern: generate when missing, fail if null | **No** |
| Convert order→invoice | `app/api/orders/[id]/convert-to-invoice/route.ts` **405–422, 430, 461–463** | When `body.status === "sent"`: generate before insert, `finalInvoiceNumber = invoiceNumData`; insert uses `invoice_number: finalInvoiceNumber` and `status: "sent"` | **No** — 500 if generate fails. |
| PATCH invoice | `app/api/invoices/[id]/route.ts` **445–455, 461–464** | When `status === "sent"` and draft and `!existingInvoice.invoice_number`: generate; else reject sent without number | **No** |
| Create invoice | `app/api/invoices/create/route.ts` **77–79** | When `status === "sent"`: generate before insert | **No** |
| Recurring generate | `app/api/recurring-invoices/generate/route.ts` **77–85, 166–176** | When `willBeSent` (auto_send): call RPC; if `!invoiceNumber` only `console.error`, still inserts with `status: "sent"` and `invoice_number: invoiceNumber` (can be null) | **Yes** |

**Snippet — recurring generate can set status=sent with null invoice_number:**

```ts
// app/api/recurring-invoices/generate/route.ts 77-85
    if (willBeSent) {
      const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
        business_uuid: business.id,
      })
      invoiceNumber = invoiceNumData || null
      if (!invoiceNumber) {
        console.error("Failed to generate invoice number for recurring invoice")
      }
    }
// ... later ...
// 166-176
        invoice_number: invoiceNumber,   // can be null
        ...
        status: recurringInvoice.auto_send ? "sent" : "draft",
```

So when `auto_send` is true and the RPC returns null, the insert is still performed with `status: "sent"` and `invoice_number: null`. No return/abort.

**Snippet — send route enforces number before sent:**

```ts
// app/api/invoices/[id]/send/route.ts 156-170
      if (!invoice.invoice_number) {
        const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", ...)
        if (invoiceNumData) {
          updateData.invoice_number = invoiceNumData
        } else {
          return NextResponse.json(
            { success: false, error: "Failed to generate invoice number. Cannot send invoice without invoice number.", ... },
            { status: 500 }
          )
        }
      }
```

**Snippet — convert when status=sent:**

```ts
// app/api/orders/[id]/convert-to-invoice/route.ts 405-421, 430, 461-462
    if (invoiceStatus === "sent") {
      const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", ...)
      if (!invoiceNumData) {
        return NextResponse.json(
          { error: "Failed to generate invoice number. Cannot create sent invoice without invoice number.", code: "GENERATE_NUMBER_FAILED" },
          { status: 500 }
        )
      }
      finalInvoiceNumber = invoiceNumData
    }
    ...
    invoice_number: finalInvoiceNumber,
    ...
    if (invoiceStatus === "sent") {
      invoiceData.status = "sent"
```

---

## Final deliverable

### YES/NO claims

| Claim | Answer | Evidence |
|-------|--------|----------|
| **C1:** “Service can auto-create accounting periods somewhere outside retail finalize” | **NO** | Only app call to `initialize_business_accounting_period` is `app/api/onboarding/retail/finalize/route.ts` **197**, behind `if (business.industry !== "retail")` at **50–55**. `app/api/accounting/periods/route.ts` only reads periods (**47–52**). No `/api/service/` and no other route inserts or RPCs period bootstrap for service. |
| **C2:** “Service has any guard preventing payment posting when invoice posting fails” | **NO** | Payment inserts: `app/api/payments/create/route.ts` **184–199**, `app/api/invoices/[id]/mark-paid/route.ts` **96–110`. Neither checks period open nor “invoice has JE”. `post_invoice_payment_to_ledger` (190:**998–1122**) has no `assert_accounting_period_is_open`; trigger (043:**965**) unconditionally calls `post_payment_to_ledger` on payment INSERT. |
| **C3:** “Service has any unblocked P&L/BS endpoint besides accounting workspace routes” | **NO** | `/api/reports/profit-loss` and `/api/reports/balance-sheet` return **410** at **5–14** (`LEDGER_READ_BLOCKED`). Only endpoints that call `get_profit_and_loss_from_trial_balance` / `get_balance_sheet_from_trial_balance` are under `/api/accounting/reports/` (**profit-and-loss/route.ts** **89**, **balance-sheet/route.ts** **87**), with role checks. No `app/api/service/` directory. |
| **C4:** “Any path can set invoice status=sent without ensuring invoice_number” | **YES** | **Recurring-invoices generate:** `app/api/recurring-invoices/generate/route.ts` **77–85**: when `willBeSent` (auto_send) and RPC returns null, only `console.error`; **166–176**: insert uses `invoice_number: invoiceNumber` (null) and `status: recurringInvoice.auto_send ? "sent" : "draft"`. So status can be sent with null invoice_number. |

### Evidence for each NO (strongest 5–10 snippets)

**C1 (NO):**

1. `app/api/onboarding/retail/finalize/route.ts` **50–55** — industry check, 400 for non-retail.
2. `app/api/onboarding/retail/finalize/route.ts` **197** — only app call to `initialize_business_accounting_period`.
3. `app/api/accounting/periods/route.ts` **47–52** — `.from("accounting_periods").select("*")` only; no insert/RPC.
4. No `app/api/service/` — directory does not exist.
5. `app/business-setup/page.tsx` **76–86** — inserts business only; redirect to `/onboarding`; no period API.

**C2 (NO):**

1. `supabase/migrations/190_fix_posting_source_default_bug.sql` **998–1048** — `post_invoice_payment_to_ledger` from `business_id_val` to COA guards; no `assert_accounting_period_is_open` (same file uses it at 399, 568, 735, 1321 for other posting functions only).
2. `app/api/payments/create/route.ts` **121–170** — validations are invoice exists, amount, remaining balance; **184–199** — insert payments; no period or JE check.
3. `app/api/invoices/[id]/mark-paid/route.ts` **96–110** — insert payments; **120–123** — comment that trigger posts; no pre-insert guard.
4. `supabase/migrations/043_accounting_core.sql` **955–965** — `trigger_post_payment` runs on INSERT and calls `post_payment_to_ledger(NEW.id)` with no conditional guard.

**C3 (NO):**

1. `app/api/reports/profit-loss/route.ts` **5–14** — unconditional return 410 with `code: "LEDGER_READ_BLOCKED"`.
2. `app/api/reports/balance-sheet/route.ts` **5–14** — same.
3. `app/api/accounting/reports/profit-and-loss/route.ts` **45–59, 89** — role check then `get_profit_and_loss_from_trial_balance`.
4. `app/api/accounting/reports/balance-sheet/route.ts` **73–79, 87** — period lookup then `get_balance_sheet_from_trial_balance`.
5. No `app/api/service/` and no other route calling those RPCs for service-only use.

### Evidence for C4 (YES)

**Path that can set status=sent without ensuring invoice_number:**

- **File:line:** `app/api/recurring-invoices/generate/route.ts` **77–85**, **166**, **176**.
- **Snippet (77–85):** When `willBeSent`, RPC is called; `invoiceNumber = invoiceNumData || null`; if `!invoiceNumber` only `console.error("Failed to generate invoice number for recurring invoice")` — no return.
- **Snippet (166, 176):** Insert uses `invoice_number: invoiceNumber` and `status: recurringInvoice.auto_send ? "sent" : "draft"`, so with auto_send and failed generation, sent is stored with null invoice_number.

---

**Document:** `CURSOR_AUDIT_SERVICE_SAFEGUARDS.md`  
**Scope:** Service workspace safeguards sanity pass. Read-only, evidence-based.
