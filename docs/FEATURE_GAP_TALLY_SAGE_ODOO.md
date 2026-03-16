# Feature Gap: Finza Service + Accountant-First vs Tally, Sage, Odoo

**Purpose:** Realistic list of features that Tally, Sage, and Odoo offer which Finza (Service workspace + Accountant-first workspace) currently lacks or does only partially.  
**Sources:** Official product pages and docs for TallyPrime, Sage Accounting/Intacct, Odoo Accounting; Finza codebase and docs.

---

## 1. Banking & Reconciliation

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **Automated bank feeds** | Import statements → vouchers | Automatic import, rule-based matching | Bank sync, auto-import | ❌ **Manual CSV import only** (`reconciliation/[accountId]/import`) |
| **Smart matching / suggestions** | — | Rule-based matching | ~95% auto-match, learning on first manual match | ✅ Auto-match exists; no “learning” or rule templates |
| **Batch bank reconciliation** | — | — | Batch payments, SEPA | ❌ No batch payment runs or SEPA-style flows |

**Gap (realistic):**  
- **Automated bank feeds:** No live/API connection to banks; users must upload CSV. Adding a single Open Banking or aggregator (e.g. TrueLayer, Plaid, or local provider) would close the biggest gap.  
- **Reconciliation rules:** No user-defined rules (e.g. “match by reference + amount”) or learned account mapping to reduce manual work.

---

## 2. Multi-Currency & FX

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **Multi-currency invoices/payments** | Yes, auto forex gain/loss | Yes | Yes, daily rates | ❌ **Explicitly not supported** (FX removed end-to-end) |
| **FX gain/loss automation** | Yes | — | — | ❌ |
| **Multiple price lists by currency** | Yes | — | — | ❌ |

**Gap (realistic):**  
- Codebase states: *“Foreign currency fields removed - FX not fully supported end-to-end”* (e.g. `PaymentModal.tsx`, `sales/create/route.ts`).  
- **Realistic add:** Multi-currency on invoices/bills with stored exchange rate and single reporting currency (no need for full multi-entity FX consolidation at first).

---

## 3. Invoicing & Receivables

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **Payment links / QR on invoice** | Yes | Click-to-pay | Customer portal, QR, gateways | ✅ Public invoice + pay page |
| **Automated follow-ups (AR)** | — | — | Follow-up emails, letters, SMS, tasks | ❌ No automated dunning or reminder sequences |
| **Credit limit / AR alerts** | — | — | Sales credit limit alerts | ❌ No credit limit or “over limit” warnings |
| **Draft from SO/delivery/timesheet** | — | — | Auto draft from SO, timesheets, etc. | ✅ Estimates → convert to invoice; no timesheet/project → invoice |
| **AI invoice digitization** | — | AI invoice automation | Scan PDF/image → encode | ⚠️ **Receipt OCR only** (expenses/bills); no supplier invoice PDF digitization |

**Gap (realistic):**  
- **Automated AR follow-ups:** No scheduled reminders or multi-step dunning (email/SMS) from aged receivables. High impact for service businesses.  
- **AI invoice capture:** Receipt OCR exists (`/api/receipt-ocr`, expense/bill create); no “upload supplier invoice PDF → suggest bill lines” as in Odoo.  
- **Credit limits:** Optional; useful if you add more B2B/credit terms.

---

## 4. Payables & Payments

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **Batch / run payments** | — | — | Batch payments, SEPA CT, check batches | ❌ One-by-one bill payment only |
| **SEPA / direct debit** | — | — | SEPA CT, direct debit mandates | ❌ |
| **Payment suggestions (“bills to pay”)** | — | — | Suggested bills to pay, print checks | ❌ No “pay run” or suggested list |
| **Print checks** | — | — | Batch print checks | ❌ |

**Gap (realistic):**  
- **Batch pay run:** “Select multiple bills → one payment run” (and optionally one bank file export) would match Odoo/Sage-style workflows.  
- SEPA/check printing is jurisdiction-specific; lower priority unless targeting those markets.

---

## 5. Reporting & Analytics

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **P&L, Balance Sheet, TB, GL** | Yes | Yes | Yes | ✅ Accounting + Service reports |
| **Cash flow statement** | Yes (reports) | Cash flow forecasting | Yes | ❌ No cash flow statement report; Service v2 has “cash movement” in chart only |
| **Cash flow forecasting** | — | Yes, visual dashboards | — | ❌ No forward-looking cash forecast |
| **Aged receivables/payables** | — | — | Yes | ✅ Aging in reports/outstanding |
| **400+ / custom reports** | Tally 400+ | Customizable | Dynamic, multi-period | ⚠️ Fixed set; no report builder |
| **Multi-period comparison** | — | — | Up to 12 periods | ⚠️ Period selector only; no side-by-side N periods |
| **Export reports (Excel/PDF)** | — | — | Yes | ⚠️ Export from accounting workspace; Service report export UI gap noted in audit |

**Gap (realistic):**  
- **Cash flow statement:** Standard third statement (operating/investing/financing) is missing; only cash movement in Service dashboard chart.  
- **Cash flow forecasting:** No projected cash (e.g. from AR/AP dates). High value for small businesses.  
- **Report export for Service:** Docs note Service owners can call export APIs but lack export buttons on report pages; add export on `/reports/*` and `/service/reports/*`.  
- **Multi-period comparison:** E.g. P&L this month vs last 3 months in one view.

---

## 6. Tax & Compliance

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **GST/VAT returns** | GST, e-invoice, e-Way | VAT return submission (e.g. HMRC) | Tax reports, cash basis, audit trail | ✅ VAT returns; country-specific (e.g. Ghana) |
| **E-invoice / e-Way** | Yes | — | — | ❌ No e-invoice/IRN/QR (e.g. India) |
| **Tax audit report (line drill-down)** | — | — | Click line → see computation | ❌ No tax audit report |
| **Cash basis tax** | — | — | Yes | ❌ Not explicit |
| **Fiscal localization packages** | — | — | Country COA, taxes, statements | ⚠️ Single market focus; no “country pack” model |

**Gap (realistic):**  
- **Tax audit report:** “How was this VAT/tax number computed?” with drill-down from report line to transactions (Odoo-style).  
- **E-invoice / e-Way:** Only relevant if targeting India (or similar) compliance.  
- **Cash basis tax:** Optional; matters for some jurisdictions.

---

## 7. Analytic / Cost Accounting

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **Cost centers / departments** | — | — | Analytic accounts, hierarchies | ❌ No analytic dimensions |
| **Project/department on invoice lines** | — | — | Analytic distribution on invoice/bill | ❌ |
| **Budget vs actual** | — | — | Budget management, compare to actual | ❌ No budgets |
| **Multi-dimensional analytics** | — | — | Multiple plans, sub-plans | ❌ |

**Gap (realistic):**  
- **Analytic accounting:** No project/department/cost center on transactions or in reports. Important for firms and larger service businesses that need P&L by project or department.  
- **Budget vs actual:** Optional; useful for practice management and planning.

---

## 8. Assets & Deferred Revenue/Expense

| Feature | Tally | Sage | Odoo | Finza |
|--------|--------|------|------|--------|
| **Fixed assets & depreciation** | — | — | Assets, depreciation, amortization entries | ✅ Assets module exists (`/assets`) |
| **Deferred revenue / expense** | — | — | Multi-year contracts, cut-off, auto entries | ❌ No deferred revenue/expense or cut-off |
| **Revenue recognition over time** | — | — | Recurring revenue/expense automation | ⚠️ Revenue on issue (documented); no schedule-based recognition |

**Gap (realistic):**  
- **Deferred revenue/expense:** No split of income/expense across periods (e.g. annual subscription).  
- **Revenue recognition schedules:** No “recognize X per month” from a contract; would complement recurring invoices.

---

## 9. Practice / Accountant-First Workspace

| Feature | Tally | Sage (Intacct) | Odoo | Finza |
|--------|--------|-----------------|------|--------|
| **Multi-entity / multi-client** | Multi-company | Multi-entity, consolidation | Multi-company, one subscription | ✅ Firm → clients, engagements |
| **Client portal (view/pay/upload)** | — | — | Customer portal (invoices, pay, docs) | ✅ Portal accounting (P&L, BS, TB, GL); public invoice/receipt |
| **Inter-entity transactions** | — | Yes (loans, bill-on-behalf, etc.) | Intercompany rules | ❌ No inter-entity |
| **Entity-level access control** | — | Yes | Yes | ✅ Engagement access (read/write/approve) |
| **Consolidation (multi-currency)** | — | Global Consolidations add-on | Real-time consolidation | ❌ Single-entity reporting per client |
| **Document request / client upload** | — | — | Portal upload, file requests | ❌ No structured “request documents from client” |
| **Practice workflow (tasks, deadlines)** | — | — | Tasks, approvals | ⚠️ Exceptions/adjustments; no generic task/job management |
| **Scheduling / client appointments** | — | — | — | ❌ No client self-scheduling or booking |

**Gap (realistic):**  
- **Client document request:** “Request Q3 bank statements” with due date and reminder; client uploads in portal. Aligns with practice management tools (Karbon, etc.).  
- **Inter-entity:** Only if you add multi-entity under one firm (e.g. group companies).  
- **Consolidation:** Only needed for firms that report consolidated group accounts.  
- **Scheduling:** Optional; some practice tools offer client self-booking.

---

## 10. Service Business (SMB) Quick Wins

| Feature | Finza status | Priority note |
|--------|----------------|--------------|
| **Export reports from Service** | API exists; no export buttons on Service report pages | High (audit already flagged) |
| **Cash flow statement** | Missing | High |
| **Cash flow forecast** | Missing | High (Sage/Odoo differentiator) |
| **Automated AR reminders** | Missing | High |
| **Multi-currency (invoices + FX)** | Disabled | Medium (if targeting international) |
| **Batch bill payment run** | Missing | Medium |
| **AI supplier invoice (PDF → bill)** | Only receipt OCR | Medium |
| **Tax audit report (drill-down)** | Missing | Medium (compliance) |
| **Analytic dimensions (project/dept)** | Missing | Medium for firms / larger SMBs |
| **Credit limit alerts** | Missing | Low |
| **Deferred revenue/expense** | Missing | Low unless subscription/contract focus |

---

## Where Finza Has an Advantage

Features where Finza is stronger or differentiated vs Tally, Sage, and Odoo:

| Area | Finza advantage | vs others |
|------|-----------------|-----------|
| **Single product: SMB + accountant** | One platform: Service workspace (invoices, expenses, bills, reports) and Accounting workspace (firm, periods, ledger, adjustments) with firm→client engagements. Same app for the business owner and the accountant. | Tally: desktop SMB; Sage: separate products (Accounting vs Intacct); Odoo: modular, not built as “practice + client books” in one. |
| **Single ledger, no duplicate books** | Client’s ledger is the only source of truth. Firm has access via engagement; no separate “firm copy” of client books. Reports (P&L, BS, TB, GL) are always ledger-derived. | Some practice tools keep a duplicate or synced copy of client data; Finza avoids that. |
| **Strict revenue recognition** | Revenue posts only on invoice **issue**; draft invoices cannot post; payments do not post revenue. Enforced in DB (e.g. migration 253) and tested. | Many SMB tools are looser; Finza has a clear adoption boundary and audit trail. |
| **Engagement-based access** | Firm→client access via engagements (read / write / approve), effective dates, and RLS. Recent migrations (277–279) harden lifecycle and period/ledger visibility per engagement. | Granular, time-bound access without per-entity licensing complexity in one product. |
| **Client sees same numbers as firm** | Service owner sees P&L, BS, TB, GL from the same APIs and trial balance as the firm. Portal accounting gives clients a read-only view of their own books. | No “owner view” vs “accountant view” data split; one source. |
| **Reconciliation for owners** | Service owners can use `/accounting/reconciliation` (bank rec) for their own business; firm users can do it for engaged clients. Same reconciliation flow and import (CSV). | Not all SMB products expose reconciliation to the business owner; Finza does within one product. |
| **Receipt OCR (expenses/bills)** | Receipt OCR for expense and supplier bill entry (`/api/receipt-ocr`), with Africa-ready parsing and suggestion-only flow. | Tally/Sage don’t emphasize receipt OCR; Odoo has invoice digitization but Finza already has receipt path. |
| **Export-safe / print-safe UI** | Export mode hides nav/sidebar for clean PDF and print (invoices, etc.) via `export-hide` / `print-hide` and `data-export-mode`. | Deliberate design for client-facing documents. |
| **Forensic and integrity checks** | Forensic accounting script, invariant checks, draft-invoice and payment guards (e.g. no payment on draft invoice), and design for nightly verification and alerting. | Strong focus on ledger integrity and detectability of errors. |
| **Local / Ghana-first** | Tax engine and VAT returns built for Ghana (NHIL, GETFund, etc.); country-gated reports and payment options. | Advantage in Ghana vs generic Tally/Sage/Odoo; can be extended to other locales. |
| **Retail + Service in one** | Same product: Service (invoices, expenses, bills) and Retail (POS, registers, inventory, stores). One business can have both flows; accounting posts from both. | Odoo is modular; Tally is strong in India; Finza combines service SMB and retail in one codebase with shared accounting. |
| **Estimates → invoice** | Estimates with one-click convert to invoice; preview draft invoice before saving. | Clear path from quote to invoice without re-entry. |
| **Public invoice + pay** | Token-based public invoice and receipt pages; dedicated pay page. Client can view and pay without logging in. | Same idea as Odoo/Sage; implemented and export-safe. |

---

## Summary: Top 5–7 Realistic Gaps to Address

1. **Automated bank feeds** (or at least rule-based matching on imported data) — biggest day-to-day pain vs Sage/Odoo.  
2. **Cash flow statement + simple cash flow forecast** — expected in modern accounting; Finza has neither.  
3. **Export from Service reports** — small change; already documented as missing in UI.  
4. **Automated AR follow-ups** — dunning/reminders from aged receivables.  
5. **Multi-currency (invoices + one reporting currency)** — codebase already prepared then disabled; re-enable with clear scope.  
6. **Batch pay run for bills** — select multiple bills → one run (and optional bank file).  
7. **AI supplier invoice capture** — extend receipt OCR to “PDF bill → suggest lines” for payables.

After that, **analytic/department/project** and **practice document request + workflow** would round out parity with Odoo/Sage for an accountant-first, service-business product.
