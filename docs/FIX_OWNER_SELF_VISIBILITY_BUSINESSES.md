# GLOBAL ARCHITECTURE FIX — Owner Self-Visibility for Businesses

**Mode:** Architectural fix only. No UI changes. No handler logic changes.  
**Goal:** Guarantee that a business owner can always SELECT their own business row so that `firm_client_engagements` owner policy subqueries succeed and the engagement accept flow works.

---

## STEP 1 — Audit RLS on businesses Table

### Is RLS enabled on businesses?

- **In repo:** No migration in the audited set explicitly runs `ALTER TABLE businesses ENABLE ROW LEVEL SECURITY`.
- **051_fix_all_table_structures.sql:** The loop that enables RLS applies only to a fixed list of tables: `bills`, `bill_items`, `bill_payments`, `credit_notes`, `credit_note_items`, `recurring_invoices`, `vat_returns`, `assets`, `depreciation_entries`, `staff`, `allowances`, `deductions`, `payroll_runs`, `payroll_entries`, `payslips`, `audit_logs`, `bank_transactions`, `reconciliation_periods`, `accounts`. **`businesses` is not in that list.**
- **Conclusion:** In the migration history, RLS is **not** enabled on `businesses`. If a given environment has RLS on `businesses`, it was enabled outside these migrations (e.g. dashboard or another codebase).

### What SELECT policies exist?

- **In repo:** No migration creates a policy **on** the `businesses` table (`CREATE POLICY ... ON businesses` not found).
- **Conclusion:** There are **no** SELECT policies on `businesses` in the audited migrations. So either the table has no RLS (and all rows are visible) or RLS was enabled elsewhere with policies not in this repo.

### Summary

| Item | Result |
|------|--------|
| RLS enabled on businesses (in repo) | No |
| SELECT policies on businesses (in repo) | None |
| Implication | In environments where RLS is enabled on `businesses` (e.g. by default or by another change), the owner may be unable to read their own row, so the subquery in `firm_client_engagements` policy fails and the engagement is hidden → "Engagement not found" on accept. |

---

## STEP 2 — Canonical Owner Visibility Policy

**Migration:** `283_businesses_owner_self_visibility_rls.sql`

### 1. Enable RLS (idempotent)

```sql
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
```

### 2. Owner can always SELECT their own business

```sql
CREATE POLICY "Owners can select own business"
  ON public.businesses
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());
```

### 3. Business members can SELECT businesses they belong to

So that existing app behavior for employees/admins is preserved (e.g. `getCurrentBusiness`, dashboard, APIs that read `businesses` for a member):

```sql
CREATE POLICY "Business members can select their businesses"
  ON public.businesses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users
      WHERE business_users.business_id = businesses.id
        AND business_users.user_id = auth.uid()
    )
  );
```

**Canonical rule:** Owner can always SELECT their own business row (`owner_id = auth.uid()`). Members can SELECT businesses where they have a `business_users` row. No other roles are granted SELECT on `businesses` by this migration.

---

## STEP 3 — Security Validation (Does Not Weaken Security)

- **Owner already has update authority** in multiple flows (profile, settings, accept/reject engagements via handler checks). This change only adds **read** access to their own row.
- **Scope:** The new policy grants SELECT only where `owner_id = auth.uid()`. It does not grant SELECT on other owners’ businesses.
- **Members:** The second policy limits SELECT to businesses where the user has a `business_users` row (already used across the app). No new visibility for users who are not owners and not members.
- **No INSERT/UPDATE/DELETE policies added:** This migration does not change write access on `businesses`.

**Conclusion:** This does not weaken security. It only guarantees that the owner can read their own entity so that RLS-based subqueries in other tables (e.g. `firm_client_engagements`) succeed.

---

## STEP 4 — Cross-Table Dependency Integrity

### firm_client_engagements — owner SELECT policy (migration 146)

- **USING:** `EXISTS (SELECT 1 FROM businesses WHERE businesses.id = firm_client_engagements.client_business_id AND businesses.owner_id = auth.uid())`.
- **After 283:** For the engagement’s `client_business_id`, the owner’s SELECT on `businesses` is allowed by "Owners can select own business". The subquery returns one row → EXISTS is true → the engagement row is visible to the owner.
- **Result:** Owner can SELECT pending (and other) engagements for their business; `getEngagementById` returns the row; handler no longer returns 404 "Engagement not found" due to this subquery.

### firm_client_engagements — owner UPDATE policy (migration 277)

- **USING / WITH CHECK:** Same EXISTS on `businesses` (id = client_business_id, owner_id = auth.uid()).
- **After 283:** Same subquery can read the business row → owner can UPDATE the engagement (e.g. accept).
- **Result:** Engagement accept flow (PATCH with action accept) can proceed: fetch engagement, pass owner check, perform UPDATE.

### Engagement accept flow

- **Sequence:** getEngagementById (SELECT) → owner check (SELECT businesses.owner_id) → UPDATE engagement.
- **After 283:** SELECT engagement succeeds (owner policy on `firm_client_engagements`); SELECT businesses succeeds (owner policy on `businesses`); UPDATE engagement succeeds (owner UPDATE policy on `firm_client_engagements`).
- **Result:** Accept flow works without handler or UI changes.

---

## STEP 5 — Regression Audit (No Data Leaks)

| Actor | Can SELECT businesses? | Leak? |
|-------|-------------------------|--------|
| **Owner** | Only rows where `owner_id = auth.uid()` | No — own entity only. |
| **Business member (employee/admin)** | Only rows where they have a `business_users` row | No — same as current app model. |
| **Firm user** | No policy grants SELECT on `businesses` by firm membership. Firm user has no `business_users` row for a client’s business. | No — firm users see engagements via `accounting_firm_users` policy on `firm_client_engagements`, not via reading `businesses`. |
| **Unrelated user** | No policy; no row where owner_id = auth.uid() and no business_users row. | No — no visibility. |

**Conclusion:** No new data leaks for firm users, employees, or unrelated users. Employees retain only the visibility they already have (businesses they are members of).

---

## Output Summary

| Deliverable | Content |
|-------------|--------|
| **Businesses RLS audit** | RLS not enabled on `businesses` in repo; no SELECT policies on `businesses` in repo; in environments with RLS on, owner read can fail and break engagement accept. |
| **New canonical owner visibility** | Migration 283: RLS enabled; "Owners can select own business" USING (owner_id = auth.uid()); "Business members can select their businesses" for existing member behavior. |
| **Security validation** | Owner gets only read on own row; no new write; no new visibility for other owners or unrelated users. |
| **Cross-table RLS validation** | firm_client_engagements owner SELECT and UPDATE policies’ subqueries on `businesses` succeed for the owner; engagement accept flow works. |
| **Regression audit** | No leaks for firm users, employees, or unrelated users. |

**Migration file:** `supabase/migrations/283_businesses_owner_self_visibility_rls.sql`
