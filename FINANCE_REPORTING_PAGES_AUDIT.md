# Finance & Reporting Pages Audit

**Scope:** The “FINANCE & REPORTING” section in the sidebar (service workspace): **Profit & Loss**, **Balance Sheet**, **VAT Returns**, and **Financial Reports**. Focus on service-workspace behavior, data sources, and UX when reports are blocked or unsupported.

---

## 1. Profit & Loss (`/reports/profit-loss`)

**Sidebar:** “Profit & Loss” → `/reports/profit-loss`  
**Page:** `app/reports/profit-loss/page.tsx`  
**API:** `GET /api/reports/profit-loss` (operational route)

### Issues

1. **API is blocked (410)**  
   `app/api/reports/profit-loss/route.ts` returns **410** immediately with:
   - `code: "LEDGER_READ_BLOCKED"`
   - `error: "This report uses ledger data. Use accounting workspace reports."`
   - `canonical_alternative: "/api/accounting/reports/profit-and-loss"`

   So service users who open “Profit & Loss” from the sidebar never get data from this API.

2. **Page hides the real error and offers no next step**  
   On `!response.ok` the page throws a generic message and never reads the response body:

   ```ts
   if (!response.ok) {
     throw new Error("Failed to load Profit & Loss report")
   }
   ```

   So users see **“Failed to load Profit & Loss report”** instead of “This report uses ledger data. Use accounting workspace reports,” and there is no link or CTA to the accounting report.

3. **No redirect or link to canonical report**  
   The canonical, ledger-based report is at `/accounting/reports/profit-and-loss` and uses business + period. The operational page does not:
   - Parse the API body on error, or
   - Show the API message and a link/redirect to `/accounting/reports/profit-and-loss`

### Recommended fixes

- On non-OK response: `const err = await response.json().catch(() => ({}))`, then set error state from `err.error` (or fallback to the current message).
- If `err.code === "LEDGER_READ_BLOCKED"` (or status 410): show the API message and a clear CTA, e.g. “View Profit & Loss in Accounting” → `/accounting/reports/profit-and-loss`.
- Alternatively, in the **service** sidebar, point “Profit & Loss” to `/accounting/reports/profit-and-loss` instead of `/reports/profit-loss`, so service users go straight to the working report (and accounting UX handles business/period).

---

## 2. Balance Sheet (`/reports/balance-sheet`)

**Sidebar:** “Balance Sheet” → `/reports/balance-sheet`  
**Page:** `app/reports/balance-sheet/page.tsx`  
**API:** `GET /api/reports/balance-sheet` (operational route)

### Issues

1. **API is blocked (410)**  
   Same pattern as Profit & Loss: `app/api/reports/balance-sheet/route.ts` returns **410** with `LEDGER_READ_BLOCKED` and `canonical_alternative: "/api/accounting/reports/balance-sheet"`.

2. **Error message is shown, but no next step**  
   The page does read the API body on error:

   ```ts
   if (!response.ok) {
     const errorData = await response.json()
     throw new Error(errorData.error || "Failed to load balance sheet")
   }
   ```

   So users see **“This report uses ledger data. Use accounting workspace reports.”** — which is correct — but there is no link or button to open the accounting Balance Sheet.

3. **Canonical report exists but is not linked**  
   The working report lives at `/accounting/reports/balance-sheet`. The operational page does not reference it.

### Recommended fixes

- When status is 410 or `errorData.code === "LEDGER_READ_BLOCKED"`: keep showing `errorData.error` and add a CTA, e.g. “View Balance Sheet in Accounting” → `/accounting/reports/balance-sheet`.
- Or, for **service** only, change the sidebar to point “Balance Sheet” to `/accounting/reports/balance-sheet` so the link goes directly to the working report.

---

## 3. VAT Returns (`/vat-returns`)

**Sidebar:** “VAT Returns” → `/vat-returns`  
**Page:** `app/vat-returns/page.tsx`  
**API:** `GET /api/vat-returns/monthly`

### Issues

1. **Non-Ghana businesses get a misleading empty state**  
   `app/api/vat-returns/monthly/route.ts` returns **400** for non-Ghana businesses with:
   - `error: "Monthly VAT returns are not available for country {code}. Ghana VAT return structure (NHIL, GETFund, COVID, VAT) is only supported for Ghana businesses."`
   - `unsupported: true`

   The page does not read the body on `!response.ok`:

   ```ts
   if (!response.ok) {
     throw new Error(`HTTP error! status: ${response.status}`)
   }
   ```

   The catch then does `setMonthlyReturns([])` and the user sees the **“No VAT data found”** empty state, as if there were simply no data, instead of “VAT returns are not supported for your country.”

2. **No messaging when VAT is unsupported**  
   There is no branch that checks for `unsupported` or the API error text, so unsupported countries never see an explanation.

### Recommended fixes

- On `!response.ok`: `const data = await response.json().catch(() => ({}))`, then:
  - If `data.unsupported` or a 400 with that message: set a dedicated error/notice (e.g. “VAT returns are not available for your business country”) and optionally hide or disable “Create VAT return” and similar actions.
  - Otherwise keep current empty/error behavior as fallback.
- Optionally: in the sidebar or on the VAT page, only show or enable “VAT Returns” when the business country is Ghana (e.g. based on business profile), to avoid sending non-Ghana users into a dead end.

---

## 4. Financial Reports hub (`/reports`)

**Sidebar:** “Financial Reports” → `/reports`  
**Page:** `app/reports/page.tsx`

### Issues

1. **Hardcoded “GHS” for Revenue and Outstanding**  
   Total Revenue and Outstanding are rendered as:

   - `"GHS {stats.totalRevenue.toFixed(2)}"` (line 104)
   - `"GHS {stats.outstandingAmount.toFixed(2)}"` (line 111)

   So service businesses that are not Ghana or use another currency still see “GHS”.

2. **No entry points to Profit & Loss or Balance Sheet**  
   “Available Reports” only includes:
   - Sales History (retail only)
   - Invoice Reports → `/invoices`
   - VAT Returns → `/vat-returns`

   There are no cards or links for Profit & Loss or Balance Sheet. Users who land on `/reports` only see P&amp;L/BS if they use the sidebar; and those sidebar links go to the blocked operational pages (see §1 and §2).

3. **Stats source is operational, not ledger**  
   Stats are from `invoices` (total, status) with no accounting/ledger layer. That is consistent with an “operational” hub, but the sidebar labels this “Financial Reports” and also links to P&amp;L and Balance Sheet, which are ledger-only — so the hub does not clarify that P&amp;L/BS live in Accounting.

### Recommended fixes

- **Currency:** Use the business’s default currency (e.g. via `useBusinessCurrency` or `getCurrencySymbol(business.default_currency)`) for Total Revenue and Outstanding instead of “GHS”.
- **P&amp;L / Balance Sheet:** Either:
  - Add cards “Profit & Loss” and “Balance Sheet” that link to `/accounting/reports/profit-and-loss` and `/accounting/reports/balance-sheet`, with short copy that they are period-based ledger reports, or
  - Add a single “Accounting reports” card that links to `/accounting` or to the accounting reports index, and mention P&amp;L and Balance Sheet there.
- Keeps behavior consistent with the sidebar: those report links should target the accounting report pages, not the blocked operational APIs.

---

## 5. Sidebar: “FINANCE & REPORTING” (service)

**File:** `components/Sidebar.tsx` (service menu, lines 152–163)

Current links:

- “Profit & Loss” → `/reports/profit-loss` (blocked API; see §1)
- “Balance Sheet” → `/reports/balance-sheet` (blocked API; see §2)
- “VAT Returns” → `/vat-returns` (works for Ghana; for others, misleading empty state; see §3)
- “Financial Reports” → `/reports` (hub with GHS and no P&amp;L/BS entry points; see §4)

### Issue

For **service** users, “Profit & Loss” and “Balance Sheet” point at operational URLs whose APIs always return 410. So the two main “report” links in FINANCE & REPORTING do not work unless the user later finds the accounting reports themselves.

### Recommended approach

- **Option A (routing):** For **service** only, set:
  - “Profit & Loss” → `/accounting/reports/profit-and-loss`
  - “Balance Sheet” → `/accounting/reports/balance-sheet`  
  so the sidebar takes users straight to the working, period-based reports.
- **Option B (keep URLs, improve pages):** Leave sidebar as is, and on `/reports/profit-loss` and `/reports/balance-sheet` when the API returns 410, show the API message and a clear CTA (e.g. “Open in Accounting”) to `/accounting/reports/profit-and-loss` and `/accounting/reports/balance-sheet` respectively.

Option A is simpler for users (one click to a working report). Option B keeps “report” URLs under `/reports/` and uses them as a bridge to accounting.

---

## Summary

| Page / area        | Severity | Issue(s)                                                                 | Fix direction                                                                 |
|--------------------|----------|---------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| Profit & Loss      | High     | API 410 blocked; generic error; no link to accounting P&amp;L             | Show API message on error; add CTA to `/accounting/reports/profit-and-loss` or link sidebar there |
| Balance Sheet      | High     | API 410 blocked; error shown but no next step                             | Add CTA to `/accounting/reports/balance-sheet` or link sidebar there         |
| VAT Returns        | Medium   | Non-Ghana gets “No VAT data found” instead of “not supported”             | On 400/unsupported, show API error; optionally hide/disable for non-GH        |
| Financial Reports  | Medium   | GHS hardcoded; no links to P&amp;L/BS                                     | Use business currency; add links/cards to accounting P&amp;L/BS or accounting hub |
| Sidebar (service)  | High     | P&amp;L and Balance Sheet point at blocked operational reports           | Point at accounting report routes or ensure operational pages redirect/CTA   |

---

## Recommended order of changes

1. **Profit & Loss page**  
   On non-OK: parse body, set error from `err.error`; if 410 / `LEDGER_READ_BLOCKED`, add “View in Accounting” → `/accounting/reports/profit-and-loss`.

2. **Balance Sheet page**  
   When 410 / `LEDGER_READ_BLOCKED`: add “View in Accounting” → `/accounting/reports/balance-sheet` next to the existing error text.

3. **Sidebar (service)**  
   Set “Profit & Loss” and “Balance Sheet” to `/accounting/reports/profit-and-loss` and `/accounting/reports/balance-sheet` so service users reach working reports in one click (can be done in addition to or instead of 1–2).

4. **VAT Returns page**  
   On `!response.ok`: parse body; if `unsupported` or non-Ghana message, show that message and avoid “No VAT data found” for that case.

5. **Financial Reports hub**  
   Use business default currency for Revenue/Outstanding; add cards or a section linking to accounting Profit & Loss and Balance Sheet (or to the accounting reports index).
