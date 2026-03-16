# Service Owner P&L / Balance Sheet Access — Minimum Safe Design

**Role:** Principal accounting systems engineer  
**Goal:** Allow SERVICE business owners to view P&L and Balance Sheet without waiting for accountants, while keeping accounting invariants correct.  
**Constraint:** Analysis and plan only. No implementation. Must not break retail. Must not weaken ledger integrity. Smallest diff, reversible steps.

---

## 1. Unblock options

Three ways to let service owners see P&L/BS, with files impacted, auth/role changes, and risk.

### Option A: Remove 410 and reuse accounting workspace report APIs directly

**Idea:** Delete the unconditional 410 return in the **operational** report routes and let them run the same logic as today’s blocked block (period lookup → RPC). No new endpoints; operational routes become thin wrappers that call the same RPCs as accounting.

**Exact files/routes impacted**
- `app/api/reports/profit-loss/route.ts` — remove lines 5–14 (the `return NextResponse.json(..., { status: 410 })`); rest of GET runs.
- `app/api/reports/balance-sheet/route.ts` — same, remove lines 5–14.
- `app/reports/profit-loss/page.tsx` — currently calls `/api/reports/profit-loss` with `start_date`/`end_date`; blocked code expects that and then looks up period by date range. Page would need to stay consistent with that (or be updated to pass `period_start` if we change the contract).
- `app/reports/balance-sheet/page.tsx` — same, calls `/api/reports/balance-sheet` with `as_of_date` (+ optional `start_date`/`end_date`). No route change needed if 410 is removed.

**Auth/role changes**
- None in the routes. Blocked code uses `getCurrentBusiness(supabase, user.id)` and does not re-check role; any logged-in user with a business can hit the report. So **every** user (including non-owners) could see P&L/BS for their current business. To restrict to “service owners only” you’d need to add a role check (e.g. `getUserRole` and allow only owner/admin) in these two routes.

**Risk**
- **HIGH** if 410 is removed with no other changes: operational routes use `getCurrentBusiness` and do not enforce “owner or accountant.” Anyone with a business could view reports.
- **MEDIUM** even with an added owner-only check: period existence is not guaranteed for service-only businesses. If there are no `accounting_periods`, the existing logic returns 404 “No accounting period found,” and the UI shows an error or empty state. So you must also ensure at least one period exists (bootstrap or lazy init).
- **LOW** for retail: retail does not call `/api/reports/profit-loss` or `/api/reports/balance-sheet`; it uses other flows. So removing 410 does not directly affect retail, but any new role or period logic must not touch retail-only paths.

---

### Option B: Keep 410 but route service UI to `/accounting/reports/...` with expanded access rules

**Idea:** Leave operational report APIs returning 410. Change the **service** sidebar (and any direct links) so “Profit & Loss” and “Balance Sheet” open the **accounting** report pages at `/accounting/reports/profit-and-loss` and `/accounting/reports/balance-sheet`. Access is already granted to `owner` in those routes; ensure period listing and bootstrap work for service owners.

**Exact files/routes impacted**
- `components/Sidebar.tsx` — in the **service** menu (e.g. FINANCE & REPORTING), change:
  - “Profit & Loss” from `route: "/reports/profit-loss"` to `route: "/accounting/reports/profit-and-loss"`.
  - “Balance Sheet” from `route: "/reports/balance-sheet"` to `route: "/accounting/reports/balance-sheet"`.
- `app/accounting/reports/profit-and-loss/page.tsx` — no change if it already uses `getCurrentBusiness` → `businessId` and calls `GET /api/accounting/reports/profit-and-loss?business_id=...` and `GET /api/accounting/periods?business_id=...`.
- `app/accounting/reports/balance-sheet/page.tsx` — same.
- `app/api/accounting/reports/profit-and-loss/route.ts` — already allows `userRole === "owner"`. No change for “allow owner.”
- `app/api/accounting/reports/balance-sheet/route.ts` — same.
- `app/api/accounting/periods/route.ts` — uses `can_accountant_access_business`; comment in migration 105 says business owners get `write`. So owner can list periods. If a service business has **no** periods, the list is empty and the report page has no period to run on — so either:
  - Add a bootstrap step (e.g. when report or period list is first loaded for that business, call `initialize_business_accounting_period(business_id)` if the list is empty), or
  - Document that service businesses need at least one period (e.g. created in Accounting or by a one-off back office step).

**Auth/role changes**
- None required for “owner sees P&L/BS”: accounting report routes and `can_accountant_access_business` already treat owner as having access. No new roles.

**Risk**
- **LOW** for ledger and retail: no change to posting or to retail-only APIs. Same RPCs and same data as today.
- **MEDIUM** for UX if no bootstrap: service-only businesses with no periods see an empty period list and cannot run a report until something creates a period. Mitigation: one-time or lazy call to `initialize_business_accounting_period` when `business_id` has zero periods (see “Minimum patch set”).
- **LOW** for invariants: reports remain read-only and period-based; no new write paths.

---

### Option C: Create service-owner report endpoints that read the same accounting RPCs

**Idea:** Add new routes, e.g. `GET /api/service/reports/profit-and-loss` and `GET /api/service/reports/balance-sheet`, which (a) resolve business from the current user (e.g. `getCurrentBusiness`), (b) enforce “service workspace + owner (or admin),” (c) resolve or bootstrap a period, (d) call the same RPCs as the accounting reports (`get_profit_and_loss_from_trial_balance`, `get_balance_sheet_from_trial_balance`), (e) return the same shape as the accounting report APIs. Service UI then points to these new routes (or to pages that call them).

**Exact files/routes impacted**
- **New:** `app/api/service/reports/profit-and-loss/route.ts` — GET, resolve business, enforce owner/admin, resolve period (or call `initialize_business_accounting_period` when none), then `supabase.rpc("get_profit_and_loss_from_trial_balance", { p_period_id })`, map to same response shape as accounting P&L.
- **New:** `app/api/service/reports/balance-sheet/route.ts` — same for balance sheet RPC.
- **New or reused:** Service report pages that call these endpoints (or reuse existing report components with a “service” backend URL). Alternatively, keep existing `/reports/profit-loss` and `/reports/balance-sheet` **pages**, but have them call the new service report APIs instead of the blocked operational APIs.
- **Sidebar:** Service “Profit & Loss” / “Balance Sheet” could point to `/reports/profit-loss` and `/reports/balance-sheet` if those pages are updated to use the new service APIs; or to new service-specific report pages.

**Auth/role changes**
- New routes must enforce “current user is owner or admin of the resolved business” (e.g. `getUserRole(supabase, user.id, businessId)` and allow only owner/admin). Optionally restrict to “service” industry so the route is never used for retail reporting.

**Risk**
- **LOW** for ledger and retail: no change to posting; retail does not call these endpoints. Duplication of “resolve business + period, call RPC, shape response” is small and isolated.
- **MEDIUM** for maintenance: two report paths (accounting vs service) must stay in sync on response shape and RPC usage. Clear comments and shared types help.
- **LOW** for invariants: read-only, same RPCs and period discipline.

---

### Option comparison table

| Dimension | A: Remove 410, reuse operational route | B: Route UI to accounting reports | C: New service report APIs |
|----------|----------------------------------------|-----------------------------------|-----------------------------|
| **Files touched** | `app/api/reports/profit-loss/route.ts`, `app/api/reports/balance-sheet/route.ts` (remove 410; optionally add role check). Possibly report pages if params change. | `components/Sidebar.tsx` (service links). Optionally `app/api/accounting/periods` or report/period call site for period bootstrap. | New `app/api/service/reports/profit-and-loss/route.ts`, `app/api/service/reports/balance-sheet/route.ts`; optional new or updated report pages; optional sidebar. |
| **Auth/role** | Today: none (any user with business). Safe path: add owner/admin check in those two routes. | No change. Owner already allowed in accounting report + period APIs. | New: enforce owner/admin (and optionally service-only) in new routes. |
| **Period handling** | Unchanged: period lookup by date → 404 if no period. Needs separate bootstrap for service. | Use existing accounting pages/APIs; add bootstrap when business has no periods (in period list or report entry). | New routes implement “resolve or bootstrap period” then call RPC. |
| **Risk level** | **HIGH** if 410 removed with no role/period work; **MEDIUM** with role + period bootstrap. | **LOW**; only **MEDIUM** if period bootstrap is done in a new place. | **LOW**; duplicated logic is **MEDIUM** maintenance. |
| **Retail impact** | None (retail doesn’t use these routes). | None. | None. |
| **Reversibility** | Re-add 410 and restore “blocked” behavior. | Revert sidebar links to `/reports/profit-loss` and `/reports/balance-sheet`. | Remove new routes and revert UI to old targets. |

---

## 2. Posting invariants (service)

What must hold so P&L/BS stay trustworthy for service:

- **When should invoice posting happen (draft vs sent)?**  
  - **Keep current behavior:** Post only when status is **sent** (or paid/partially_paid). Draft must not post.  
  - **Rationale:** Revenue is recognized when the invoice is issued (sent), not when it’s created. Aligns with “invoice sent” as the economic event.

- **Period creation for service:**  
  - **Today:** No automatic period creation for service. `initialize_business_accounting_period` exists and is used in **retail** onboarding only.  
  - **For owner P&L/BS:** Service needs at least one period. Options: (1) Call `initialize_business_accounting_period(business_id)` when a service owner first opens reports (or when listing periods returns empty), or (2) Require period creation via Accounting UI / back office. (1) is minimal and reversible.

- **Payment posting period guard:**  
  - **Today:** `post_invoice_payment_to_ledger` does **not** call `assert_accounting_period_is_open`. Invoice posting does.  
  - **Invariant:** Payments should post only when the period for the **payment date** (or the related invoice’s issue_date, as a policy choice) is open.  
  - **Recommendation:** Add the same guard to payment posting (e.g. `assert_accounting_period_is_open(business_id, payment.date)`) so that (a) you never get “payment posted, invoice not,” and (b) payments don’t land in closed periods. Exact date (payment vs invoice) is a policy choice; using `payment.date` is consistent and simple.

- **Overpayment behavior:**  
  - **Current schema:** No “unapplied cash” or “customer advance” table. `payments` has `amount` and `invoice_id`; remaining balance is `invoice.total - payments - applied credit_notes`.  
  - **Current app behavior:** `/api/payments/create` rejects when `amountNum > remainingRounded` (400).  
  - **Options:** (1) **Reject overpayment** — keep current behavior; no schema change. (2) **Record as unapplied/advance** — would need new schema (e.g. unapplied_cash, or payment allocation model) and allocation logic; out of scope for “minimum” change.  
  - **Recommendation for minimum safe design:** Keep **reject overpayment**. No new tables. If product wants “accept and track as advance,” that’s a separate change with schema and posting design.

---

## 3. Failure cases (current code, unpatched)

Using current code only, what goes wrong in each scenario if we unblock P&L/BS for service without other patches:

| Scenario | Expected wrong result if unpatched |
|----------|------------------------------------|
| **Draft invoice exists, not sent** | Invoice never runs through `post_invoice_to_ledger`. No revenue, no AR, no tax in ledger. P&L shows **revenue understated** (or zero for that invoice). Balance sheet shows **AR understated**. |
| **Invoice send fails (closed or missing period)** | `assert_accounting_period_is_open` raises in `post_invoice_to_ledger`. Trigger fails; status update may roll back. If it still flips to “sent” in app, ledger has no entry. **Operational view:** “sent.” **Ledger:** no revenue/AR/tax. P&L/BS **understate** that invoice. |
| **Payment succeeds while invoice posting failed** | Payment insert runs; `post_invoice_payment_to_ledger` has no period check, so it posts (AR credit, cash debit). Invoice never posted (e.g. period closed), so AR was never debited. **Result:** AR goes negative or misstated; cash is overstated relative to true receivables. Trial balance can still balance (debits = credits) but **AR and linkage to revenue are wrong**. |
| **Order → invoice conversion then send (invoice_number timing)** | Convert creates draft by default; send later updates status to “sent” and assigns `invoice_number` (send route now generates it if missing). So **invoice_number** is fine if send route is used. If “send” is done by a path that doesn’t set status to sent or doesn’t generate number, you can get “sent” without number or without posting — already addressed by the prior invoice_number + send-route fixes. For **posting** specifically: convert (draft) → no post; send → post. So the only wrong result left is “sent without invoice_number” if some legacy path still does that. |
| **Overpayment attempt** | With current validation, `POST /api/payments/create` returns 400 and no payment row is created. So **no** wrong P&L/BS from overpayment today. If that check were removed, the payment would post in full → AR over-credited, cash over-debited → **AR/cash and “outstanding” logic wrong**. |

---

## 4. Minimum patch set (no code yet)

Smallest ordered set of changes to let service owners view P&L/BS safely.

---

### Step 1 — Route service UI to accounting reports (Option B)

- **What:** In the **service** section of the sidebar, set “Profit & Loss” and “Balance Sheet” to the accounting report routes.
- **Where:** `components/Sidebar.tsx`, same block where `businessIndustry === "service"` and FINANCE & REPORTING items are defined (e.g. “Profit & Loss”, “Balance Sheet”).
- **Change:** Set `route` for those two items to `"/accounting/reports/profit-and-loss"` and `"/accounting/reports/balance-sheet"` (replace current `/reports/profit-loss` and `/reports/balance-sheet`).
- **Why:** Service owners already have access to those accounting routes via `userRole === "owner"`. One-click from the service menu to the same reports accountants use, with no change to posting or ledger.
- **How to test:** As a service business owner, open sidebar, click Profit & Loss and Balance Sheet. You should land on the accounting report pages and, if the business has periods, load P&L/BS. If the business has no periods, you get empty period list and cannot run a report (addressed in Step 2).

---

### Step 2 — Ensure at least one period for service when listing periods (bootstrap)

- **What:** When a service business has zero accounting periods, ensure one period exists before returning the list (or before running the report).
- **Where (choose one):**  
  - **2a)** `app/api/accounting/periods/route.ts` — in GET, after `can_accountant_access_business` and before querying `accounting_periods`, if the count for that `business_id` is 0, call `supabase.rpc("initialize_business_accounting_period", { p_business_id: businessId })`, then run the same period query.  
  - **2b)** Or, in the accounting report route(s), when period lookup by `period_start` (or date range) returns no row, call `initialize_business_accounting_period(business_id)` and retry period lookup once (e.g. for “current month”).
- **Why:** Service-only businesses today have no automatic period creation. Reports require a period. Bootstrap is idempotent and only runs when there are no periods, so it doesn’t alter existing behavior for businesses that already have periods.
- **How to test:** Use a service business that has no rows in `accounting_periods`. Open Accounting reports (or period list). After the change, one period for the current month should exist and reports (or period dropdown) should work.

---

### Step 3 — Add period guard to payment posting (invariant)

- **What:** In `post_invoice_payment_to_ledger`, require that the period for the payment date is open before posting.
- **Where:** DB function `post_invoice_payment_to_ledger` (e.g. in `supabase/migrations/190_fix_posting_source_default_bug.sql` or a new migration that replaces/amends it). Add, after resolving `business_id_val` and before building the journal entry, something equivalent to:  
  `PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date::DATE);`
- **Why:** Prevents “payment posted, invoice not” when the invoice’s period is closed. Keeps payment posting aligned with period rules and avoids AR/cash distortion.
- **How to test:** (1) Close the period that contains the invoice’s `issue_date`. (2) Try to record a payment for that invoice. Payment insert trigger calls `post_invoice_payment_to_ledger` → it should raise and the payment insert should fail or roll back. (3) With an open period, payment for the same invoice should still post.

---

### Step 4 (optional) — Keep overpayment rejected

- **What:** No change; keep existing validation in `app/api/payments/create/route.ts`: `amountNum > remainingRounded` → 400.
- **Where:** Already implemented there.
- **Why:** Avoids posting overpayments and misstating AR/cash. Schema has no unapplied-cash model; “minimum” design keeps current behavior.
- **How to test:** Send a payment with `amount` greater than remaining balance; response must be 400 with a clear “exceeds remaining balance” message.

---

### Step 5 (optional) — Explicit “owner or accountant” on operational report routes

- **What:** If you ever **remove** the 410 from `/api/reports/profit-loss` and `/api/reports/balance-sheet` (e.g. for a different UX path), add an explicit check in those routes: resolve business, then allow only when `getUserRole(supabase, user.id, businessId)` is `owner` or `admin` (or when `can_accountant_access_business` returns truthy). Otherwise 403.
- **Where:** `app/api/reports/profit-loss/route.ts`, `app/api/reports/balance-sheet/route.ts` (only if 410 is removed).
- **Why:** Stops non-owners (e.g. staff with “current business” but not owner) from viewing P&L/BS via those endpoints.
- **How to test:** As a non-owner user with access to the same business, call those GETs with the same query params; expect 403.

---

Recommended **minimum** for “service owners see P&L/BS safely”: **Step 1 + Step 2**. Step 3 is needed for **correctness** of posting (no payment-without-invoice in closed periods). Steps 4 and 5 are defensive and optional in the minimal set.

---

## 5. Test checklist (service workspace only)

Use this to validate behavior after applying the minimal patch set (Steps 1–2, and 3 if implemented).

- **Navigation (Step 1)**  
  - [ ] As service owner, “Profit & Loss” in sidebar opens `/accounting/reports/profit-and-loss`.  
  - [ ] “Balance Sheet” opens `/accounting/reports/balance-sheet`.  
  - [ ] No 410 from those pages; they load using existing accounting APIs.

- **Period bootstrap (Step 2)**  
  - [ ] Service business with **no** `accounting_periods`: after opening P&L or period list, at least one period exists for that business.  
  - [ ] Service business that **already has** periods: no extra periods created; list unchanged.  
  - [ ] Retail business: no change in period creation or reporting.

- **Posting (Step 3, if applied)**  
  - [ ] Invoice in a **closed** period: “Send” fails (unchanged).  
  - [ ] Payment for that same invoice: payment **insert** fails or is rejected by the trigger when the payment’s period (or the invoice’s) is closed.  
  - [ ] Payment for an invoice in an **open** period: still succeeds and appears in ledger and reports.

- **Overpayment (Step 4 — existing behavior)**  
  - [ ] `POST /api/payments/create` with `amount` > remaining balance returns 400.  
  - [ ] No new row in `payments` and no new journal entry for that request.

- **Regressions**  
  - [ ] Retail flows (POS, sales, retail onboarding) unchanged.  
  - [ ] Accounting workspace: accountants and owners can still open P&L/BS and list periods as today.  
  - [ ] Draft invoice still does not post; sending still posts and respects period open check.

---

**Document:** `SERVICE_OWNER_PNL_BS_DESIGN.md`  
**Scope:** Minimum safe design for service-owner P&L/BS access.  
**No implementation performed.**
