# Service Workspace Freeze

**Status:** Document-only freeze. No enforcement in code in this deliverable.  
**Reference:** SERVICE_WORKSPACE_AUDIT.md (inventory, boundary checks, embedded reports).

---

## FREEZE NOTE

> **Service workspace is frozen.**  
> No new accounting logic, posting, or period behavior may be added here.  
> All accounting authority lives in Accounting workspace.

---

## 1. What Service Can Do

- **Operational data:** Create, read, update, delete **operational** entities used by the business: orders, customers, products & services, expenses, supplier bills, invoices, estimates, payments, credit notes, recurring invoices, VAT returns, staff, settings, etc., within existing APIs and RLS.
- **Read-only accounting data (embedded):**
  - Call **read-only** Accounting endpoints: `/api/accounting/periods/resolve`, `/api/accounting/reports/profit-and-loss`, `/api/accounting/reports/balance-sheet` with `context=embedded` (or equivalent) to display P&L and Balance Sheet.
  - Use `/api/ledger/list` for General Ledger **read-only** listing where that UI is exposed in Service.
- **Receipt OCR:** Call `/api/receipt-ocr` for suggestion-only pre-fill; no DB writes in that route.
- **Reconciliation (read/match):** Use reconciliation APIs for **read** and **match/unmatch** where exposed; **apply** of adjustments remains an accountant/Accounting path.
- **Navigation:** Show sidebar and routes defined for `industry === "service"` (SERVICE OPERATIONS, FINANCE & REPORTING, ACCOUNTING (Advanced), SETTINGS) without adding **new** accounting authority (posting, period close/reopen, manual journals).

---

## 2. What Service Must Never Do

- **Ledger writes from Service code:**  
  Must not insert, update, or delete `journal_entries` or `journal_entry_lines` from any **new** Service API or UI path.  
  (Existing expense INSERT triggering a DB-side post remains the only documented “Service-initiated” ledger write; no **new** such paths.)
- **Posting RPCs:**  
  Must not call `post_*_to_ledger` or any RPC that posts to the ledger from **new** Service API routes or UI.
- **Period mutation:**  
  Must not close or reopen accounting periods from Service workspace. Must not add **new** APIs or UI that call period close/reopen.
- **Infer or own period logic:**  
  For embedded reports, Service must not implement its own period resolution or reporting SQL; it must use Accounting’s period resolver and report endpoints only.
- **New accounting authority:**  
  No **new** features that perform adjustments, manual journals, reconciliation **post** (apply), or any other accounting action that mutates ledger or periods.

---

## 3. Required Rules for Future Changes

1. **Before adding any feature under Service workspace (routes/pages that are not `/accounting/*` and not retail):**
   - Confirm it does **not** insert/update/delete `journal_entries` or `journal_entry_lines`.
   - Confirm it does **not** call `post_*_to_ledger` or period close/reopen.
   - If it touches “reporting” or “periods,” it must use **read-only** Accounting endpoints (e.g. resolve + reports) and must **not** add new reporting SQL or period logic in Service.

2. **Before adding any API route that Service UI can call:**
   - If the route writes to DB, ensure it only writes to **operational** tables (invoices, expenses, bills, customers, etc.), not to ledger tables.
   - If the route reads ledger data, it must be read-only and must not be used to drive posting or period mutation from Service.

3. **Embedded reports (P&L, Balance Sheet, or any future “Accounting report” in Service):**
   - Must call Accounting’s period resolver and report endpoints only; no duplicate report SQL or business logic in Service.
   - Must pass an explicit period (via resolve) and must not default or infer periods in a way that bypasses Accounting’s resolution.
   - Must remain read-only: no posting, adjustment, or period-close UI or actions.

4. **Expense create (existing):**
   - Remains the single documented case where a Service action (INSERT into `expenses`) can cause a ledger write **via DB trigger only**. No **new** “create X and post to ledger” flows may be added in Service; any new posting must live in Accounting workspace or behind an Accounting-only API.

5. **Reconciliation:**
   - Service may keep read/match/unmatch where already exposed; **apply** of reconciliation adjustments must remain an accountant/Accounting path (no new “apply from Service” flows).

---

## 4. Summary

| Can | Cannot |
|-----|--------|
| CRUD operational data (orders, customers, expenses, bills, invoices, etc.) via existing APIs | Insert/update/delete `journal_entries` or `journal_entry_lines` from **new** Service code |
| Call Accounting **read-only** endpoints (resolve, P&L, Balance Sheet, ledger list) | Call `post_*_to_ledger` or period close/reopen from Service |
| Use receipt OCR for suggestions | Add new accounting logic, posting, or period behavior in Service |
| Read ledger via existing read-only APIs (e.g. ledger list) | Implement new report SQL or period resolution in Service |
| Use reconciliation for read/match where exposed | Add new “apply adjustment” or manual journal flows from Service |

---

*Freeze definition complete. No code changes in this deliverable.*
