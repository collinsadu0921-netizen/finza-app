# Payroll production rollout review — 2026-07-30

Read-only deployment review for Finza payroll hardening (migrations **552–564**, application SHA **`4928f451b4eade514637fbf5aadb708bf238af8b`**).

| Field | Value |
|---|---|
| Review branch | `staging` |
| Review SHA | `4928f451b4eade514637fbf5aadb708bf238af8b` |
| Production Supabase ref | `qjxhibvbmzogyzbhswjj` |
| Staging Supabase ref | `adonhhtooawkeemdqqeo` |
| Review type | Read-only (no production writes) |

---

## Executive verdict

**PAYROLL PRODUCTION DEPLOYMENT REVIEW FAILED**

Technical payroll preflight and staging verification support proceeding **after** operational gates are cleared. This review **does not authorize deployment** until backup/PITR is confirmed and a maintenance runbook owner is assigned.

### Blockers (must resolve before execution)

1. **Backup / PITR not verified** — Supabase Dashboard evidence (PITR enabled, latest backup timestamp, retention) was not captured in this session.
2. **Production SQL grant audit incomplete** — `PRODUCTION_DATABASE_URL` was unavailable in the review environment; security-definer grants were assessed from migration end-state and OpenAPI only, not live `has_function_privilege` on production.
3. **Production application SHA not independently verified** — inferred from `main` HEAD (`f3790e9`); Vercel deployment metadata was not fetched with authenticated API in this session.

### Non-blockers (noted)

- Production also lacks migrations **522–551** (non-payroll catch-up). Payroll bundle **552–564** is independent of that gap for schema preconditions observed on production (obligations/batches already exist at ≤521).
- Eleven historical posted payments have **null idempotency keys** — expected and allowed by migration 563 for pre-migration rows.
- Five batch items with `status = paid` on legacy schema **without** `payroll_payment_id` — not a migration 563 duplicate-link violation (column absent pre-562).

---

## Production baseline

| Item | Finding |
|---|---|
| `main` SHA | `f3790e9f605336abbca148cc588090e387f48c12` |
| Staging review SHA | `4928f451b4eade514637fbf5aadb708bf238af8b` |
| Commits on staging since `main` | **15** (all payroll hardening) |
| Inferred production app SHA | `f3790e9` (same as `main`; Vercel alias `finza-app-git-main-…`) |
| Latest production migration (ledger) | **521** `payroll_entry_run_adjustments` |
| Migrations 552–564 on production | **All missing** (ledger) |
| Partial 552–564 schema on production | **Not applied** (OpenAPI confirms pre-552 payroll columns) |
| Backup / PITR | **Unverified** — confirm in Supabase Dashboard → Project `qjxhibvbmzogyzbhswjj` → Database → Backups |

Evidence sources:

- Migration ledger: `tmp/_prod_preflight_sql_ro2.out.json` (read-only SQL, prior authorized session)
- Row counts & data preflight: `tmp/_payroll_prod_data_preflight_rest.json` (REST, service role, SELECT-only)
- Schema fingerprints: `tmp/_payroll_prod_rest_probe.json`

---

## Migration gap (552–564)

| Ver | Filename | Git blob SHA | Ledger | Schema (prod) | Action | Risk |
|---:|---|---|---|---|---|---|
| 552 | `552_payroll_calculation_rate_version_snapshots.sql` | `a05ab95a…` | Missing | Not applied | Apply | Low |
| 553 | `553_salary_advance_recovery_lifecycle.sql` | `045e28d7…` | Missing | Not applied | Apply | Moderate (RPC + triggers) |
| 554 | `554_atomic_payroll_approval_and_obligations.sql` | `60fc029d…` | Missing | Not applied | Apply | Moderate–high (large function replace) |
| 555 | `555_harden_atomic_payroll_approval.sql` | `2ea8f07f…` | Missing | Not applied | Apply | Moderate (function replace) |
| 556 | `556_fix_payroll_external_deduction_obligations.sql` | `3af02a90…` | Missing | Not applied | Apply | Moderate |
| 557 | `557_payroll_reversal_and_corrections.sql` | `9a3ff98f…` | Missing | Not applied | Apply | Moderate |
| 558 | `558_payroll_export_snapshot_integrity.sql` | `afabffcd…` | Missing | Not applied | Apply | Moderate (new tables) |
| 559 | `559_harden_payroll_export_snapshot_security_and_events.sql` | `fd9e94a0…` | Missing | Not applied | Apply | Low–moderate |
| 560 | `560_ghana_tax_profile_calculation_methods.sql` | `cd9ebce4…` | Missing | Not applied | Apply | Moderate (entry columns + validation) |
| 561 | `561_harden_ghana_v3_tax_base_validation.sql` | `a9fe9ee5…` | Missing | Not applied | Apply | Moderate (approval guards) |
| 562 | `562_payroll_integrity_payment_and_immutability_hardening.sql` | `97a54410…` | Missing | Not applied | Apply | **High** (payment immutability triggers, atomic payment RPC) |
| 563 | `563_payroll_payment_identity_and_idempotency_hardening.sql` | `b7281873…` | Missing | Not applied | Apply | **High** (fail-closed duplicate scan, unique indexes, legacy RPC drop) |
| 564 | `564_payroll_payment_ui_and_batch_workflow_integration.sql` | `0d6c656a…` | Missing | Not applied | Apply | Moderate (batch transition RPCs) |

No historical migration file in **552–564** was edited after staging apply (review performed on committed files at `4928f451`).

### Lock exposure (production row counts)

| Table | Rows (approx.) |
|---|---:|
| `payroll_runs` | 35 |
| `payroll_entries` | 48 |
| `payroll_payments` | 11 |
| `payroll_obligations` | 55 |
| `payroll_payment_batches` | 5 |
| `payroll_payment_batch_items` | 9 |

At these volumes, **562–563** `ALTER TABLE` + index creation and trigger installation are **low–moderate** wall-clock risk. Still require a **payroll write freeze** because 563 runs a fail-closed duplicate scan and replaces payment RPCs.

---

## Production data preflight (aggregates)

| Check | Violations |
|---|---:|
| Run net vs included entry totals (approved/locked/reversed) | **0** |
| Approved/locked runs missing approval journal | **0** |
| Duplicate staff per run | **0** |
| Duplicate `salary_net` obligation per run | **0** |
| `salary_net.amount_due` vs run `total_net_salary` | **0** |
| Overpaid obligations | **0** |
| Posted payments missing journal | **0** |
| Unbalanced payroll payment journals | Not SQL-verified; **0** payments missing journal |
| Duplicate idempotency key groups (where column exists) | **0** |
| Migration 563 payment↔item duplicate groups | **0** (pre-562 link columns absent) |
| Batch total vs item total mismatch | **0** |
| Run status mix | 23 approved, 12 draft |

Obligation types present: `salary_net`, `paye_gra`, `ssnit_tier1`, `tier2_pension`, `other_employee_deductions`.

Batch status mix: 2 paid, 1 partially_paid, 1 processing, 1 ready.

---

## Security review (expected end-state after 564)

From migration definitions at `4928f451` (live production grants **not SQL-verified**):

| Function | Expected public access |
|---|---|
| `approve_payroll_run_atomic` | `authenticated` EXECUTE |
| `reverse_payroll_run_atomic` | `authenticated` EXECUTE |
| `create_payroll_correction_draft_from_reversed` | `authenticated` EXECUTE |
| `record_payroll_payment_atomic` | `authenticated` EXECUTE (563 signature, no `p_actor_id`) |
| `record_payroll_batch_item_payment_atomic` | `authenticated` EXECUTE (563 signature) |
| `lock_payroll_run_atomic` | `authenticated` EXECUTE (563 signature) |
| `transition_payroll_payment_batch_status_atomic` | `authenticated` EXECUTE |
| `transition_payroll_payment_batch_item_status_atomic` | `authenticated` EXECUTE |
| `_record_payroll_payment_atomic_impl` | **postgres only** |
| `_post_payroll_payment_journal_internal` | **postgres only** |
| `post_payroll_payment_to_ledger` | **postgres only** |
| `finza_set/clear_payroll_mutation_context` | **postgres only** |

563 drops legacy RPC signatures that accepted `p_actor_id`. Actor identity must come from `auth.uid()`.

---

## Application / database compatibility matrix

| Application | DB before 562 | After 562 | After 563 | After 564 |
|---|---|---|---|---|
| **Current production (`f3790e9`)** | Compatible | Likely incompatible for **new payment RPC paths** if old app calls dropped 563 signatures | Incompatible if old app calls removed signatures | Batch transition APIs missing |
| **New app (`4928f451`)** | Incompatible (missing atomic RPCs / idempotency) | Partial (manual atomic payment) | Partial (batch item payment) | **Compatible** |

**Conclusion:** Apply **552 → 564** in order during a payroll write freeze, verify DB, then **immediately** deploy application **`4928f451`**. Do not leave new DB schema running under old app during payroll operations.

---

## Rollout sequence (execution runbook — do not run from this review)

1. Assign rollback owner and open monitoring.
2. Confirm Supabase **backup + PITR** (< 24h backup, PITR enabled).
3. Announce **payroll write freeze** (no approvals, payments, batches, reversals).
4. Run read-only preflight SQL (duplicate-link scan equivalent to 563).
5. Apply migrations **552 553 554 555 556 557 558 559 560 561 562 563 564** via approved runner:
   ```bash
   node scripts/apply-production-migrations.mjs --dry-run 552 553 554 555 556 557 558 559 560 561 562 563 564
   # After human approval:
   node scripts/apply-production-migrations.mjs --execute-production 552 553 554 555 556 557 558 559 560 561 562 563 564
   ```
6. Post-migration read-only verification (ledger, columns, RPC presence, grants).
7. Deploy Vercel production to SHA **`4928f451b4eade514637fbf5aadb708bf238af8b`**.
8. Read-only UI/API smoke (GET payroll run, batches, obligations — no synthetic payments).
9. Lift write freeze; monitor first legitimate salary payment per operator-run checklist.

---

## Rollback

| Level | Procedure |
|---|---|
| App failure after successful DB | Redeploy previous production SHA **`f3790e9`** only if no payroll writes occurred; if payroll writes occurred on 564 schema, **forward-fix** — old app is not compatible with 563+ RPC signatures. |
| Migration failure mid-transaction | Runner rolls back single migration transaction; inspect ledger; do not resume until root cause cleared. |
| Financial integrity incident | Disable payroll payment writes; preserve audit rows; use approved reversal/correction RPCs; **never hard-delete** posted payments/journals. |

---

## Monitoring (first 24h)

| Query / signal | Expected | Alert |
|---|---|---|
| Posted payments without journal | 0 new rows | Any new |
| Duplicate `(business_id, idempotency_key)` | 0 groups | > 0 |
| Duplicate batch-item ↔ payment links | 0 | > 0 |
| `PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT` API rate | ~0 | Spike |
| `PAYROLL_BATCH_HAS_POSTED_PAYMENTS` on cancel | expected when applicable | N/A |
| Audit: `payroll.batch_item_payment_recorded` | present on real payments | missing |

---

## Release tests (`4928f451`)

| Command | Result | Exit |
|---|---|---:|
| Jest payroll release bundle (13 suites) | **passed** (198 tests) | 0 |
| `payroll_integrity_562.test.sql` (staging) | **passed** | 0 |
| `payroll_integrity_563.test.sql` (staging) | **passed** | 0 |
| `payroll_payment_batch_workflow_564.test.sql` (staging) | **passed** | 0 |
| Payroll reversal SQL tests | **skipped** (no maintained file) | — |
| Payroll correction SQL tests | **skipped** (no maintained file) | — |
| Export event SQL tests | **skipped** (covered by `exportSnapshotDownload.test.ts`) | — |
| `npx tsc --noEmit` | **passed** | 0 |
| `npm run build` | **passed** | 0 |

---

## Repository rollout scope

All **102 files** changed between `main` and `4928f451` are **payroll-related** (migrations 552–564, API, UI, tests, Ghana engine). No unrelated retail/accounting code ships in this bundle. **Full staging merge** of the 15 payroll commits is appropriate; cherry-pick is optional but not required for isolation.

---

## Remaining work

1. Confirm Supabase backup/PITR in Dashboard and record timestamp + owner.
2. Run production SQL grant verification with authorized `PRODUCTION_DATABASE_URL`.
3. Confirm Vercel production deployment SHA.
4. Execute approved payroll production deployment runbook.
