# RLS Policy Audit — journal_entries, journal_entry_lines, invoices, payments, sales, expenses

**Scope:** Row Level Security policies on the six tables. Detection of `USING (true)` / `WITH CHECK (true)` and other bypass patterns. Output: risk list.

---

## 1. Summary by Table

| Table | RLS enabled | Bypass (USING true / equivalent) | Notes |
|-------|-------------|-----------------------------------|------|
| **journal_entries** | Yes (043) | **Yes** — allow_all_* from 051 | See §2.1 |
| **journal_entry_lines** | Yes (043) | **Yes** — allow_all_* from 051 | See §2.2 |
| **invoices** | Yes (032/034) | No | business_users scoped (034) |
| **payments** | Yes (157/159) | No | business_users scoped |
| **sales** | Yes (157/159) | No | business_users scoped |
| **expenses** | Yes (051/230) | **Yes** — allow_all_* from 051 not dropped | See §2.6 |

---

## 2. Detail and Evidence

### 2.1 journal_entries

- **043_accounting_core.sql:** RLS enabled. Policies: "Users can view journal entries for their business" (SELECT, `businesses.owner_id = auth.uid()`), "Users can insert journal entries for their business" (INSERT, same check). No UPDATE/DELETE policy; 222 later REVOKEs UPDATE, DELETE from anon and authenticated.
- **051_fix_all_table_structures.sql:** Loop over tables including `'journal_entries'` creates:
  - `allow_all_select_journal_entries` — `FOR SELECT USING (true)`
  - `allow_all_insert_journal_entries` — `FOR INSERT WITH CHECK (true)`
  - `allow_all_update_journal_entries` — `FOR UPDATE USING (true)`
  - `allow_all_delete_journal_entries` — `FOR DELETE USING (true)`
  (UPDATE/DELETE are then ineffective for anon/authenticated due to 222 REVOKE, but SELECT and INSERT remain governed by policies; with USING (true) any authenticated user can SELECT and INSERT.)
- **161_drop_non_compliant_policies.sql:** Does **not** drop any policy on `journal_entries`. No later migration drops `allow_all_*_journal_entries`.

**Risk:** Any authenticated user can read all rows and insert arbitrary rows into `journal_entries` (cross-tenant data leak and ledger pollution). **Critical.**

---

### 2.2 journal_entry_lines

- **043_accounting_core.sql:** RLS enabled. SELECT/INSERT policies scoped via `journal_entries` → `businesses.owner_id = auth.uid()`.
- **051:** Same loop includes `'journal_entry_lines'` → creates `allow_all_select_journal_entry_lines`, `allow_all_insert_journal_entry_lines`, etc. with `USING (true)` / `WITH CHECK (true)`.
- **161:** No drop for journal_entry_lines. No later migration drops these policies.

**Risk:** Any authenticated user can read all journal entry lines and insert rows (cross-tenant leak and ledger corruption). **Critical.**

---

### 2.3 invoices

- **032 / 034:** RLS and policies "Users can view/insert/update/delete invoices for their business" using `business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())` (034). No `USING (true)`.
- **051:** The loop in 051 does **not** include `invoices` (list is expenses, bills, bill_items, bill_payments, credit_notes, ..., journal_entries, journal_entry_lines only). So no allow_all_* policies are created for invoices.

**Risk:** No bypass detected. **Low** (assuming business_users is correctly maintained).

---

### 2.4 payments

- **157_multi_tenant_rls_enforcement_fixed.sql / 159:** Policies "Users can view/insert/update/delete payments for their business" with `EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = payments.business_id AND bu.user_id = auth.uid())`.
- **051:** `payments` is not in the 051 loop. No allow_all_* for payments.

**Risk:** No bypass detected. **Low.**

---

### 2.5 sales

- **157 / 159:** Same pattern as payments — business_users-based policies. `sales` not in 051 loop.

**Risk:** No bypass detected. **Low.**

---

### 2.6 expenses

- **051:** (1) If table `expenses` already exists, 051 replaces policies with "AUTH DISABLED" — `USING (true)` and `WITH CHECK (true)` for SELECT, INSERT, UPDATE, DELETE (policies named "Users can view expenses for their business" etc.). (2) The same migration’s loop also includes `'expenses'` and creates `allow_all_select_expenses`, `allow_all_insert_expenses`, etc. with `USING (true)` / `WITH CHECK (true)`.
- **230_expenses_rls_canonical.sql:** DROPs only legacy-named policies ("Users can view expenses for their business", "business members can insert expenses", etc.) and recreates "business members can *" with proper `EXISTS (business_users)`. It does **not** DROP `allow_all_select_expenses`, `allow_all_insert_expenses`, `allow_all_update_expenses`, `allow_all_delete_expenses`.
- **161:** Does not drop any policy on `expenses`.

**Risk:** After 230, both "business members can *" and allow_all_* exist. Permissive RLS ORs them, so `USING (true)` allows any authenticated user to read/update/delete all expenses and allow_all_insert allows any user to insert. **High.**

---

## 3. Other USING (true) / Bypass in Repo (not on the six tables)

- **044_audit_logging.sql:** "System can insert audit logs" on `audit_logs` — `WITH CHECK (true)`. Intentional for trigger/system use; still a bypass for INSERT.
- **051:** `expense_categories` gets full allow_all_* (USING/CHECK true). Not in the requested six tables.
- **079:** `automations` — allow_all_* (true). Not in the six.
- **161:** Drops allow_all for audit_logs, automations, bank_transactions, bills, bill_items, bill_payments only; leaves journal_entries, journal_entry_lines, expenses (and accounts, etc.) with allow_all if 051 applied to them.

---

## 4. Risk List (Requested Six Tables Only)

| # | Table | Finding | Severity | Recommendation |
|---|--------|---------|----------|----------------|
| 1 | **journal_entries** | Policies `allow_all_select_journal_entries`, `allow_all_insert_journal_entries` (and update/delete) from 051 use `USING (true)` / `WITH CHECK (true)`. Never dropped. Together with 043 policies, any authenticated user can SELECT all and INSERT any row. | **Critical** | Drop all `allow_all_*_journal_entries` policies. Rely on 043 owner-based (or replace with business_users/owner + firm) and 222 REVOKE for UPDATE/DELETE. |
| 2 | **journal_entry_lines** | Same: `allow_all_*_journal_entry_lines` from 051 with true. Never dropped. Cross-tenant read and insert. | **Critical** | Drop all `allow_all_*_journal_entry_lines` policies. Keep or add proper scoping via journal_entries → business. |
| 3 | **expenses** | `allow_all_select_expenses`, `allow_all_insert_expenses`, `allow_all_update_expenses`, `allow_all_delete_expenses` from 051 never dropped. 230 adds business-member policies but does not remove allow_all_*. Result: full bypass. | **High** | Drop `allow_all_select_expenses`, `allow_all_insert_expenses`, `allow_all_update_expenses`, `allow_all_delete_expenses`. Rely on 230 "business members can *" only. |
| 4 | **invoices** | No USING (true) or allow_all. Policies scoped by business_users (034). | Low | None for this audit. |
| 5 | **payments** | No bypass. business_users-scoped (157/159). | Low | None for this audit. |
| 6 | **sales** | No bypass. business_users-scoped (157/159). | Low | None for this audit. |

---

## 5. Recommended Remediation (Migration Sketch)

- **journal_entries:**  
  `DROP POLICY IF EXISTS "allow_all_select_journal_entries" ON journal_entries;`  
  `DROP POLICY IF EXISTS "allow_all_insert_journal_entries" ON journal_entries;`  
  `DROP POLICY IF EXISTS "allow_all_update_journal_entries" ON journal_entries;`  
  `DROP POLICY IF EXISTS "allow_all_delete_journal_entries" ON journal_entries;`  
  (Then confirm 043 SELECT/INSERT policies are sufficient or extend to business_users/firm as needed.)

- **journal_entry_lines:**  
  Same pattern: drop `allow_all_select_journal_entry_lines`, `allow_all_insert_journal_entry_lines`, `allow_all_update_journal_entry_lines`, `allow_all_delete_journal_entry_lines`.

- **expenses:**  
  `DROP POLICY IF EXISTS "allow_all_select_expenses" ON expenses;`  
  `DROP POLICY IF EXISTS "allow_all_insert_expenses" ON expenses;`  
  `DROP POLICY IF EXISTS "allow_all_update_expenses" ON expenses;`  
  `DROP POLICY IF EXISTS "allow_all_delete_expenses" ON expenses;`

(No code or migration files are created in this audit; the above is a remediation sketch only.)

---

## 6. File References

| Source | Path | Relevant content |
|--------|------|------------------|
| RLS + policies for journal_entries / journal_entry_lines | 043_accounting_core.sql (≈1177–1228) | Enable RLS; owner-based SELECT/INSERT |
| Allow-all policies for many tables | 051_fix_all_table_structures.sql (≈137–152 expenses branch; ≈614–639 loop) | USING (true) / WITH CHECK (true) for expenses, journal_entries, journal_entry_lines |
| REVOKE UPDATE/DELETE on ledger | 222_ledger_immutability_enforcement.sql | journal_entries, journal_entry_lines |
| Expenses canonical RLS | 230_expenses_rls_canonical.sql | Drops only legacy policy names; does not drop allow_all_* |
| Drop non-compliant policies | 161_drop_non_compliant_policies.sql | Does not include journal_entries, journal_entry_lines, expenses |
| Invoices RLS | 034_service_invoice_system_complete.sql (≈564–587) | business_users scoped |
| Payments/Sales RLS | 157_multi_tenant_rls_enforcement_fixed.sql, 159_rls_enforcement_phase_b.sql | business_users scoped |
