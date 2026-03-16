# FINZA Accounting Discrepancy — Full System Audit

**READ-ONLY • NO FIXES • ROOT CAUSE DISCOVERY ONLY**

**Test case:** Invoice INV-000004 — Invoice date 01-01-2026, Payment date 06-01-2026, Amount 200 GHS.

**Observed:** Ledger and Revenue/Tax show the transaction; Cash balance and Receivable reduction do **not** appear in reports; statements still balance internally.

---

## A. Transaction trace table

| Stage | Data present | Evidence (code path) |
|--------|---------------|----------------------|
| **Ledger** | YES (by report) | User confirms payment appears in ledger. Journal entry created by trigger on `payments` INSERT → `post_invoice_payment_to_ledger(p_payment_id)` → `post_journal_entry(business_id, payment_record.date, ...)` with two lines: debit asset (Cash/Bank), credit AR. Migration 217: JE date = `payment_record.date` (06-01-2026). |
| **Snapshot** | **Partially** (revenue/tax yes; cash/AR no) | `generate_trial_balance` (247) loops **only** over `accounts WHERE business_id = X AND deleted_at IS NULL`. For each account it sums `journal_entry_lines` where `jel.account_id = account_record.id` and `je.date` in period. **If payment JE lines reference an `account_id` that is not in that set** (e.g. account was deleted in CoA dedup 248/249/250), those lines are **never aggregated** into any snapshot row. Revenue and tax accounts (invoice JE) use canonical ids; Cash/AR used at payment post time may be non-canonical/deleted → payment movement missing from snapshot. |
| **Resolver output** | N/A (same period) | Invoice 01-01-2026 and payment 06-01-2026 both fall in Jan 2026 (period_start 2026-01-01, period_end 2026-01-31). Resolver uses `je.date` for period; no evidence of wrong period. |
| **Report RPC** | **Excludes payment for Cash/AR** | `get_trial_balance_from_snapshot` returns `snapshot_data` as-is. `get_balance_sheet_from_trial_balance` / `get_profit_and_loss_from_trial_balance` filter by account type only; they do **not** filter out Cash or AR. So report output is exactly what’s in the snapshot. Snapshot is missing Cash/AR movement for this payment. |
| **Frontend API** | Mirrors report RPC | No extra filtering; API returns what RPC returns. |

---

## B. Contract violation report

| Layer | Violated assumption | Expected vs actual |
|-------|---------------------|--------------------|
| **Snapshot generation** | Every journal entry line in the period is aggregated into exactly one snapshot account row. | **Actual:** Aggregation is keyed by `account_record.id` from `accounts WHERE deleted_at IS NULL`. If `journal_entry_lines.account_id` references an account that was **deleted** (e.g. non-canonical account removed in 248/249/250), that line is **not** summed into any row. So payment JE lines that point to deleted Cash/AR accounts contribute to **no** snapshot row. |
| **Ledger ↔ snapshot** | Snapshot totals (by account) equal sum of ledger lines for that account in the period. | **Actual:** For accounts that no longer exist (deleted_at IS NOT NULL or removed by dedup), ledger lines still exist but snapshot has no row for that account_id, so those lines are omitted. |
| **Posting ↔ CoA stability** | Posting uses `get_account_by_code` / `get_account_by_control_key` which return an account that will remain in the active set. | **Actual:** If dedup ran **after** the payment was posted, JEs could reference the old (now deleted) account ids. If dedup ran **before** posting but duplicate accounts remained, `get_account_by_code` uses `LIMIT 1` and may return non-canonical id; if that account was later chosen for deletion in a rerun, same orphan outcome. |

---

## C. Root cause ranking

| Rank | Failure point | Likelihood | Rationale |
|------|----------------|------------|-----------|
| 1 | **Orphan `journal_entry_lines.account_id`** (payment lines reference deleted/non-canonical Cash or AR account) | **Highest** | Explains symptom exactly: ledger shows lines (direct query); snapshot aggregates only by **existing** accounts, so orphan lines are dropped; revenue/tax from invoice use different (canonical) accounts and appear; Cash/AR from payment use the orphan ids and do not. |
| 2 | **Period/snapshot timing** (report viewed for period before payment, or snapshot never invalidated) | Medium | Invoice 01-01 and payment 06-01 are same period (Jan 2026). If user always views Jan 2026, both should be in same snapshot. If invalidation failed (trigger exception) or report cached, could see old snapshot; trigger in 247 swallows errors (RAISE WARNING), so invalidation could fail silently. |
| 3 | **Payment JE date different from payment.date** | Low | 217 explicitly uses `payment_record.date` in `post_journal_entry(business_id_val, payment_record.date, ...)`. No evidence of alternate date. |
| 4 | **Report RPC or API filters out Cash/AR** | **Ruled out** | Balance Sheet and Trial Balance RPCs return all snapshot rows by type; no code path excludes asset or AR. |
| 5 | **Resolver returns wrong period** | Low | as_of_date / period_start logic uses `period_start <= date` and `period_end >= date`; Jan 2026 contains both dates. |

---

## D. Risk assessment

| Risk type | Status |
|-----------|--------|
| **Ledger integrity** | **At risk** — Ledger rows are correct, but snapshot (and thus reports) can omit activity when `journal_entry_lines.account_id` points to an account no longer in `accounts` (deleted_at IS NOT NULL or removed by dedup). |
| **Financial statement accuracy** | **Violated** — Trial Balance and Balance Sheet can understate Cash and AR (and overstate revenue relative to collections) when payment lines reference orphan accounts. |
| **Period cutoff accuracy** | **OK** — Snapshot uses `je.date` within period; posting uses `payment_record.date`. No evidence of wrong date. |
| **Multi-tenant safety** | **OK** — All logic scoped by business_id; no cross-tenant leak. |

---

## E. Single root cause summary (primary explanation)

**Payment journal entry lines reference `account_id`(s) that are not present in the set of accounts used when building the trial balance snapshot.**

- **Mechanism:** `generate_trial_balance` (247) builds one snapshot row per row in `accounts WHERE business_id = X AND deleted_at IS NULL`. It sums `journal_entry_lines` only where `jel.account_id = account_record.id`. So every line must match an **existing, non-deleted** account. If the payment was posted when Cash or AR (or both) pointed to account ids that were later **deleted** (e.g. as non-canonical in migrations 248/249/250), or if posting used a duplicate account that was then removed, those lines are **never** summed into any snapshot row. The invoice posting (revenue, tax) uses accounts that are still canonical and present, so they appear; the payment posting (Cash debit, AR credit) uses the orphan ids, so they do not.
- **Why reports still balance:** Snapshot generation enforces total_debits = total_credits **only** over the rows it **does** aggregate. Orphan lines are excluded from both sides, so the snapshot can still balance even though it is incomplete (e.g. revenue and tax from invoice, but not the matching Cash and AR from payment).
- **Data lineage:** Invoice → invoice JE (revenue, tax) → snapshot includes those accounts → reports show revenue/tax. Payment → payment JE (Cash, AR) → snapshot **does not** include those movements if Cash/AR account_ids are not in the current `accounts` set → reports miss Cash balance increase and AR reduction.

---

## 1. Ledger integrity audit (INV-000004)

- **Payment JE existence:** Expected from trigger `trigger_auto_post_payment` (043, 218) on `payments` INSERT; calls `post_invoice_payment_to_ledger(NEW.id)`.
- **Debit/credit:** 217: `post_journal_entry(..., jsonb_build_array( asset debit, AR credit ))`. Correct.
- **Soft-delete:** No code path soft-deletes journal_entries or journal_entry_lines for this flow.
- **Period lock:** `assert_accounting_period_is_open(business_id, payment_record.date)` runs before posting; payment would not post if period locked.
- **Visibility in report aggregation:** Report aggregation is via `generate_trial_balance`, which joins `journal_entry_lines` to `journal_entries` and filters by `jel.account_id = account_record.id` and `je.date` in period. So **only** lines whose `account_id` appears in `accounts` (and deleted_at IS NULL) are included. Orphan account_ids are excluded by design of the loop.

---

## 2. Snapshot generation audit

- **A. Does snapshot include payment JEs?** Only if the payment JE’s **account_ids** (Cash and AR) are in `accounts WHERE business_id = X AND deleted_at IS NULL`. If they were deleted (e.g. dedup), those lines are **not** included.
- **B. Exclusion rules:** Snapshot does **not** exclude by posting_date vs period (it uses `je.date` in period). It **does** effectively exclude any line whose `account_id` is not in the current accounts list (because the loop is over that list only).
- **C. snapshot_data:** Contains one element per **existing** account; each element’s debit_total/credit_total/closing_balance are the sums for **that** account_id. Orphan lines do not contribute to any element.

---

## 3. Period resolution audit

- Invoice 01-01-2026 → period Jan 2026 (2026-01-01 to 2026-01-31).
- Payment 06-01-2026 → same period.
- Resolver (resolveAccountingPeriodForReport): as_of_date uses `period_start <= date` and `period_end >= date`; resolve_default_accounting_period and ensure_accounting_period return single period. No evidence of mixing periods for this case.

---

## 4. Posting engine audit

- **post_invoice_payment_to_ledger** (217): Reads `payment_record.date` from `payments`; calls `post_journal_entry(business_id_val, payment_record.date, ...)`. So **posting_date = payment date** (06-01-2026).
- No alternate date column used in snapshot; snapshot uses `journal_entries.date`.

---

## 5. Report RPC audit

- **get_trial_balance_from_snapshot:** Returns snapshot_data rows; no filtering by account type beyond what’s in the snapshot.
- **get_balance_sheet_from_trial_balance:** Filters snapshot by `account_type IN ('asset','liability','equity')`. Cash and AR are assets; they are **included** if present in the snapshot. No code path removes Cash or AR.
- **get_profit_and_loss_from_trial_balance:** Filters by income/expense only. Revenue and tax appear because their snapshot rows exist; payment does not affect P&L directly (it’s balance sheet), but missing Cash/AR affects **Balance Sheet** and **Trial Balance** totals.

---

## 6. Snapshot staleness audit

- **Trigger:** AFTER INSERT ON journal_entries → `mark_trial_balance_snapshot_stale(NEW.business_id, NEW.date, 'journal_entry_insert')`. Resolves period by `p_posting_date` between period_start/period_end; updates trial_balance_snapshots for that period_id.
- **If period doesn’t exist:** Invalidation is no-op (247). So if the period was created only when the report was first run (after payment), the snapshot might have been built before payment and never invalidated if the trigger didn’t find a period. Unlikely for Jan 2026 if period already existed.
- **If invalidation fails:** Trigger catches OTHERS and RAISE WARNING; insert still commits. So snapshot could remain non-stale even after payment. That would explain seeing an **old** snapshot (without payment). But then revenue from the **invoice** would also be from that same old snapshot; if invoice was posted before payment, old snapshot could have invoice revenue but not payment. So **stale snapshot** (invalidation failed or no period at invalidation time) is a **possible** secondary cause.

---

## 7. Date source contract

| Layer | Date used |
|--------|-----------|
| Ledger posting (payment) | `payment_record.date` (payments.date) → `journal_entries.date` |
| Snapshot aggregation | `journal_entries.date` between `period_record.period_start` and `period_record.period_end` |
| Report period filtering | Resolver returns single period_id; snapshot is for that period |
| Resolver (as_of_date) | `period_start <= date`, `period_end >= date` |

No mismatch: payment date 06-01-2026 is the JE date and falls in Jan 2026.

---

## 8. Multi-account deduplication interaction

- **248/249/250:** Reassign `journal_entry_lines.account_id` from duplicate account ids to canonical, then delete non-canonical accounts. If payment was posted **before** dedup, its lines could have been reassigned to canonical (if they were in the duplicate set). If payment was posted **after** dedup, it uses `get_account_by_code` / `get_account_by_control_key` which return one id (LIMIT 1); that should be canonical if dedup left one per code.
- **Risk:** If dedup **failed** or **did not run** for this business, duplicate accounts remain. Posting could then use one of two Cash ids (or two AR ids). If later a **different** migration or run deletes “duplicate” accounts and chooses the **other** id as canonical, the payment’s lines would point to the deleted id → orphan → missing from snapshot.
- **Verification (read-only):** Check for `journal_entry_lines` rows for this payment whose `account_id` is not in `accounts` (or is in accounts with deleted_at IS NOT NULL). If such rows exist, that confirms orphan-based exclusion from the snapshot.

---

## 9. Data lineage trace (payment 200 GHS, INV-000004)

```
Invoice INV-000004 (01-01-2026)
  → Invoice JE (revenue, tax) posted with date 01-01-2026
  → Snapshot (Jan 2026): includes revenue/tax accounts → Reports: Revenue YES, Tax YES

Payment 200 GHS (06-01-2026)
  → Payment JE (Cash debit, AR credit) with date 06-01-2026
  → Ledger: YES (JE and lines exist)
  → Snapshot (Jan 2026): generate_trial_balance loops accounts; sums JEs where jel.account_id = account_record.id
       → If Cash/AR account_id in payment lines are NOT in (accounts WHERE deleted_at IS NULL): lines not summed
       → Snapshot has no row for those ids (or row exists but with 0 from this payment)
  → Report: Cash balance and AR reduction NO

Divergence: at **snapshot construction** — payment journal entry lines are excluded from aggregation because their account_id(s) do not match any row in the current `accounts` set used by generate_trial_balance.
```

---

**End of audit. No fixes or code changes. Conclusion: payment entries are lost at the snapshot aggregation step when payment journal lines reference account_id(s) that are not in the set of active (non-deleted) accounts, so they are never summed into any Trial Balance / Balance Sheet row.**
