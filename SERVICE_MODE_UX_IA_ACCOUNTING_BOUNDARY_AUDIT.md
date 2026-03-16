# FINZA — Service Mode UX, IA, Accounting Boundary & Onboarding Audit

**Role:** Principal SaaS Product Architect + Accounting Systems Auditor  
**Scope:** Service Mode UX, Information Architecture, accounting boundary, engagement/authority, onboarding, Chart of Accounts strategy.  
**Hard rules preserved:** Ledger immutable; posting trigger-driven; authority engine single source of truth; engagement evaluator for client access; period enforcement never bypassed.

---

# 1. Advanced Accounting Menu — Belonging Check

## Current Sidebar Items (Service workspace, "ACCOUNTING (Advanced)" section)

| Item | Route | Category | Analysis |
|------|--------|----------|----------|
| General Ledger | `/accounting/ledger?business_id=` | **Service Valid** (owner) + Firm | Service owners use own books; requires business_id (owner’s or firm client). Read/post via triggers only. |
| Chart of Accounts | `/accounting/chart-of-accounts?business_id=` | **Service Valid** + Firm | View-only COA; no create/edit in UI. Eligibility badge = “opening balance eligible” (asset/liability/equity, non-system), not “forbidden to view”. |
| Trial Balance | `/accounting/reports/trial-balance?business_id=` | **Service Valid** + Firm | Read-only report; period-scoped. |
| Reconciliation | `/accounting/reconciliation?business_id=` | **Service Valid** + Firm | Match AR/ledger; resolve exceptions. Owner can reconcile own business. |
| Accounting Periods | `/accounting/periods?business_id=` | **Service Valid** + Firm | Owner can close/lock own periods (authority: write). Required for send invoice / record payment. |
| Audit | `/accounting/audit?business_id=` | **Service Valid** + Firm | Accounting action trail (reversals, period_close, adjustments). Distinct from Audit Log. |
| Health | `/accounting/health?business_id=` | **Service Valid** + Firm | Read-only accounting health; no ledger write. |
| Control Tower | `/accounting/control-tower` | **Firm Accounting Only** | Multi-client work queue, engagement status, risk scoring. Service owner has one business; no “clients” to manage. |
| Forensic Runs / Tenants | `/admin/accounting/*` | **Internal/Admin** | Firm-only (sidebar conditional `isAccountantFirmUser`). |
| Audit Log | `/audit-log` | **Service Valid** (different from Audit) | App-wide activity log (login, entity changes). Not accounting-specific. |

## Per-item answers

1. **Does Service need it?** Ledger, CoA, Trial Balance, Reconciliation, Periods, Audit, Health — **yes** (owner viewing/managing own accounting). Control Tower — **no** (multi-client tool).
2. **Engagement authority?** Only firm accountant flows use engagement; owner uses `checkAccountingAuthority` with owner/employee role for own business_id.
3. **Changes ledger state?** Periods (close/lock) and Reconciliation (resolve) do; both gated by authority. Rest read-only or trigger-driven from operational actions.
4. **Hide behind Accounting workspace?** All live under `/accounting/*`; no duplication under `/service/*`. Service sidebar links to same accounting routes with `business_id` (owner’s business when not firm user).

## Special: Control Tower

- **Should Service see it?** **No.** Control Tower is built for firm accountants: client list, engagement status, work items (journal approval, OB approval, period blockers, recon exceptions, engagement_*). Service owner has a single business and no engagement concept for “self.”
- **Relocation:** **Role-restrict.** Keep route `/accounting/control-tower` but show Control Tower in sidebar only when `isAccountantFirmUser === true`. For service owners, hide the Control Tower item (or replace with a single-business “Health” / “Accounting status” that links to `/accounting/health?business_id=`).

## Special: Audit vs Audit Log

| Aspect | `/accounting/audit` | `/audit-log` |
|--------|---------------------|--------------|
| **Purpose** | Accounting action trail: reversals, period_close, period_reopen, adjustments, forensic, tenant actions. | General app audit: who did what (action_type, entity_type, entity_id) across the app. |
| **API** | `GET /api/accounting/audit?business_id=&...` (accounting context). | `GET /api/audit-logs/list?...` (business-scoped, no accounting RPC). |
| **Persona** | Owner or firm accountant viewing accounting operations for a business. | Owner/admin viewing activity for their business. |
| **Duplication?** | No. Different data and intent. | |
| **Recommendation** | Keep both. Rename in UI if needed: “Accounting audit” vs “Activity log” to reduce confusion. |

---

# 2. Business Profile vs Business Settings

## Current state

- **`/settings/business-profile`** (`app/settings/business-profile/page.tsx`): Legal identity and operational profile — legal_name, trading_name, address_*, phone, whatsapp_phone, email, website, tin, logo_url, default_currency, start_date. Used in onboarding step `business_profile`.
- **`/settings/business`** (`app/settings/business/page.tsx`): Shorter form — name, industry, email, phone, address, tax_id (from business record). Uses `getCurrentBusiness` and generic “Business Settings” label.

## Overlap

- **Duplicate / overlapping:** name, email, phone, address, tax_id/tin. Two places to change similar data causes confusion and risk of drift.
- **Conflicting responsibilities:** Profile = legal + invoicing/currency; Business = generic “settings.” Ownership boundary is unclear.

## Recommendation

**Split by responsibility (no merge into one blob):**

1. **Business Profile** (keep and own “legal + operational identity”):  
   Legal name, trading name, address, phone, WhatsApp, email, website, TIN, logo, **default_currency**, **start_date**.  
   Used for invoicing, tax, and onboarding. Leave as primary for onboarding step `business_profile`.

2. **Business Settings** (rename to “Business preferences” or fold into Profile):  
   Either:
   - **Option A:** Merge into Business Profile as a second section “Preferences” (industry, notification preferences if any), and **deprecate** `/settings/business` for service/retail, or  
   - **Option B:** Keep `/settings/business` but restrict to **industry and non-financial preferences only**; remove name/address/phone/tax (read-only link: “Edit in Business Profile”).

Recommend **Option A** for Service: single “Business Profile” page with Legal identity + Preferences; remove duplicate fields from `/settings/business` and redirect service/retail to Business Profile if they land on `/settings/business`. No schema change required; only which page edits which fields.

---

# 3. Service Mode Onboarding Flow Audit

## Current chain

1. Signup → Auth callback → business check → `/business-setup` or `/accounting/firm`.
2. Business creation: `business-setup` inserts business with `onboarding_step: "business_profile"` → redirect `/onboarding`.
3. Service onboarding: `/onboarding` (steps: business_profile, add_customer, add_product, create_invoice, …). **No explicit accounting bootstrap step.** Accounting is initialized on first send invoice / record payment (or when user opens Accounting hub and clicks Initialize).
4. Dashboard entry: after onboarding, user lands on `/dashboard` (service).

## Friction

- **Accounting readiness:** User is not told that “sending an invoice” or “recording a payment” requires accounting to be initialized. If they try before bootstrap, they get a 500 or generic error.
- **COA:** Onboarding does not explain that the chart of accounts is system-defined and fixed (no custom accounts). “Forbidden” in CoA is only for “opening balance eligible” (income/expense and system accounts); this is not clearly explained.
- **MoMo / WhatsApp:** Not steps in onboarding; they appear under Settings (Payments, Integrations/WhatsApp). Optional integrations; no guided “turn on payments” step.
- **Engagement:** Engagement is a firm concept (client–firm relationship). Service owners do not have “engagement”; no need to explain it in service onboarding.

## Proposed Service Onboarding Flow (minimal, safe)

| Step | Content | Why |
|------|---------|-----|
| 1 | **Business profile** | Legal name, address, country, currency, TIN, contact. (Existing `/settings/business-profile`.) |
| 2 | **Industry template** | Confirm industry (service); no COA template choice if COA remains fixed. |
| 3 | **Tax setup** | Confirm country/tax (already from profile). Optional: “We’ll calculate tax based on your country.” |
| 4 | **Payment channels** | “How will you get paid?” — Cash, Bank, MoMo (link to Settings → Payments). No API change; informational + CTA. |
| 5 | **Communication** | “Send invoices by email or WhatsApp?” — Link to Settings → WhatsApp Integration. Optional. |
| 6 | **Accounting readiness** | “One-time setup: we’ll create your ledger and chart of accounts so you can send invoices and record payments.” Call `POST /api/accounting/initialize?business_id=` (or show “Initialize” from Accounting hub). Ensures bootstrap before first send. |
| 7 | **First invoice** | Guided “Create your first invoice” (link to `/invoices/new` or short wizard). |

No change to ledger or authority; only order of steps and one explicit “Initialize accounting” step (reusing existing API).

---

# 4. Chart of Accounts — Fixed vs Custom

## Why accounts are effectively “fixed”

- **Integrity:** Posting and control-account resolution (AR, AP, cash, tax) depend on known account codes. Allowing arbitrary new top-level accounts or reclassification of system accounts would break mapping and reporting.
- **Ledger stability:** Journal entry lines reference `account_id`. Deleting or merging accounts would require complex migration and reconciliation; locking structure avoids that.
- **Reporting consistency:** P&L, BS, TB assume a known structure. System accounts (is_system) and control codes (e.g. 1100, 2000, 21xx) are part of that contract.
- **Tax compliance:** Tax accounts (VAT, NHIL, etc.) are system-defined; custom accounts could bypass or duplicate tax logic.

Current UI: CoA page is **read-only** (list from `GET /api/accounting/coa`). No “Add account” in app. “Forbidden” badge = “not eligible for opening balances” (income/expense/system), not “forbidden to view.”

## Model choice

| Model | Pros | Cons |
|-------|------|------|
| **A — Fully locked COA** | Simple, compliant, predictable. | Industry mismatch if one template doesn’t fit. |
| **B — Hybrid** | Custom sub-accounts/expense categories; core and posting rules locked. | More logic and testing; must enforce “no reclassification of system accounts.” |
| **C — Industry template at onboarding** | Choice of template then lock. | Requires template set and migration path; more product work. |

**Recommendation for Ghana SMEs, service, and firm scalability:** **Model A (fully locked) for now.** Keep single canonical COA from bootstrap; no custom accounts in app. If later you need custom **sub-accounts** (e.g. under a single “Revenue” or “Office expenses” parent), that can be a separate phase (Model B) with strict rules: no new control accounts, no change to system account codes, server-side enforcement. Do not allow custom accounts in the current scope; document “COA is system-defined for consistency and compliance” in help or onboarding.

---

# 5. Control Tower Role Validation

- Control Tower **relies on engagement state** (pending, active, suspended, terminated, not_effective) and **multi-client workflow** (work items per client, risk score, assignment).
- For a **service owner**, there is a single business and no engagement with “self”; showing Control Tower adds cognitive load and no benefit.

**Decision tree:**

- **IF user is service/retail owner (not in `accounting_firm_users`):**  
  Do **not** show Control Tower in sidebar. Optionally show a single “Accounting status” or “Health” link to `/accounting/health?business_id=<owner’s business>`.
- **ELSE IF user is firm accountant:**  
  Show Control Tower in sidebar (and current firm-only items: Forensic, Tenants).

**Implementation:** In `components/Sidebar.tsx`, when building `accountingItems` for service industry, **exclude** “Control Tower” (and Forensic/Tenants) unless `isAccountantFirmUser === true`. No change to route or API; only visibility of the menu item.

---

# 6. Service Accounting Capability Boundary

| Capability | Service workspace | Rationale |
|------------|-------------------|-----------|
| Invoicing | ✅ Allow | Core; posting via trigger. |
| Payment reconciliation (basic) | ✅ Allow | Match payments to invoices; resolve in accounting workspace with authority. |
| Expense capture | ✅ Allow | Operational; posting via trigger. |
| Dashboard reporting | ✅ Allow | KPIs from operational + ledger (e.g. expense total). |
| Period close | ✅ Allow (own business) | Owner has write; `checkAccountingAuthority` grants it. Already in accounting workspace. |
| Ledger adjustments | ✅ Allow (own business) | Via adjustments UI; authority-gated. |
| Journal posting | ✅ Allow (own business) | Manual journals; authority-gated. |
| Opening balance control | ✅ Allow (own business) | Opening balances/imports; authority-gated. |
| Engagement management | ❌ Not applicable | Firm concept; service owner has no engagements. |
| Compliance / forensic audit | ❌ Firm / admin | Forensic runs, tenant archive — firm or admin only. |

**Boundary:** Service workspace = operational billing + light reporting + **access to accounting workspace for own business**. Accounting workspace = same routes for both owner and firm; authority (owner vs accountant + engagement) is enforced in API and pages. Service does **not** get a separate “light” accounting; they use the same accounting routes with their own `business_id`.

---

# 7. WhatsApp + MoMo Onboarding Placement

- **Current:** Settings → WhatsApp Integration; Settings → Payments (MoMo configuration). Not in onboarding.
- **User mental model:** “I want to get paid and remind customers” → payment and communication are secondary to “having a business and sending an invoice.”

**Recommendation:**

- **Onboarding:** **Optional steps** (not blocking). After Business profile and before or after “Accounting readiness”: short step “Get paid via Mobile Money or bank” (link to Settings → Payments) and “Send invoices by WhatsApp” (link to Settings → Integrations → WhatsApp). No API change; CTAs only.
- **Primary placement:** Remain in **Settings** as the canonical place to configure MoMo and WhatsApp. Onboarding only **surfaces** them so users know they exist.
- **Not required for first invoice:** Allow first invoice without MoMo/WhatsApp; “Send” can be email or copy link until they configure WhatsApp.

---

# 8. Duplicate or Confusing Navigation

- **FINANCE & REPORTING** (service): Profit & Loss, Balance Sheet, VAT Returns, Financial Reports, Credit Notes, Bills, Assets, Payroll. Some of these (e.g. P&L, BS) are also available under Accounting (reports). **Not duplicate routes:** `/reports/profit-loss` vs `/accounting/reports/profit-and-loss` — different routes; one is shared reports, one is accounting-scoped. For service, prefer accounting routes with `business_id` for consistency.
- **Accounting Portal** (`/portal/accounting`): Purpose and difference from “Accounting (Advanced)” should be clear; if it’s a different entry (e.g. client portal), keep; otherwise consider renaming or merging into one “Accounting” entry.
- **Audit vs Audit Log:** Already clarified above; consider labels “Accounting audit” and “Activity log.”
- **Pages that belong only in Accounting:** Control Tower (hide for non-firm). Forensic/Tenants (already firm-only).
- **Role-hide:** Control Tower and admin/accounting items for non-firm users (see §5).

---

# 9. UX Professionalism Score (Service Dashboard)

- **Clarity:** Good: cards for revenue, outstanding, overdue, collected; recent invoices. Currency and industry shown.
- **Hierarchy:** Reasonable; top = business identity and quick actions; then alerts; then metrics.
- **Cognitive load:** Medium: many sidebar sections (Operations, Finance & Reporting, Accounting Advanced, Settings). “Accounting (Advanced)” may intimidate; could be “Accounting” or “Ledger & reports.”
- **Decision-driven:** Good: “Create Invoice,” “Add Expense,” “Add Customer” prominent; discrepancy banner drives “Go to Reconciliation.”
- **Action-driven:** Good: primary actions visible.

**Suggested IA (minimal):**

- Group KPIs into: **Money in** (revenue, collected this month), **Money out** (expenses if present), **Outstanding** (overdue, total outstanding). One row of cards.
- Keep “Recent invoices” and quick actions.
- Rename sidebar “ACCOUNTING (Advanced)” → **“Accounting”** or **“Ledger & reports”** to reduce perceived complexity.
- No full redesign; only labeling and optional grouping.

---

# 10. Deliverables Summary

## SECTION A — Misplaced Features

| Feature | Current location | Should be | Reason |
|---------|------------------|-----------|--------|
| Control Tower | Service sidebar (ACCOUNTING Advanced) | Shown only for firm users | Multi-client, engagement-based; not for single-business owners. |
| Audit Log | Sidebar under Accounting section | Keep; consider label “Activity log” | Not accounting-specific; reduce confusion with Accounting audit. |

## SECTION B — Duplicate Features

| Feature A | Feature B | Recommendation |
|-----------|-----------|----------------|
| Business Profile | Business Settings | Merge or split: Profile = legal/identity/currency; remove duplicate name/address/phone/tax from Business Settings or redirect to Profile. |
| /reports/profit-loss (shared) | /accounting/reports/profit-and-loss | Keep both; prefer accounting route with business_id for service for consistency. No merge. |
| /accounting/audit | /audit-log | Keep both; rename to “Accounting audit” vs “Activity log.” |

## SECTION C — COA Strategy Recommendation

- **Recommendation:** **Fully locked COA (Model A)** for current production. No custom accounts; COA created at bootstrap only. “Forbidden” in UI = “not eligible for opening balances,” not “forbidden to view.” Document for users that the chart of accounts is system-defined for consistency and tax compliance.  
- **Future:** If needed, introduce **Model B (hybrid)** in a later phase: allow custom sub-accounts under non-control accounts only; forbid new control accounts and reclassification of system accounts; enforce server-side.

## SECTION D — Service Onboarding Redesign

1. Business profile (legal, address, country, currency, TIN).  
2. Industry (confirm service).  
3. Tax (confirm country; optional copy).  
4. Payment channels (MoMo/Bank) — CTA to Settings.  
5. Communication (WhatsApp/email) — CTA to Settings.  
6. **Accounting readiness** — explicit “Initialize accounting” (call existing initialize API or CTA to Accounting hub).  
7. First invoice — guided CTA to create first invoice.

No schema or engine change; only flow order and one explicit bootstrap step.

## SECTION E — Workspace Boundary Model

| Responsibility | Service workspace | Accounting workspace |
|----------------|-------------------|----------------------|
| Invoicing, payments, expenses | ✅ Operate (UI under /invoices, /payments, etc.) | ✅ Posting via triggers; reports. |
| View ledger, CoA, TB, P&L, BS | ✅ Via /accounting/* with own business_id | ✅ Same routes; owner or firm with business_id. |
| Reconcile, close periods, adjust | ✅ Via /accounting/* with own business_id | ✅ Authority-gated. |
| Multi-client work queue (Control Tower) | ❌ | ✅ Firm only. |
| Engagement management | ❌ | ✅ Firm only. |
| Forensic / tenants | ❌ | ✅ Admin/firm only. |

## SECTION F — Control Tower Decision

**Decision:** **Role-restrict.**  
- **Keep** route `/accounting/control-tower`.  
- **Show** in sidebar only when `isAccountantFirmUser === true`.  
- **Hide** for service/retail owners; optionally show “Accounting status” or “Health” linking to `/accounting/health?business_id=`.

## SECTION G — Navigation Cleanup Plan (minimal)

1. **Sidebar (service):** Exclude Control Tower (and Forensic/Tenants) unless `isAccountantFirmUser`.  
2. **Sidebar:** Rename “ACCOUNTING (Advanced)” to “Accounting” or “Ledger & reports.”  
3. **Audit vs Audit Log:** Label “Accounting audit” and “Activity log” (or “App activity log”).  
4. **Business Profile / Business Settings:** Remove duplicate fields from Business Settings or redirect to Business Profile for service (Option A in §2).  
5. No route or API changes beyond optional redirect.

## SECTION H — Dashboard Redesign Strategy

- **Layout:** Keep current structure; group KPIs into Money in / Outstanding (and Money out if shown).  
- **Action hierarchy:** Keep “Create Invoice,” “Add Expense,” “Add Customer” as primary.  
- **Discrepancy banner:** Keep; link to `/accounting/reconciliation?business_id=`.  
6. No full redesign; clarity and labels only.

---

**End of audit.** All recommendations preserve ledger immutability, trigger-driven posting, authority engine, engagement evaluator, and period enforcement. No schema or engine redesign; only UX, IA, and navigation visibility changes.
