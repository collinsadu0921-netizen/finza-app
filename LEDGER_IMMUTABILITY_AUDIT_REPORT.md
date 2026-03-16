# Ledger immutability — database-layer audit report

**Scope:** Prove and enforce ledger immutability at the DATABASE layer (not just UI).  
**Tables:** `journal_entries`, `journal_entry_lines`, `trial_balance_snapshots`, `period_opening_balances`, `reconciliation_resolutions`.

---

## 1. Evidence summary

| Table | UPDATE/DELETE possible? | Enforcement | Location |
|-------|--------------------------|-------------|----------|
| **journal_entries** | **No** (blocked by trigger) | BEFORE UPDATE OR DELETE trigger raises; no UPDATE/DELETE RLS policies | 088, 156 |
| **journal_entry_lines** | **No** (blocked by trigger) | BEFORE UPDATE OR DELETE trigger raises; no UPDATE/DELETE RLS policies | 088, 156 |
| **trial_balance_snapshots** | **Yes** (no guard) | No RLS, no trigger; default grants allow UPDATE/DELETE | 169 |
| **period_opening_balances** | **No** (RLS + trigger) | RLS "cannot modify" + BEFORE UPDATE OR DELETE trigger | 086, 168 |
| **reconciliation_resolutions** | **Yes** (no guard) | No RLS, no trigger; append-only audit table | 221 |

---

## 2. journal_entries

**Schema:** `043_accounting_core.sql` — `CREATE TABLE journal_entries (...)`.

**RLS:** Enabled in 043. Policies:
- `"Users can view journal entries for their business"` — **FOR SELECT**
- `"Users can insert journal entries for their business"` — **FOR INSERT**
- **No UPDATE or DELETE policies** → RLS denies UPDATE/DELETE for `authenticated`/`anon`.

**Grants:** No explicit `REVOKE` in migrations. Supabase default typically grants full privileges to `anon`, `authenticated`, `service_role`. So `authenticated` may still have UPDATE/DELETE privilege; RLS denies at row level. `service_role` bypasses RLS and would have UPDATE/DELETE privilege.

**Triggers:**
- `088_hard_db_constraints_ledger.sql`: `trigger_prevent_journal_entry_modification` — **BEFORE UPDATE OR DELETE** → `prevent_journal_entry_modification()` raises.
- `156_enforce_journal_immutability.sql`: Same trigger (idempotent recreate).

**Conclusion:** UPDATE/DELETE are **blocked for all roles** by the trigger (including `service_role`). No soft-delete; no void/reversal by editing rows. Reversals are done by **new** journal entries (e.g. refund/void posting creates new JE with reversed amounts).

---

## 3. journal_entry_lines

**Schema:** `043_accounting_core.sql` — `CREATE TABLE journal_entry_lines (...)`; `journal_entry_id ... ON DELETE CASCADE`.

**RLS:** Enabled in 043. Policies:
- `"Users can view journal entry lines for their business"` — **FOR SELECT**
- `"Users can insert journal entry lines for their business"` — **FOR INSERT**
- **No UPDATE or DELETE policies** → RLS denies UPDATE/DELETE for `authenticated`/`anon`.

**Grants:** Same as above; no explicit REVOKE.

**Triggers:**
- `088_hard_db_constraints_ledger.sql`: `trigger_prevent_journal_entry_line_modification` — **BEFORE UPDATE OR DELETE** → `prevent_journal_entry_line_modification()` raises.
- `156_enforce_journal_immutability.sql`: Same.

**Conclusion:** UPDATE/DELETE **blocked for all roles** by trigger. Corrections only via new JEs (adjustment journals, reversals).

---

## 4. trial_balance_snapshots

**Schema:** `169_trial_balance_canonicalization.sql` — `CREATE TABLE trial_balance_snapshots (...)`; populated by `generate_trial_balance()`.

**RLS:** **Not enabled** in 169. No policies.

**Grants:** Default table grants → UPDATE/DELETE allowed for roles with table access.

**Triggers:** None.

**Conclusion:** UPDATE/DELETE **are possible** for any role that can access the table. **Remediation:** REVOKE UPDATE, DELETE from `anon` and `authenticated` only. No trigger: `generate_trial_balance()` uses `ON CONFLICT (period_id) DO UPDATE` and runs with `service_role`; that path must remain allowed.

---

## 5. period_opening_balances

**Schema:** `086_carry_forward_opening_balances.sql` — `CREATE TABLE period_opening_balances (...)`; populated by `create_period_opening_balances()` / `generate_opening_balances()`.

**RLS:** Enabled in 086. Policies:
- `"Users can view opening balances for their business"` — **FOR SELECT**
- `"Users cannot modify opening balances"` — **FOR ALL** with `USING (FALSE)` and `WITH CHECK (FALSE)` → denies INSERT/UPDATE/DELETE for rows (INSERT denied by WITH CHECK).

**Grants:** No explicit REVOKE. `service_role` bypasses RLS and can INSERT (used by system functions).

**Triggers:** `168_opening_balances_rollforward_invariants.sql` — `trigger_enforce_opening_balance_immutability` — **BEFORE UPDATE OR DELETE** → `enforce_opening_balance_immutability()` raises.

**Conclusion:** UPDATE/DELETE **blocked**: RLS for non–service roles; trigger blocks **all** roles (including `service_role`). No remediation needed.

---

## 6. reconciliation_resolutions

**Schema:** `221_reconciliation_resolutions.sql` — `CREATE TABLE reconciliation_resolutions (...)`; audit log for approved reconciliation fixes.

**RLS:** **Not enabled.** No policies.

**Grants:** Default → UPDATE/DELETE allowed.

**Triggers:** None.

**Conclusion:** UPDATE/DELETE **are possible**. Table is append-only by design. **Remediation:** add BEFORE UPDATE OR DELETE trigger to enforce append-only at DB layer.

---

## 7. Reversals and void

- **Refund/void:** Implemented as **new** journal entries (e.g. `post_sale_refund_to_ledger`, `post_sale_void_to_ledger` in 191, 192). New rows in `journal_entries` / `journal_entry_lines` with reversed amounts; `reference_type` e.g. `sale_refund`.
- **No** UPDATE/DELETE or soft-delete of existing JE/JEL rows for reversals. Immutability triggers enforce this.

---

## 8. Recommendations implemented in migration 222

1. **journal_entries / journal_entry_lines:** Add **REVOKE UPDATE, DELETE** for `anon` and `authenticated` (defense in depth; triggers already block everyone including `service_role`).
2. **trial_balance_snapshots:** **REVOKE UPDATE, DELETE** for `anon`, `authenticated` only (no trigger so `generate_trial_balance()` with service_role can still use ON CONFLICT DO UPDATE).
3. **reconciliation_resolutions:** Add **BEFORE UPDATE OR DELETE** trigger to block modifications (append-only audit log).
4. **period_opening_balances:** No change (already protected).
5. **Reversals:** No schema change; documented that reversals are new JEs only (no modification of existing lines).

---

## 9. Verification checklist

After applying migration `222_ledger_immutability_enforcement.sql`:

### A. Triggers present

```sql
-- Run as superuser or table owner
SELECT tgname, tgrelid::regclass, tgtype
FROM pg_trigger
WHERE tgrelid IN (
  'journal_entries'::regclass,
  'journal_entry_lines'::regclass,
  'trial_balance_snapshots'::regclass,
  'period_opening_balances'::regclass,
  'reconciliation_resolutions'::regclass
)
AND tgname LIKE '%prevent%' OR tgname LIKE '%enforce_opening_balance%';
```

- Expect: `trigger_prevent_journal_entry_modification`, `trigger_prevent_journal_entry_line_modification`, `trigger_enforce_opening_balance_immutability`, `trigger_prevent_reconciliation_resolution_modification`. (No trigger on `trial_balance_snapshots` — regeneration uses service_role.)

### B. UPDATE/DELETE blocked (all roles)

```sql
-- As service_role (e.g. from API), expect ERROR from trigger for JE/JEL/reconciliation_resolutions
UPDATE journal_entries SET description = 'x' WHERE id = (SELECT id FROM journal_entries LIMIT 1);
UPDATE journal_entry_lines SET debit = 0 WHERE id = (SELECT id FROM journal_entry_lines LIMIT 1);
UPDATE reconciliation_resolutions SET delta_before = 0 WHERE id = (SELECT id FROM reconciliation_resolutions LIMIT 1);
-- trial_balance_snapshots: service_role may still UPDATE (generate_trial_balance uses ON CONFLICT DO UPDATE)
```

- Expect: First three statements raise an exception (immutability message). Roll back after test. As `authenticated`, UPDATE on trial_balance_snapshots should be denied by privilege.

### C. Privileges (anon / authenticated)

```sql
SELECT grantee, table_name, privilege
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('journal_entries', 'journal_entry_lines', 'trial_balance_snapshots', 'reconciliation_resolutions')
  AND privilege IN ('UPDATE', 'DELETE')
ORDER BY table_name, grantee;
```

- Expect: No rows for `grantee IN ('anon', 'authenticated')` for these tables (or only `service_role` if present).

### D. INSERT still allowed (service path)

- Post a journal entry via `post_journal_entry` (or app flow): must succeed.
- Call `generate_trial_balance(period_id)`: must succeed and INSERT/REPLACE snapshot.
- POST `/api/accounting/reconciliation/resolve`: must succeed and INSERT into `reconciliation_resolutions`.

### E. Reversals are new rows only

- Confirm no code path UPDATEs or DELETEs `journal_entries` / `journal_entry_lines` for corrections.
- Refunds/voids create new JEs (e.g. `reference_type = 'sale_refund'`); no modification of original JE rows.
