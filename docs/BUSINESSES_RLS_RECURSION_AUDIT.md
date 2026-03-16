# BUSINESSES RLS RECURSION AUDIT

**Mode:** READ-ONLY forensic audit. No policies or migrations were modified.

**Goal:** Determine whether "infinite recursion detected in policy for relation businesses" is caused by cross-table RLS dependency between `public.businesses`, `public.business_users`, and related tables.

**Source:** Migration files under `supabase/migrations/` (no live DB queries).

---

## 1. Policies on businesses

All three policies are **FOR SELECT TO authenticated**. Full definitions as in migrations:

| policyname | cmd | qual (USING) | with_check |
|------------|-----|--------------|------------|
| **Owners can select own business** | SELECT | `owner_id = auth.uid()` | (none) |
| **Business members can select their businesses** | SELECT | `EXISTS ( SELECT 1 FROM public.business_users bu WHERE bu.business_id = businesses.id AND bu.user_id = auth.uid() )` | (none) |
| **Firm users can select engaged client businesses** | SELECT | `EXISTS ( SELECT 1 FROM firm_client_engagements fce INNER JOIN accounting_firm_users afu ON afu.firm_id = fce.accounting_firm_id AND afu.user_id = auth.uid() WHERE fce.client_business_id = businesses.id )` | (none) |

- **Owners can select own business** — No cross-table reference; uses only `businesses.owner_id` and `auth.uid()`.
- **Business members can select their businesses** — References **`public.business_users`** (subquery).
- **Firm users can select engaged client businesses** — References **`firm_client_engagements`** and **`accounting_firm_users`**; no reference to `business_users` or `businesses` itself.

---

## 2. Policies on business_users

**No RLS policies defined ON `business_users` in any migration.**

- No `CREATE POLICY ... ON business_users` (or `ON public.business_users`) appears in the repo.
- Migration **051** creates `business_users` but does **not** enable RLS on it; the migration’s RLS-enable loop only touches a fixed list (e.g. `bills`, `bill_items`, `credit_notes`, …) and does **not** include `business_users`.
- No later migration was found that adds RLS or policies to `business_users`.

**Conclusion from migrations:** Either `business_users` has RLS disabled, or RLS was enabled and policies added outside the audited migrations (e.g. manual or other repo). Within the audited migrations, there are **no policy definitions** on `business_users`, so no USING/WITH CHECK clauses to inspect for cross-table references.

---

## 3. Cross-table references

### From businesses policies

| Policy (on businesses) | References | Direction |
|------------------------|------------|-----------|
| Owners can select own business | (none) | — |
| Business members can select their businesses | **business_users** | businesses → business_users (SELECT in EXISTS) |
| Firm users can select engaged client businesses | **firm_client_engagements**, **accounting_firm_users** | businesses → fce, afu (SELECT in EXISTS) |

### From business_users policies

| Policy (on business_users) | References | Direction |
|----------------------------|------------|-----------|
| (none found) | — | — |

No policies on `business_users` were found in migrations, so no cross-table references from `business_users` are documented here. If the live DB has policies on `business_users` that reference `businesses` (or any table that eventually references `businesses`), that would need to be checked on the live instance.

### Other tables that reference business_users or businesses in RLS

- Many other tables (e.g. `expenses`, `trial_balance_snapshots`, `ledger_adjustment_policy`, `customers`, `layaway_plans`, …) have policies whose USING/WITH CHECK reference **business_users** and/or **businesses**. Those are not on `businesses` or `business_users` themselves and do not by themselves create a **businesses ↔ business_users** recursion; they are noted only for context.

---

## 4. Dependency graph

Edges are “table A’s RLS policy causes a SELECT (or check) on table B”.

- **businesses** → **business_users**  
  (policy “Business members can select their businesses” runs `EXISTS (SELECT 1 FROM public.business_users ...)`.)

- **businesses** → **firm_client_engagements**  
  (policy “Firm users can select engaged client businesses”.)

- **businesses** → **accounting_firm_users**  
  (same policy, via JOIN.)

No edge **business_users → businesses** (or → any table that leads back to businesses) was found in the migrations, because there are no policies defined ON `business_users`.

So, from the migrations alone:

- **business_users → businesses:** not present (no policy on `business_users`).
- **Cycle involving businesses and business_users:** not present in the audited definitions.

If in the live DB `business_users` has RLS enabled and a policy that references `businesses` (e.g. `EXISTS (SELECT 1 FROM businesses WHERE ...)`), then the graph would contain:

- businesses → business_users  
- business_users → businesses  

and that **would** form a cycle and could explain “infinite recursion detected in policy for relation businesses”.

---

## 5. SECURITY DEFINER usage

Functions that touch `businesses` or `business_users` and are relevant to RLS/recursion:

- **check_user_in_firm**, **check_user_is_partner_in_firm** (migration 152)  
  - **SECURITY DEFINER**; read **accounting_firm_users** only.  
  - Used by policies on **accounting_firm_users** and **accounting_firms**, not by any policy on `businesses` or `business_users`.  
  - Do not create a recursion path for businesses/business_users.

- **has_forensic_monitoring_access** (migration 256)  
  - **SECURITY DEFINER**; reads **accounting_firm_users**, **businesses**, **business_users**.  
  - Used by policies on **accounting_invariant_failures** only.  
  - Not used in any policy on `businesses` or `business_users`, so does not introduce recursion for those two tables.

- **ensure_accounting_initialized**, **create_system_accounts**, **initialize_business_accounting_period**, etc.  
  - **SECURITY DEFINER**; may read/write businesses and related tables.  
  - Not used as part of any RLS USING/WITH CHECK on `businesses` or `business_users` in the migrations.

No policy on `businesses` or `business_users` in the audited migrations calls a function that would create a recursive RLS path between these two tables.

---

## Recursion Detected

**NO** — From the audited migrations, the cycle businesses RLS → business_users SELECT → business_users RLS → businesses SELECT is **not** present because no RLS policy ON `business_users` was found. If the live DB has policies on `business_users` that reference `businesses`, recursion can occur at runtime.

---

## Exact Recursion Path

- **If recursion exists at runtime**, the path is:
  1. SELECT on `businesses` (e.g. getCurrentBusiness).
  2. Policy **"Business members can select their businesses"** runs; USING clause runs `EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = businesses.id AND bu.user_id = auth.uid())`.
  3. Engine executes SELECT on `business_users`.
  4. A policy ON `business_users` (not in migrations) runs and references `businesses` (e.g. EXISTS (SELECT 1 FROM businesses WHERE ...)).
  5. Engine re-enters `businesses` policies → goto step 2 → **infinite recursion**.

- **In migrations only:** No step 4 (no policy on `business_users`), so no loop.

---

## 6. Recursion proof test

**Question:** Does this cycle exist?

- businesses RLS → business_users SELECT  
- business_users RLS → businesses SELECT  

**Answer from migrations: NO** (cycle not present in the audited definitions).

- **businesses RLS → business_users SELECT:** **YES.**  
  Policy “Business members can select their businesses” on `businesses` contains:
  `EXISTS ( SELECT 1 FROM public.business_users bu WHERE bu.business_id = businesses.id AND bu.user_id = auth.uid() )`.  
  Evaluating that requires a SELECT on `business_users`.

- **business_users RLS → businesses SELECT:** **NOT FOUND in migrations.**  
  No policy ON `business_users` was found, so there is no documented USING/WITH CHECK on `business_users` that does a SELECT (or check) on `businesses`.

So the **exact two-step cycle** (businesses → business_users → businesses) is **not** present in the migration set. The “infinite recursion detected in policy for relation businesses” would **not** be explained by a businesses ↔ business_users cycle **unless** the live database has:

- RLS enabled on `business_users`, and  
- At least one policy on `business_users` whose expression references `businesses` (or a chain that leads back to `businesses`).

Recommended check on the live DB:

```sql
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'business_users';
```

If that returns rows and any of them reference `businesses` (e.g. in `qual` or `with_check`), then the cycle exists at runtime and can explain the recursion error.

---

## 7. Execution impact analysis

If a **businesses ↔ business_users** recursion were present at runtime:

- **getCurrentBusiness()**  
  Runs `SELECT * FROM businesses WHERE owner_id = ...` (and fallback paths). Evaluation of “Business members can select their businesses” would trigger a SELECT on `business_users`. If a policy on `business_users` then triggered a SELECT on `businesses`, the engine would re-enter `businesses` policies and hit “infinite recursion detected in policy for relation businesses”. Result: failure or abort of the query, and getCurrentBusiness could throw or return no row.

- **Login / app bootstrap**  
  Any path that calls getCurrentBusiness (e.g. ProtectedLayout, autoBindSingleStore) would be liable to the same failure when the “Business members” policy is evaluated (e.g. for a non-owner user whose membership is checked via `business_users`).

- **Engagement accept flow**  
  Depends on engagement and firm tables; not directly on businesses RLS. Indirect impact only if the same session later hits businesses (e.g. resolving client business name or context).

- **Invitations GET**  
  Depends on engagements/firms and possibly businesses for display. If any step does a SELECT on `businesses` and the recursion exists, that request could fail with the recursion error.

- **Accounting workspace client selection**  
  `/api/accounting/firm/clients` and context-check read `businesses` (and engagements). If recursion exists, those SELECTs on `businesses` could trigger the infinite recursion error and break client list or context resolution.

So **if** the cycle exists at runtime, impact is broad: any code path that queries `businesses` while the “Business members” policy is in play can abort with recursion, affecting login, layout, client dropdown, and any flow that uses getCurrentBusiness or firm client context.

---

## 8. Risk severity

- **Security risk:** Low from recursion itself. Recursion does not grant extra rows; it causes the query to abort. Misconfiguration (e.g. overly permissive policies added to fix recursion) could introduce security risk separately.

- **Availability risk:** **High** if recursion is present. Any authenticated request that triggers the businesses policy path involving `business_users` can fail with “infinite recursion detected in policy for relation businesses”, breaking dashboard, client selector, and getCurrentBusiness-dependent flows.

- **Multi-tenant isolation risk:** Low from recursion per se. Isolation is enforced by the same policies; recursion prevents them from completing rather than leaking data. If recursion is “fixed” by weakening or bypassing RLS without care, multi-tenant isolation could be reduced.

---

## Summary

- **businesses** has three SELECT policies; one references **business_users**, two reference **firm_client_engagements** and **accounting_firm_users**. No policy on businesses references `businesses` itself.
- **business_users** has **no** RLS policies defined in the audited migrations; no USING/WITH CHECK to reference `businesses` or others.
- So the **businesses ↔ business_users** cycle is **not** present in the migration set. The reported “infinite recursion detected in policy for relation businesses” is **not** proven to be caused by a businesses ↔ business_users dependency from these migrations alone.
- To confirm or disprove recursion in production, run the `pg_policies` query above for `business_users` and inspect whether any policy references `businesses` (or a chain back to businesses). If such a policy exists, the recursion path is: **businesses (“Business members can select their businesses”) → SELECT business_users → business_users policy → SELECT businesses → …**
