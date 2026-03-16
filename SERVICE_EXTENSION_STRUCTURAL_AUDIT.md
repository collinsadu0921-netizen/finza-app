# Finza Service Workspace — Structural Audit for Planned Extensions

**Date:** 2026-03-04  
**Scope:** Codebase and database audit before implementing: Proforma, Partial Invoice Payments, Supplier & Bill Management, Customs/Import Declaration, Projects, Milestone Billing, Project Execution (tasks + roles), Material Allocation from Warehouse, Job Pack Generation.  
**Goal:** Add features without breaking the canonical accounting engine or retail workspace.

---

## 1. Executive Summary

| Planned module | Exists? | Extend / integrate | Ledger / retail risk |
|----------------|---------|--------------------|----------------------|
| 1. Proforma documents | No | New doc type or estimate variant | Low |
| 2. Partial invoice payments | Yes | Already supported | None |
| 3. Supplier & bill management | Partial | Unify bills ↔ suppliers; extend Service UI | Low (bills already post) |
| 4. Customs/import declaration | No | New table + optional link to bills/POs | Low |
| 5. Projects (contract layer) | No | New table; link estimates/orders/invoices/jobs | Low |
| 6. Milestone billing | No | New tables + invoice linkage | Medium (revenue timing) |
| 7. Project execution (tasks + roles) | Partial | Extend service_jobs; new tasks/roles tables | Low |
| 8. Material allocation from warehouse | Partial | Service materials vs retail inventory; allocation source | Medium (dual inventory) |
| 9. Job pack generation | No | New feature on top of service_jobs + materials | Low |

**Canonical accounting:** All operational ledger writes go through `post_journal_entry()` (17-param) via triggers or wrapper RPCs. Service workspace does not call `post_journal_entry` directly; no new feature should bypass this pattern.

---

## 2. What Already Exists

### 2.1 Invoices, payments, estimates, orders

- **Tables:** `invoices`, `invoice_items`, `payments`, `estimates`, `estimate_items`, `orders`, `order_items` (and recurring_invoices).
- **Ledger:** `post_invoice_to_ledger`, `post_invoice_payment_to_ledger` (trigger on `invoices` status → sent/paid/partially_paid; trigger on `payments` insert). Idempotency by `reference_type = 'invoice'` / `reference_type = 'payment'` + `reference_id`.
- **Partial payments:** Fully supported. Multiple `payments` per invoice; status `partially_paid`; trigger `recalculate_invoice_status`; alerts via `081_add_partial_payment_alerts.sql`.
- **Evidence:** `SERVICE_WORKSPACE_AUDIT.md`, `SERVICE_WORKSPACE_GAP_AUDIT.md`, migrations 032, 035, 036, 043, 129, 190, 218, 226, 227, 258.

### 2.2 Bills (supplier bills — Service)

- **Tables:** `bills`, `bill_items`, `bill_payments` (migration 042). Bills use `supplier_name` (TEXT), not a FK to a suppliers table.
- **Ledger:** `post_bill_to_ledger`, `post_bill_payment_to_ledger`; triggers on bill status (draft → open) and on `bill_payments` insert (043, 091, 099, 100, 101, 190, 267, 268, 270). Reference types: `bill`, `bill_payment`.
- **UI/API:** `app/bills/page.tsx`, `app/api/bills/*` — shared (not under `/service/`), so used by service (and any non-retail) context.
- **Gap:** No `suppliers` table linked to bills; supplier is free text.

### 2.3 Suppliers (Retail)

- **Tables:** `suppliers`, `purchase_orders`, `purchase_order_items`, `supplier_invoices`, `supplier_payments` (migration 198). Retail-focused: POs receive into retail inventory; `post_purchase_order_receipt_to_ledger`, `post_supplier_payment_to_ledger`.
- **Ledger:** reference_type `purchase_order`, `supplier_payment`; AP and inventory (retail) accounts.
- **UI:** Under `app/admin/retail/` and `app/retail/admin/` (suppliers, purchase-orders). No equivalent under `app/service/`.
- **Separation:** Retail uses `products` + `products_stock`; service has separate `service_material_inventory`. Two distinct inventory models.

### 2.4 Service jobs and materials

- **Tables:** `service_catalog`, `service_material_inventory`, `service_material_movements`, `service_jobs`, `service_job_material_usage` (migrations 314/321).
- **Ledger:** `post_service_job_material_usage_to_ledger(p_usage_id)` (322) — Dr 5110 Cost of Services, Cr 1450 Service Materials Inventory; reference_type `service_job_usage`. `post_service_job_cancel_reversal` (323) for job cancel.
- **API:** `POST /api/service/jobs/use-material` — deducts stock, inserts `service_material_movements` (job_usage), inserts `service_job_material_usage`. **Does not call `post_service_job_material_usage_to_ledger`** — ledger posting for usage is never triggered from the app (gap).
- **Service jobs:** `customer_id`, `status`, `start_date`, `end_date`, `invoice_id`; no project_id, no milestones, no tasks/roles tables.
- **UI:** `app/service/jobs/*`, `app/service/materials/*`, `app/service/inventory/page.tsx`.

### 2.5 Workspace separation

- **Service:** `industry === 'service'`; routes under `app/service/*` and shared routes (invoices, bills, payments, etc.). Sidebar: `components/Sidebar.tsx` when `businessIndustry === "service"`.
- **Retail:** `industry === 'retail'`; POS, registers, stores, retail inventory, suppliers, POs. No service_jobs or service_material_* in retail flows.
- **Accounting:** Single ledger (`journal_entries`, `journal_entry_lines`); shared COA (`accounts`). Period and adoption guards in `post_journal_entry` and wrapper RPCs. Service does not expose period management or manual journals; posting is trigger-driven only (see `SERVICE_WORKSPACE_AUDIT.md`).

---

## 3. Module-by-Module: Extend vs New

### 3.1 Proforma documents

- **Exists:** No. No `proforma` or `proforma_invoices` table; no proforma-specific status on estimates/invoices.
- **Extend vs new:** Either:
  - **Option A:** New document type: table `proformas` (+ items), separate from estimates/invoices; convert proforma → estimate or invoice. No ledger until conversion to invoice and send.
  - **Option B:** Extend `estimates` with `document_type` ('estimate' | 'proforma') and treat proforma as non-binding estimate with different numbering/labels.
- **Integration:** If converted to invoice, use existing `post_invoice_to_ledger` on send. No new ledger reference_type required if proforma is pre-issuance only.
- **Migrations:** New table(s) or new column(s) on estimates; RLS and indexes; optional `reference_type = 'proforma'` only if you ever post something (e.g. deposit liability); usually no ledger impact.

### 3.2 Partial invoice payments

- **Exists:** Yes. Multiple payments per invoice; status `partially_paid`; triggers and alerts.
- **Action:** None required for “support”; optional UX improvements (e.g. payment plans, scheduled partial payments).

### 3.3 Supplier & bill management (Service)

- **Exists:** Bills (with free-text supplier); retail has full supplier + PO + supplier_invoices + supplier_payments.
- **Extend:**
  - **Option A (recommended):** Introduce `suppliers` (or reuse retail `suppliers` with `business_id`) for service; add `bills.supplier_id UUID REFERENCES suppliers(id)`. Migrate existing `supplier_name` to supplier records where possible.
  - **Option B:** Keep bills as-is and add a separate “Service suppliers” list (new table) and link bills to it.
- **Ledger:** No change. `post_bill_to_ledger` / `post_bill_payment_to_ledger` stay as-is; only the operational link (bill → supplier) changes.
- **Migrations:** Add `supplier_id` to `bills` (nullable at first); backfill; optional `supplier_contacts`, `supplier_terms` if needed. Ensure RLS and industry context: service can use suppliers without touching retail POs.

### 3.4 Customs/import declaration recording

- **Exists:** No. No tables or references to customs, import declaration, or duties.
- **New:** New table e.g. `customs_declarations` (business_id, reference_type, reference_id, declaration_number, authority, date, amount_duty, amount_tax, currency, file_url, notes). Optional link to `bills` or `purchase_orders` via reference_type/reference_id.
- **Ledger:** Optional: if duties are expenses, could post via expense or a dedicated “customs duty” expense account; or link declaration to an existing bill/expense and do not duplicate posting. Prefer no new reference_type unless necessary; use `expense` or `bill` for ledger.
- **Migrations:** CREATE TABLE; RLS; indexes; optional FKs to bills/POs.

### 3.5 Projects (contract layer)

- **Exists:** No. No `projects` table. SERVICE_WORKSPACE_GAP_AUDIT.md explicitly lists “Projects/Engagements” as missing.
- **New:** Table `projects` (business_id, customer_id, name, description, status, start_date, end_date, contract_value, currency, created_at, updated_at). Link existing entities: `estimates.project_id`, `orders.project_id`, `invoices.project_id`, `service_jobs.project_id` (add columns).
- **Ledger:** Projects are metadata only. Invoices/orders/estimates/jobs continue to post as today; no new posting logic. Reports can aggregate by project.
- **Migrations:** CREATE projects; ALTER estimates/orders/invoices/service_jobs ADD project_id; indexes; RLS.

### 3.6 Milestone billing

- **Exists:** No. No milestones table or invoice-line-level “milestone”.
- **New:** Tables e.g. `project_milestones` (project_id, name, due_date, amount, status, invoice_id nullable) and optionally `invoice_milestone_allocations` (invoice_id, milestone_id, amount). When an invoice is sent, link paid amount to milestones; or create invoices per milestone.
- **Ledger:** Revenue remains “on invoice send” via existing `post_invoice_to_ledger`. Risk: if you recognise revenue by milestone (e.g. percentage-of-completion), that would require new logic and possibly new reference_type or adjustment flows — document and design carefully to avoid breaking existing revenue rules (only invoice/credit_note/sale + explicit revenue correction allowed in `post_journal_entry`).
- **Migrations:** New tables; optional `invoices.milestone_id` or link table; period/revenue guards unchanged unless you add milestone-based recognition.

### 3.7 Project execution (tasks + roles)

- **Exists:** Partial. `service_jobs` exists (customer_id, status, start_date, end_date, invoice_id); no tasks, no roles.
- **Extend:** Add `service_job_tasks` (job_id, name, assignee_id, due_date, status, sort_order); optionally `service_job_roles` (job_id, role_name, user_id or external). Add `service_jobs.project_id` when projects exist.
- **Ledger:** No direct ledger impact. Job continues to drive material usage (and optional future milestone invoicing).
- **Migrations:** New tables; FKs to service_jobs (and users if assignee); RLS.

### 3.8 Material allocation from warehouse

- **Exists:** Service: `service_material_inventory` and `service_job_material_usage`; movements `purchase`, `adjustment`, `job_usage`, `return`. Retail: `products_stock`, `stock_movements`, PO receive. No “warehouse” as first-class entity; no allocation from retail inventory to service.
- **Extend:** Define “warehouse” (e.g. locations under business or store). Then either:
  - **Option A:** Keep service materials separate; add “transfer from warehouse” as a movement type that reduces a warehouse stock (e.g. retail product or “warehouse” table) and increases `service_material_inventory` (or direct job allocation). Ledger: transfer JE (e.g. Dr 1450 Service Materials, Cr 1200 Inventory) via a new RPC that calls `post_journal_entry` with a new reference_type e.g. `material_transfer`, and ensure period/balance/revenue rules are respected.
  - **Option B:** Allow jobs to consume from retail inventory (e.g. sale_item-like allocation from products_stock). Higher risk: mixes retail COGS/inventory with service; requires clear account mapping and reference_type so reporting stays correct.
- **Risks:** Dual inventory (retail vs service) and shared warehouse need clear ownership and COA (1450 vs 1200, 5110 vs 5000). New reference_type and new RPC should follow existing pattern (idempotency, period assert, posting_source = 'system').

### 3.9 Job pack generation

- **Exists:** No. No “job pack” (PDF/print bundle of job + tasks + materials + instructions).
- **New:** Feature only: aggregate job + tasks + materials from existing tables; generate PDF or document. No new tables required for minimal version; optional `job_pack_templates` or stored output path.
- **Ledger:** None.
- **Migrations:** None for MVP; optional template table later.

---

## 4. Where These Features Should Integrate

- **Proforma:** New route under `/service/` (e.g. `/service/proformas`) or under shared `/estimates` with type filter; create/convert APIs; no new accounting route.
- **Partial payments:** Already in `/payments` and invoice flows; optional improvements in `/service/payments` or invoice detail.
- **Suppliers & bills:** Service UI for suppliers: e.g. `/service/suppliers` and `/service/bills` (or keep shared `/bills`, add supplier picker from shared `suppliers` filtered by business). Ensure only service business sees service sidebar and cannot access retail-only PO flows.
- **Customs/import:** New section e.g. `/service/customs` or under “Bills” / “Purchasing”; list/create declarations; link to bill or PO by reference.
- **Projects:** `/service/projects`; project detail shows linked estimates, orders, invoices, jobs. Estimate/order/invoice/job create forms: optional project selector.
- **Milestone billing:** Under project or job: milestones list; “Create invoice from milestone” or “Mark milestone as invoiced” linking to existing invoice. Invoicing remains current flow; milestone is metadata + optional invoice link.
- **Project execution:** Under `/service/jobs/[id]`: tasks list, assignees, roles. Reuse existing job and materials APIs.
- **Material allocation from warehouse:** New movement type and API (e.g. POST `/api/service/materials/allocate-from-warehouse` or transfer); service inventory and ledger RPC as above. UI under job detail or materials/inventory.
- **Job pack:** Button on job detail “Generate job pack”; call API that builds PDF from job + tasks + materials; optional download or attach to job.

---

## 5. Migrations Required (Summary)

| Feature | Suggested migrations |
|---------|----------------------|
| Proforma | New table `proformas` + items, or add `document_type` to estimates; RLS; no ledger columns unless deposit liability needed. |
| Partial payments | None (already implemented). |
| Supplier & bills | Add `bills.supplier_id` (nullable) FK to suppliers; ensure suppliers usable by service (same table or view by industry); RLS. |
| Customs/import | CREATE `customs_declarations`; RLS; optional reference_type/reference_id to bills/POs. |
| Projects | CREATE `projects`; ADD `project_id` to estimates, orders, invoices, service_jobs; indexes; RLS. |
| Milestone billing | CREATE `project_milestones`; optional link table to invoices; RLS. |
| Project execution | CREATE `service_job_tasks`, optional `service_job_roles`; ADD `project_id` to service_jobs if not in projects migration; RLS. |
| Material from warehouse | Optional `warehouses` or locations; new movement type and RPC `post_material_transfer_to_ledger` (or extend existing) with reference_type `material_transfer`; idempotency and period guard. |
| Job pack | None for MVP (generate from existing tables). |

---

## 6. Risks to Accounting Ledger and Retail Workspace

### 6.1 Ledger (canonical engine)

- **Do not:** Call `post_journal_entry` from application code; do not insert into `journal_entries` / `journal_entry_lines` outside RPCs.
- **Do:** Add new operational flows (e.g. material transfer, milestone-linked invoice) via triggers or dedicated RPCs that call `post_journal_entry` with a clear `reference_type` and idempotency (e.g. check for existing JE by reference_type + reference_id). Use `posting_source = 'system'` and respect `assert_accounting_period_is_open` and adoption boundary.
- **Revenue:** Only invoice, credit_note, sale (and explicit revenue correction) may post revenue. Milestone-based recognition would need a controlled path (e.g. adjustment or new reference_type with guard) so as not to break 292 revenue guards.
- **post_journal_entry overloads:** Keep a single canonical 17-param function; migration 325 drops the 16-param overload. Any new caller must use the 17-param signature (or defaults).

### 6.2 Retail workspace

- **Isolation:** Retail flows use `industry === 'retail'`, register sessions, stores, `products_stock`, `sales`, `post_sale_to_ledger`, etc. Service uses `industry === 'service'`, invoices, bills, `service_jobs`, `service_material_inventory`. Do not mix: e.g. do not let service jobs post to retail COGS (5000) or retail inventory (1200) unless you explicitly design a “transfer” with a new reference_type and correct accounts.
- **Suppliers:** If you share `suppliers` between retail and service, RLS and UI must restrict by business and industry (retail: POs and supplier_invoices; service: bills and optional supplier_invoices). Same table is fine; access control and routes must stay separated.
- **Inventory:** Retail inventory (products_stock, stock_movements) and service materials (service_material_inventory, service_material_movements) remain separate unless you add a formal “allocation from warehouse” that creates a clear, auditable transfer JE (and movement type) so both sides balance.

### 6.3 Service-specific risks

- **Material usage ledger gap:** `POST /api/service/jobs/use-material` does not call `post_service_job_material_usage_to_ledger`. So Cost of Services (5110) / Service Materials Inventory (1450) are not updated when materials are used. **Recommendation:** Either add a trigger on `service_job_material_usage` AFTER INSERT that calls `post_service_job_material_usage_to_ledger(NEW.id)`, or have the use-material API call the RPC after insert (within same transaction if possible). Prefer trigger for consistency.
- **Bills in Service:** Bills and bill payments already post to ledger; they are available in the shared UI. Ensure any new “Service suppliers” or supplier dropdown does not change bill totals or posting logic — only links bill to supplier entity.

---

## 7. Recommendations (Priority)

1. **Fix material usage posting:** Add trigger on `service_job_material_usage` to call `post_service_job_material_usage_to_ledger(NEW.id)` (or ensure API calls it in same transaction). Ensures 5110/1450 stay in sync with usage.
2. **Projects next:** Add `projects` and `project_id` to estimates, orders, invoices, service_jobs. No ledger change; enables project-based reporting and future milestone billing.
3. **Suppliers for Service:** Add `bills.supplier_id` and service-facing supplier UI; keep using existing bill posting.
4. **Proforma:** Implement as new document type or estimate variant; no ledger impact until conversion to invoice.
5. **Milestone billing:** Design so that invoicing and revenue remain “on send invoice”; milestones as metadata and optional invoice link. If you need percentage-of-completion or milestone-based revenue, design a separate, guarded path (e.g. adjustment or new reference_type with revenue guard).
6. **Material from warehouse:** Define warehouse/allocation model and single transfer RPC with new reference_type; keep service (1450, 5110) and retail (1200, 5000) accounts distinct.
7. **Customs/import and job pack:** Add when needed; low ledger/retail risk.

---

## 8. References (Evidence in Repo)

- `SERVICE_WORKSPACE_AUDIT.md` — Service flows, no manual JE, trigger-driven posting.
- `SERVICE_WORKSPACE_GAP_AUDIT.md` — Partial payments, bills, projects gap, no proforma.
- `docs/CANONICAL_POSTING_ENGINE_FEASIBILITY_AUDIT.md` — All RPCs that call `post_journal_entry`.
- `RETAIL_ACCOUNTING_MODEL.md` — Ledger-only financial statements; retail sales five-line JE.
- `LEDGER_POST_JOURNAL_ENTRY_OVERLOAD_AUDIT.md` — 17-param canonical; 325 drops 16-param.
- Migrations: 042 (bills), 043 (post_bill*, triggers), 198 (suppliers, POs, supplier_invoices/payments), 321 (service inventory, jobs, usage), 322 (service_job_material_usage ledger), 323 (job cancel reversal).

---

*End of structural audit. No code or schema changes were made; this document is for planning only.*
