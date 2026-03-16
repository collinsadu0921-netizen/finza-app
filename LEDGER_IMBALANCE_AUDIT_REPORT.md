# Ledger Imbalance Audit Report

## Objective

Determine **why** the Trial Balance reports "Ledger is Not Balanced" by identifying all journal entries where `sum(debit) ≠ sum(credit)` and classifying each by root cause.

## Scope

- **Tables:** `journal_entries`, `journal_entry_lines`, and related `invoices`, `payments`
- **Rules:** Read-only. No deletes, updates, inserts, or migrations.

---

## 1. How "Ledger is Not Balanced" Arises

- The Trial Balance UI shows **"⚠ Ledger is Not Balanced"** when `totalDebits ≠ totalCredits` for the period (`app/trial-balance/page.tsx`, `app/accounting/reports/trial-balance`).
- Trial balance data comes from `get_trial_balance_from_snapshot` → `trial_balance_snapshots`, which aggregates `journal_entry_lines` (and opening balances) per account.
- **Global** `sum(debits) = sum(credits)` holds only if **every** journal entry is balanced. Any entry with `sum(debit) ≠ sum(credit)` contributes to an overall imbalance.
- `generate_trial_balance` **raises** if the period is imbalanced, so a persisted snapshot implies the ledger was balanced **at generation time**. Imbalance can still appear if:
  - The UI uses a different data path (e.g. legacy report), or
  - There is rounding/aggregation differences, or
  - The snapshot is stale and new imbalanced data was introduced (e.g. pre-trigger legacy data, or a path that bypasses the trigger).

---

## 2. Identification of Imbalanced Entries

We use the same logic as `validate_period_ready_for_close` (migration 167):

```sql
GROUP BY je.id
HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) > 0.01
```

- **Tolerance:** `0.01` (matches `enforce_double_entry_balance_statement` in migration 188).
- **Result:** All `journal_entry_id` values where `|sum(debit) - sum(credit)| > 0.01`.

---

## 3. Output: Table of Offending Entries

| Column | Description |
|--------|-------------|
| `journal_entry_id` | UUID of the imbalanced journal entry |
| `reference_type` | `invoice`, `payment`, `sale`, `adjustment`, `manual`, etc. |
| `reference_id` | UUID of linked entity (invoice, payment, etc.), or NULL |
| `created_at` | When the journal entry was created |
| `business_id` | Business owning the entry |
| `date` | Journal entry date |
| `description` | Entry description |
| `total_debit` | Sum of `journal_entry_lines.debit` for this entry |
| `total_credit` | Sum of `journal_entry_lines.credit` for this entry |
| `imbalance_amount` | `|total_debit - total_credit|` |
| `line_count` | Number of lines in the entry |
| `root_cause_category` | One of: `interrupted posting`, `tax_lines missing`, `legacy data`, `manual entry`, `unknown` |

---

## 4. Root-Cause Classification

Each imbalanced entry is assigned a **single** root-cause category using this precedence:

| Category | Condition |
|----------|-----------|
| **interrupted posting** | `line_count = 1` (single-line entry cannot balance) |
| **tax_lines missing** | `reference_type = 'invoice'`, linked invoice exists, `(total_tax > 0 OR apply_taxes)`, and `tax_lines` is NULL, empty, or not usable (no `tax_lines` key or empty array) |
| **legacy data** | `created_at < '2024-01-01'` |
| **manual entry** | `reference_type IN ('manual', 'adjustment')` |
| **unknown** | None of the above |

- **Legacy:** Entries (or linked invoices/payments) created before a cutoff; may predate balance enforcement or tax normalization.
- **tax_lines missing:** Invoices that have tax (or `apply_taxes`) but lack ledger-ready `tax_lines`; linked postings can be wrong or partial.
- **Interrupted posting:** Single-line entries are never balanced; suggests aborted or partial posting.
- **Manual entry:** Adjustments or manual journals; may indicate user error or a bug in the adjustment flow.

---

## 5. Script Location and Usage

**File:** `scripts/audit-ledger-imbalance.sql`

**Usage:**

1. Open Supabase SQL Editor (or `psql`).
2. Run the script. It contains **only** `SELECT` (and commented optional summary). No `INSERT`/`UPDATE`/`DELETE`.
3. Use the result set as the **table of offending journal_entry_ids** with imbalance amount and root-cause category per entry.

**Optional:** Uncomment and run the second block to get **summary counts** by `root_cause_category` and total imbalance per category.

---

## 6. Links to Invoices and Payments

- **Invoices:** `journal_entries.reference_type = 'invoice'` and `journal_entries.reference_id = invoices.id`. The script left-joins `invoices` to detect `tax_lines` missing and `invoice_created_at` for context.
- **Payments:** `reference_type = 'payment'` and `reference_id = payments.id`. The script left-joins `payments` for context; classification does not use payment-specific logic beyond presence.

---

## 7. Related Code

- **Balance enforcement:** `enforce_double_entry_balance_statement` (migration 188), `post_journal_entry` (batch insert).
- **Trial balance:** `generate_trial_balance`, `get_trial_balance_from_snapshot` (migration 169).
- **Period close check:** `validate_period_ready_for_close` (migration 167) counts unbalanced entries in the period.

---

## 8. Summary

- **What:** Read-only audit of all journal entries with `sum(debit) ≠ sum(credit)`.
- **Where:** `scripts/audit-ledger-imbalance.sql`.
- **Output:** Table of offending `journal_entry_id`s with `reference_type`, `reference_id`, `created_at`, imbalance amount, line count, and root-cause category.
- **Categories:** `interrupted posting` | `tax_lines missing` | `legacy data` | `manual entry` | `unknown`.

Run the script, then use the results to prioritise fixes (e.g. legacy corrections, tax_lines backfill, or adjustment-path fixes) and to clear "Ledger is Not Balanced" once all imbalanced entries are resolved.
