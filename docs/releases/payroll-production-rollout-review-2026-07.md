# Payroll production rollout review — 2026-07-30 (gate-closing)

Read-only deployment review for Finza payroll hardening (migrations **525, 534, 552–564**, application SHA **`4928f451b4eade514637fbf5aadb708bf238af8b`**).

| Field | Value |
|---|---|
| Review branch | `staging` |
| Review SHA | `4928f451b4eade514637fbf5aadb708bf238af8b` |
| Production Supabase ref | `qjxhibvbmzogyzbhswjj` |
| Staging Supabase ref | `adonhhtooawkeemdqqeo` |
| Review type | Read-only (no production writes) |
| Gate-closing session | 2026-07-30 |

---

## Executive verdict

**PAYROLL PRODUCTION DEPLOYMENT REVIEW FAILED**

Technical payroll preflight, migration dependency analysis, and release tests support proceeding **after** operational gates are cleared. This review **does not authorize deployment**.

### Blockers (must resolve before execution)

1. **PITR status and retention not verified** — scheduled physical backups are confirmed (see Backup and recovery); PITR enabled/disabled and configured retention period were **not shown** in dashboard evidence supplied for this review.
2. **Production SQL grant audit incomplete** — `PRODUCTION_DATABASE_URL` is **not present** in the review environment (`.env.local` has production REST keys only). Live `has_function_privilege` / `proconfig` audit was **not executed**. OpenAPI proxy audit completed (see Security review).

### Resolved in this gate-closing session

- Review document pushed to remote `staging` (see Review document section).
- Migrations **522–551** dependency decision finalized (**525, 534 required** before 552).
- Production migration ledger revalidated (cached read-only SQL + REST schema fingerprints).
- Vercel production deployment metadata fetched; production SHA corroborated against GitHub `main`.
- Production data preflight re-run (REST aggregates).
- Release test bundle re-run at `4928f451`.
- **Scheduled physical backups verified** for project `qjxhibvbmzogyzbhswjj`; restore owner assigned (**Collins**).

### Non-blockers (noted)

- Eleven historical posted payments have **null idempotency keys** — expected pre-563.
- Five batch items with `status = paid` without `payroll_payment_id` column (pre-562 schema) — **not** a 563 duplicate-link violation.
- **Current production** exposes `post_payroll_payment_to_ledger` to authenticated users (migration 445). Migration **562** revokes this; expected end-state is postgres-only.

---

## Review document

| Field | Value |
|---|---|
| Path | `docs/releases/payroll-production-rollout-review-2026-07.md` |
| Local existence | Yes |
| Remote push | See commit SHA after push (gate-closing update) |

---

## Backup and recovery

Verified from Supabase Dashboard evidence (project `qjxhibvbmzogyzbhswjj`, supplied 2026-07-30):

| Field | Value |
|---|---|
| Scheduled physical backups | **Enabled** |
| Latest successful backup | **2026-07-30 05:36:49 UTC** (07:36:49 Sweden time) |
| Daily restore points visible | **26–30 July 2026** |
| Restore UI | Restore buttons available in Dashboard |
| PITR enabled | **Not shown in supplied evidence** — confirm in Dashboard → Database → Backups / PITR |
| Retention period | **Not shown in supplied evidence** — confirm configured retention in Dashboard |
| Restore owner | **Collins** |

```text
BACKUP_ENABLED=yes
LATEST_BACKUP_AT=2026-07-30T05:36:49Z
PITR_ENABLED=<not shown in dashboard evidence — verify before deploy>
RETENTION=<not shown in dashboard evidence — verify before deploy>
RESTORE_OWNER=Collins
```

Restore procedure: Collins initiates restore via Supabase Dashboard if rollback is required; coordinate with approved payroll production deployment runbook before any restore during or after rollout.

---

## Production application

| Field | Value |
|---|---|
| Domain | `app.finza.africa` |
| Deployment ID | `dpl_CQMkQ1sLyzzmw8M65Uw7jbgSnwFi` |
| Deployment URL | `https://finza-5h7d2igc8-collins-projects-f49524b8.vercel.app` |
| Created | 2026-07-29T01:15:55Z (~03:15 GMT+2) |
| Target / status | production / Ready |
| Git branch (alias) | `main` (`finza-app-git-main-collins-projects-f49524b8.vercel.app`) |
| Active Git SHA | `f3790e9f605336abbca148cc588090e387f48c12` |
| GitHub `main` SHA (public API) | `f3790e9f605336abbca148cc588090e387f48c12` (2026-07-29T01:02:57Z) |
| Classification | **production matches main** |

Evidence: Vercel `inspect app.finza.africa` (deployment ID, alias, timestamp); GitHub public API `repos/collinsadu0921-netizen/finza-app/commits/main`. Vercel deployment JSON did not expose `meta.githubCommitSha` (no local `~/.vercel/auth.json` token file for API meta fetch); SHA corroborated via git-main alias + commit timestamp correlation.

---

## Migration dependency decision (522–551)

Production ledger stops at **521**. Migrations **522–551** are absent from the ledger. Schema fingerprints (production REST OpenAPI, 2026-07-30):

| Fingerprint | Production schema |
|---|---|
| 521 (`is_included`, `base_salary_snapshot`, `adjustment_amount` on `payroll_entries`) | **Present** |
| 525 (`pay_period_start`, `payroll_frequency`, `staff_scope_fingerprint` on `payroll_runs`) | **Absent** |
| 534 (`salary_basis` on `staff`; entry snapshots; `payroll_run_id` on allowances/deductions) | **Absent** |
| 552 (`calculation_engine_version`, `paye_rate_version` on `payroll_runs`) | **Absent** |

### Dependency matrix (522–551)

| Version | Filename | Production ledger | Production schema | Payroll dependency | App dependency | Decision |
| ------- | -------- | ----------------- | ----------------- | ------------------ | -------------- | -------- |
| 522 | `522_accounting_snapshot_read_model.sql` | Missing | n/a (accounting) | None | None | SAFE TO SKIP FOR PAYROLL |
| 523 | `523_accounting_snapshot_reliability.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 524 | `524_fix_dashboard_positions_ar_sum.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 525 | `525_payroll_period_duplicate_guard.sql` | Missing | **Absent** | **557–564 use `pay_period_start`, `staff_scope_fingerprint`, `payroll_frequency`** | **App writes/reads period fields** (`app/payroll/run`, period utils) | **REQUIRED BEFORE PAYROLL** |
| 526 | `526_asset_depreciation_atomic_posting.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 527 | `527_asset_depreciation_phase1a_safety_corrections.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 528 | `528_asset_depreciation_phase1a_sql_tests.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 529 | `529_asset_disposal_hardening.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 530 | `530_asset_bulk_and_backfill_integrity.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 531 | `531_asset_phase1b_sql_tests.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 532 | `532_asset_phase1b_sql_test_corrections.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 533 | `533_asset_disposal_journal_balance_fix.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 534 | `534_payroll_salary_basis_and_period_items.sql` | Missing | **Absent** | **557–564 use `salary_basis`, `period_basic_pay`, `one_off_items_snapshot`, `allowances.payroll_run_id`** | **App reads/writes `salary_basis`, `period_basic_pay`** | **REQUIRED BEFORE PAYROLL** |
| 535 | `535_service_job_material_usage_return_integrity.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 536 | `536_service_job_material_usage_return_sql_tests.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 537 | `537_activate_service_material_accounts.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 538 | `538_harden_service_job_material_return_tests.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 539 | `539_accounting_snapshot_queue_reliability.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 540 | `540_accounting_snapshot_queue_sql_tests.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 541 | `541_accounting_snapshot_queue_sql_tests_fix.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 542 | `542_accounting_snapshot_queue_sql_tests_immutability.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 543 | `543_accounting_snapshot_queue_sql_tests_cleanup.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 544 | `544_claim_accounting_snapshot_refresh_jobs_for_period.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 545 | `545_claim_accounting_snapshot_refresh_jobs_for_period_sql_tests.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 546 | `546_accounting_snapshot_recovery_cron.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 547 | `547_accounting_snapshot_recovery_cron_sql_tests.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 548 | `548_bill_material_inventory_posting.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 549 | `549_invoice_material_fulfilment.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 550 | `550_invoice_material_fulfilment_return_undo.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |
| 551 | `551_invoice_sales_revenue_wording.sql` | Missing | n/a | None | None | SAFE TO SKIP FOR PAYROLL |

### Conclusion (522–551)

```text
Apply only these specific versions before 552: 525, 534
```

Evidence: SQL in migrations **557, 558, 560, 562** references 525/534 columns; application **`4928f451`** reads/writes `pay_period_start`, `salary_basis`, `period_basic_pay`; production OpenAPI confirms those columns are absent while 521 columns are present. No partial application detected for 525/534 (columns wholly absent).

---

## Migration gap (522–564)

| Range | Ledger state | Schema state (production) | Classification |
|---|---|---|---|
| 522–524 | Missing | n/a / non-payroll | not applied |
| **525** | Missing | Expected columns **absent** | not applied |
| 526–533 | Missing | n/a / non-payroll | not applied |
| **534** | Missing | Expected columns **absent** | not applied |
| 535–551 | Missing | n/a / non-payroll | not applied |
| **552–564** | **All missing** | Pre-552 payroll payment/batch schema | not applied |

| Item | Finding |
|---|---|
| Latest production migration (numeric) | **521** `payroll_entry_run_adjustments` |
| 522–551 ledger | **All missing** |
| 552–564 ledger | **All missing** |
| Unexpected production-only versions | None observed in cached ledger (`tmp/_prod_preflight_sql_ro2.out.json`) |
| Repository versions missing from ledger | **522–564** (30 versions) |
| Partial migrations | **None detected** (fingerprints are present-or-absent, not mixed) |

Legacy timestamp-style migration rows (e.g. `20260622233209`) coexist with numeric versions; latest numeric remains **521**.

---

## Security review

### CURRENT PRODUCTION STATE (OpenAPI + migration 445 baseline; SQL privileges not live-verified)

| Function | Exists (RPC exposed) | Notes |
|---|---|---|
| `approve_payroll_run_atomic` | No (pre-554) | — |
| `reverse_payroll_run_atomic` | No (pre-557) | — |
| `create_payroll_correction_draft_from_reversed` | No | — |
| `record_payroll_payment_atomic` | No (pre-554/562 path) | — |
| `record_payroll_batch_item_payment_atomic` | No (pre-564) | — |
| `lock_payroll_run_atomic` | No | — |
| `transition_payroll_payment_batch_*` | No (pre-564) | — |
| **`post_payroll_payment_to_ledger`** | **Yes (PostgREST exposed)** | **Granted to `authenticated` in migration 445 — legacy exposure** |
| `_record_payroll_payment_atomic_impl` | No | — |
| `_post_payroll_payment_journal_internal` | No | — |
| `finza_set/clear_payroll_mutation_context` | No | — |
| Legacy `p_actor_id` overloads (OpenAPI) | **None found** | — |

Payroll tables exist with RLS (PostgREST exposes SELECT/INSERT/UPDATE per policies). Direct mutation of approved runs/payments is constrained by pre-552 triggers/policies; full RLS/grant matrix requires `PRODUCTION_DATABASE_URL` SQL audit.

### EXPECTED STATE AFTER 564 (from migration definitions at `4928f451`)

| Function | Public access |
|---|---|
| `approve_payroll_run_atomic` | `authenticated` EXECUTE |
| `reverse_payroll_run_atomic` | `authenticated` EXECUTE |
| `create_payroll_correction_draft_from_reversed` | `authenticated` EXECUTE |
| `record_payroll_payment_atomic` | `authenticated` EXECUTE (563 signature; actor from `auth.uid()`) |
| `record_payroll_batch_item_payment_atomic` | `authenticated` EXECUTE |
| `lock_payroll_run_atomic` | `authenticated` EXECUTE |
| `transition_payroll_payment_batch_status_atomic` | `authenticated` EXECUTE |
| `transition_payroll_payment_batch_item_status_atomic` | `authenticated` EXECUTE |
| `_record_payroll_payment_atomic_impl` | **postgres only** |
| `_post_payroll_payment_journal_internal` | **postgres only** |
| **`post_payroll_payment_to_ledger`** | **postgres only** (562 revokes authenticated) |
| `finza_set/clear_payroll_mutation_context` | **postgres only** |

563 drops legacy RPC signatures accepting `p_actor_id`. `SECURITY DEFINER` functions use fixed `search_path` per 554–564 definitions.

**Migration path note:** Current `post_payroll_payment_to_ledger` authenticated grant does **not** block 562 from revoking and re-granting postgres-only; no conflicting partial 562/563 state exists on production.

---

## Production data preflight (aggregates, REST 2026-07-30)

| Check | Violations |
|---|---:|
| Run net vs included entry totals (approved/locked/reversed) | **0** |
| Approved/locked runs missing approval journal | **0** |
| Reversed runs missing reversal journal | **0** |
| Duplicate staff per run | **0** |
| Duplicate `salary_net` obligation per run | **0** |
| `salary_net.amount_due` vs run `total_net_salary` | **0** |
| Overpaid obligations | **0** |
| Posted payments missing journal | **0** |
| Unbalanced payroll journals | Not SQL-verified |
| Duplicate idempotency key groups | **0** |
| Duplicate payment↔item / item↔payment links (563) | **0** (pre-562 link columns absent) |
| Batch total vs item total mismatch | **0** |
| Paid items missing payments (`payroll_payment_id` column) | **5** (pre-562 schema; **non-blocker**) |
| Cancelled batches with posted payments | **0** |
| Paid batches with unpaid active items | **0** |
| Posted payments with null idempotency key | **11** (pre-563; **non-blocker**) |

Run status mix: 23 approved, 12 draft. Batch status: 2 paid, 1 partially_paid, 1 processing, 1 ready.

**P0/P1 data blockers:** none.

---

## Release method

| Field | Value |
|---|---|
| Recommended strategy | **Full staging merge** (single immutable SHA) |
| Commit range | `f3790e9f605336abbca148cc588090e387f48c12` → `4928f451b4eade514637fbf5aadb708bf238af8b` (**15 commits**, all payroll) |
| Migration range | **525, 534**, then **552 → 564** sequentially |
| Write-freeze | **Required** during 525/534/552–564 apply and app deploy |
| Rollback limitation | **App rollback to `f3790e9` unsafe after 563** if payroll writes occurred (RPC signature/idempotency mismatch). Forward-fix or maintenance mode. |

---

## Compatibility matrix

| Application | DB current (≤521) | DB after 525+534 | DB after 552 | DB after 563 | DB after 564 |
|---|---|---|---|---|---|
| **Current production (`f3790e9`)** | Compatible | Compatible (additive columns) | Partial / missing RPCs | Incompatible (563 RPCs) | Incompatible (batch RPCs) |
| **New payroll app (`4928f451`)** | Incompatible | Partial (missing 552+ RPCs) | Partial | Partial (batch UI RPCs) | **Compatible** |

**Unsafe window:** Any period where **552–564 schema** is live but app is still **`f3790e9`** during active payroll operations.

---

## Rollout sequence (execution — do not run from this review)

1. Confirm backup/PITR and assign restore owner.
2. Confirm production SHA and approved release SHA **`4928f451`**.
3. Start payroll write freeze.
4. Run final read-only preflight (SQL duplicate-link scan when `PRODUCTION_DATABASE_URL` available).
5. Apply **525, 534**, then **552 → 564** sequentially via approved runner.
6. Verify ledger, schema, grants, triggers (SQL).
7. Deploy application **`4928f451`** immediately.
8. Read-only application smoke (GET runs, batches, obligations — no synthetic payments).
9. Lift write freeze; monitor first legitimate payroll payment.

---

## Release tests (`4928f451`, 2026-07-30)

| Command | Result | Exit |
|---|---|---:|
| `npx jest lib/payroll/__tests__/batchItemPaymentModalLifecycle.test.ts` | **passed** | 0 |
| `npx jest lib/payroll/__tests__/manualPaymentModalLifecycle.test.ts` | **passed** | 0 |
| `npx jest app/api/payroll/runs/__tests__/batchWorkflow564.test.ts` | **passed** | 0 |
| `npx jest app/api/payroll/runs/__tests__/payments563.test.ts` | **passed** | 0 |
| `npx jest lib/payroll/__tests__/resolvePayrollIdempotencyKey.test.ts` | **passed** | 0 |
| `npx jest lib/payroll/__tests__/createPayrollPaymentIdempotencyKey.test.ts` | **passed** | 0 |
| `npx jest lib/__tests__/paymentBatchItems.test.ts` | **passed** | 0 |
| `npx jest lib/payrollEngine/__tests__/ghanaStatutoryGolden.test.ts` | **passed** | 0 |
| `npx jest lib/payroll/__tests__/ghanaApprovalGuards.test.ts` | **passed** | 0 |
| `npx jest lib/__tests__/payrollObligations.test.ts` | **passed** | 0 |
| `npx jest lib/payroll/__tests__/graDt107aPayeExport.test.ts` (DT107A) | **passed** | 0 |
| `npx jest lib/payroll/__tests__/exportSnapshotDownload.test.ts` | **passed** | 0 |
| `payroll_integrity_562.test.sql` (staging) | **passed** | 0 |
| `payroll_integrity_563.test.sql` (staging) | **passed** | 0 |
| `payroll_payment_batch_workflow_564.test.sql` (staging) | **passed** | 0 |
| `npx tsc --noEmit` | **passed** | 0 |
| `npm run build` | **passed** | 0 |

Jest payroll bundle total: **188 tests passed** (12 suites in primary + obligation/DT107A batch).

---

## Production confirmation (this review)

```text
production data unchanged
no production migration applied
no production deployment
no main merge
```

---

## Remaining work

1. Confirm PITR enabled/disabled and configured retention in Supabase Dashboard (not shown in evidence supplied 2026-07-30).
2. Run production SQL grant verification with authorized `PRODUCTION_DATABASE_URL` (`has_function_privilege`, RLS, `proconfig`).
3. Execute approved payroll production deployment runbook.
