# Audit: Two Postgres errors in Supabase logs

**Scope:** Full codebase and all migrations. Audit only — no fixes applied.

---

## ERROR 1: column reference "journal_entry_id" is ambiguous

### What was searched

- All migrations and SQL: JOINs of `journal_entries` and `journal_entry_lines` (or other tables with a `journal_entry_id` column) and any use of `journal_entry_id` without a table/alias prefix.
- Reversal API and reporting code paths that touch ledger data.

### Most likely source: RLS policy on `journal_entry_lines`

**File:** `supabase/migrations/278_firm_engagement_ledger_periods_tbs_rls.sql`  
**Policy:** `"Firm users can view journal entry lines for engaged clients"`  
**Lines:** 36–51 (policy definition), **line 50** (WHERE clause).

**Exact fragment:**

```sql
CREATE POLICY "Firm users can view journal entry lines for engaged clients"
  ON journal_entry_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM journal_entries je
      INNER JOIN accounting_firm_users afu ON afu.user_id = auth.uid()
      INNER JOIN firm_client_engagements fce
        ON fce.accounting_firm_id = afu.firm_id
        AND fce.client_business_id = je.business_id
        ...
      WHERE je.id = journal_entry_lines.journal_entry_id   -- line 50
    )
  );
```

When RLS expands this into a query that already references `journal_entry_lines` (e.g. with an alias like `jel`), both the policy’s `journal_entry_lines` and the outer query’s `journal_entry_lines`/alias can be in scope. A reference to `journal_entry_id` without a prefix can then be ambiguous (e.g. `jel.journal_entry_id` vs the policy’s `journal_entry_lines.journal_entry_id`). So the **exact line** where the ambiguous reference can appear is **line 50** in that policy.

**Same pattern (same fix likely):**  
**File:** `supabase/migrations/279_engagement_lifecycle_hardening.sql`  
**Line:** **219**  
Same policy text: `WHERE je.id = journal_entry_lines.journal_entry_id`.

### Other checked locations (no unqualified `journal_entry_id` in a multi-table scope)

- **255_forensic_accounting_monitoring.sql:** Subquery uses `journal_entry_id` in `GROUP BY` (only `journal_entry_lines` in that FROM). Outer SELECT uses `s.journal_entry_id`. No ambiguity.
- **045_reconciliation.sql (get_system_transactions_for_account):** SELECT uses `je.id AS journal_entry_id`; JOIN uses `jel.journal_entry_id`. All references are qualified or aliased.
- **140_phase3_1_report_function_optimization.sql (get_general_ledger / get_general_ledger_paginated):** CTEs use `je.id AS journal_entry_id`; later references are to that CTE column or `jel.journal_entry_id`. No bare `journal_entry_id` in a join where both tables have the column.
- **Reversal API** (`app/api/accounting/reversal/route.ts`): Uses `.eq("journal_entry_id", original_je_id)` on `journal_entry_lines`; no raw SQL with joins. Ambiguity would come from the expanded SQL (e.g. under RLS), not from this file directly.

### Summary for ERROR 1

| Location | File | Function / object | Line | Notes |
|----------|------|-------------------|------|--------|
| Primary | `278_firm_engagement_ledger_periods_tbs_rls.sql` | Policy "Firm users can view journal entry lines for engaged clients" on `journal_entry_lines` | **50** | `WHERE je.id = journal_entry_lines.journal_entry_id` — can be ambiguous when policy is inlined into a query that also references `journal_entry_lines` (e.g. with alias). |
| Same pattern | `279_engagement_lifecycle_hardening.sql` | Same policy (recreated) | **219** | Same clause. |

**Recommended fix (for later):** In both policies, avoid any chance of ambiguity by using an explicit correlation name for the table the policy is on (if supported) or by ensuring the only unqualified column reference in the USING subquery is to `je` (e.g. keep `journal_entry_lines.journal_entry_id` fully qualified and ensure no other unqualified `journal_entry_id` is introduced when the policy is expanded).

---

## ERROR 2: unrecognized encoding "base64url"

### What was searched

- All migrations and SQL for `encode(..., 'base64url')`, `base64url`, and `gen_random_bytes` with `encode`.

### Source: PostgreSQL `encode()` does not support `'base64url'`

PostgreSQL’s built-in `encode()` supports encodings such as `'base64'`, `'hex'`, `'escape'` — it does **not** support `'base64url'`. Any use of `encode(..., 'base64url')` in SQL will raise **unrecognized encoding "base64url"**.

### Exact locations (migrations only; app code uses Node `Buffer` and does not cause this Postgres error)

| # | File | Function / context | Line | Exact code |
|---|------|--------------------|------|------------|
| 1 | `supabase/migrations/035_enhance_invoice_system_ghana.sql` | `generate_public_token()` | **155** | `RETURN encode(gen_random_bytes(32), 'base64url');` |
| 2 | `supabase/migrations/036_complete_invoice_system_setup.sql` | `generate_public_token()` | **196** | `RETURN encode(gen_random_bytes(32), 'base64url');` |
| 3 | `supabase/migrations/039_recurring_invoices_statements.sql` | (inline token generation) | **183** | `encode(gen_random_bytes(32), 'base64url')` |
| 4 | `supabase/migrations/047_payroll_system.sql` | (function using public token / similar) | **350** | `RETURN encode(gen_random_bytes(32), 'base64url');` |
| 5 | `supabase/migrations/049_combined_reconciliation_assets_payroll_vat.sql` | (function using public token) | **824** | `RETURN encode(gen_random_bytes(32), 'base64url');` |

**Note:** Application code (e.g. `app/api/credit-notes/create/route.ts`, `app/api/invoices/create/route.ts`, `Buffer.from(...).toString("base64url")`) runs in Node and uses JavaScript’s `base64url`; it does not run inside Postgres, so it is **not** the source of this Postgres error. The error comes only from **PostgreSQL functions** that call `encode(..., 'base64url')` in migrations above.

### Summary for ERROR 2

| Location | File | Function / context | Line |
|----------|------|--------------------|------|
| 1 | `035_enhance_invoice_system_ghana.sql` | `generate_public_token()` | **155** |
| 2 | `036_complete_invoice_system_setup.sql` | `generate_public_token()` | **196** |
| 3 | `039_recurring_invoices_statements.sql` | Inline token generation | **183** |
| 4 | `047_payroll_system.sql` | Function returning token | **350** |
| 5 | `049_combined_reconciliation_assets_payroll_vat.sql` | Function returning token | **824** |

**Recommended fix (for later):** Replace `encode(gen_random_bytes(32), 'base64url')` with a formulation that produces a URL-safe token in Postgres, e.g. use `encode(gen_random_bytes(32), 'base64')` and then replace `+`/`/` with `-`/`_` (or use a small wrapper that does that), so the result is base64url-compatible without using the unsupported `'base64url'` encoding name.

---

## Summary table

| Error | Primary source | File | Line |
|-------|----------------|------|------|
| **column "journal_entry_id" is ambiguous** | RLS policy on `journal_entry_lines` | `278_firm_engagement_ledger_periods_tbs_rls.sql` | **50** |
| Same | Same policy recreated | `279_engagement_lifecycle_hardening.sql` | **219** |
| **unrecognized encoding "base64url"** | `encode(..., 'base64url')` in SQL | `035_enhance_invoice_system_ghana.sql` | **155** |
| Same | Same | `036_complete_invoice_system_setup.sql` | **196** |
| Same | Same | `039_recurring_invoices_statements.sql` | **183** |
| Same | Same | `047_payroll_system.sql` | **350** |
| Same | Same | `049_combined_reconciliation_assets_payroll_vat.sql` | **824** |

No code was changed in this audit.
