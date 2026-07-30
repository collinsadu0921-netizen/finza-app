# Payroll production rollout review — 2026-07-30 (closeout)

Read-only deployment review for Finza payroll hardening (migrations **525, 534, 552–564**).

| Field | Value |
|---|---|
| Review branch | `staging` |
| Production Supabase ref | `qjxhibvbmzogyzbhswjj` |
| Staging Supabase ref | `adonhhtooawkeemdqqeo` |
| Review type | Read-only (no production writes) |
| Gate-closing session | 2026-07-30 |
| **Live SQL audit session** | **2026-07-30** (`tmp/_payroll_final_prod_audit.json`) |

```text
Release source: staging
Last runtime-code SHA: 4928f451b4eade514637fbf5aadb708bf238af8b
Exact deployment SHA: pending immutable release tag/commit
Changes after runtime-code SHA: documentation only
```

---

## Executive verdict

**PAYROLL PRODUCTION DEPLOYMENT REVIEW PASSED**

All technical gates are satisfied, including the **live production SQL security and integrity audit**. This review **authorizes proceeding** with the approved payroll production deployment runbook (write freeze → migrations → deploy → smoke). **No migrations or production deploy were executed as part of this review.**

### Satisfied gates

| Gate | Status |
|---|---|
| Backup / restore | **Satisfied** |
| Migration dependency analysis | **Satisfied** |
| REST data preflight | **Satisfied** (0 P0/P1) |
| Release tests at `4928f451` | **Passed** |
| Release identification | **Satisfied** |
| **Live production SQL audit** | **Passed** (11 queries executed; 0 blockers) |

### Known legacy states (non-blockers)

- **11** posted payments with null idempotency key — column absent pre-563; REST preflight recorded; **allowed**.
- **5** legacy paid batch items without `payroll_payment_id` link — column absent pre-562; REST preflight recorded; **allowed**.
- **`post_payroll_payment_to_ledger`** exposed to `authenticated` — **expected** pre-migration (445); migration **562** revokes; live SQL confirmed; **not a blocker**.

### Post-562 checks (not applicable on current schema)

Nine reconciliation checks require columns introduced by migration **562** (`idempotency_key`, `batch_item_id`, `payroll_payment_id`, etc.). The schema-first audit correctly marked these **`not_applicable_pre_migration`** rather than failing. They will become executable after **562** is applied.

---

## Review document

| Field | Value |
|---|---|
| Path | `docs/releases/payroll-production-rollout-review-2026-07.md` |
| Authoritative live audit | `tmp/_payroll_final_prod_audit.json` |

---

## Backup and recovery

**Backup gate: SATISFIED**

| Field | Value |
|---|---|
| Scheduled physical backups | **Enabled** |
| Latest successful backup | **2026-07-30T05:36:49Z** |
| Daily restore points | **2026-07-26 through 2026-07-30** |
| Restore UI | Available (restore buttons visible in Dashboard) |
| PITR | **Disabled / not purchased** — **not required** for this controlled rollout |
| Restore owner | **Collins** |

```text
BACKUP_ENABLED=yes
LATEST_BACKUP_AT=2026-07-30T05:36:49Z
DAILY_RESTORE_POINTS=2026-07-26 through 2026-07-30
RESTORE_UI_AVAILABLE=yes
PITR_ENABLED=no / not purchased
RESTORE_OWNER=Collins
```

Rollout relies on: scheduled physical backup, payroll write freeze, final SQL preflight immediately before migration apply, controlled sequential migration execution, immediate application deployment.

---

## Production connection (Part A)

**Status: SATISFIED**

| Field | Result |
|---|---|
| Production project | `qjxhibvbmzogyzbhswjj` |
| Connection | **Established** (postgres user, database `postgres`) |
| Read-only transaction | **`SET TRANSACTION READ ONLY` = on** |
| Transaction end | **`ROLLBACK`** (no writes) |
| Audit script | `tmp/_payroll_final_prod_audit.mjs` |
| Audit output | `tmp/_payroll_final_prod_audit.json` |
| Console result | `ok: true`, `blockers: []`, 11 scheduled queries executed |

### Phase 1 — live schema inventory (summary)

All 14 inventoried tables exist. Key migration fingerprints on production:

| Migration marker | Present on production |
|---|---|
| **521** (`payroll_entries.is_included`, `base_salary_snapshot`, `adjustment_amount`) | **Yes** |
| **525** (`payroll_runs.pay_period_start`, `payroll_frequency`, `staff_scope_fingerprint`) | **No** |
| **534** (`staff.salary_basis`, entry period columns) | **No** |
| **552** (`calculation_engine_version`, `paye_rate_version`) | **No** |
| **562** (`reversed_at`, `idempotency_key`, `batch_item_id`, batch/obligation payment links) | **No** |

`journal_entry_lines` confirmed **without** `business_id` (columns: `journal_entry_id`, `account_id`, `debit`, `credit`, `description`, `created_at`). Cross-business integrity uses payment vs journal header (`pp.business_id` vs `je.business_id`).

Latest **payroll** migration in ledger: **521** (`payroll_entry_run_adjustments`). Non-payroll migrations **535–551** are present in the ledger (applied out of payroll sequence); payroll path **525, 534, 552–564** remain unapplied — **no partial payroll schema detected**.

---

## SQL function security (Part B)

**Status: LIVE-AUDITED**

Live `has_function_privilege` audit (read-only). Target payroll hardening RPCs from migrations **552–564** are **not present** on production — expected at ledger **521**.

| Function | Found | `authenticated` EXECUTE | Notes |
|---|---:|---:|---|
| `approve_payroll_run_atomic` | No | — | Post-552 |
| `reverse_payroll_run_atomic` | No | — | Post-557 |
| `create_payroll_correction_draft_from_reversed` | No | — | Post-557 |
| `record_payroll_payment_atomic` | No | — | Post-562 |
| `record_payroll_batch_item_payment_atomic` | No | — | Post-562 |
| `lock_payroll_run_atomic` | No | — | Post-554 |
| `transition_payroll_payment_batch_*_atomic` | No | — | Post-564 |
| **`post_payroll_payment_to_ledger`** | **Yes** | **Yes** | Migration **445**; `SECURITY DEFINER`, `search_path=public` |
| `_record_payroll_payment_atomic_impl` | No | — | Post-562 internal |
| `_post_payroll_payment_journal_internal` | No | — | Post-562 internal |
| `finza_set/clear_payroll_mutation_context` | No | — | Post-562 internal |
| Legacy `p_actor_id` RPC paths | **None** | — | `legacyActorFunctions: []` |

**Pre-migration expectation:** `post_payroll_payment_to_ledger` authenticated access is **expected**. Migration **562** explicitly `REVOKE`s authenticated and grants postgres-only.

**Post-564 expectation:** Public payroll RPCs → `authenticated` EXECUTE (actor from `auth.uid()`); internal helpers → postgres only.

### Supplementary OpenAPI proxy (production REST, 2026-07-30)

PostgREST exposure aligns with live SQL: only `post_payroll_payment_to_ledger` is exposed among payroll posting RPCs.

---

## Table grants and RLS (Part C)

**Status: LIVE-AUDITED**

All nine audit tables exist with **RLS enabled** (not forced). Summary:

| Table | RLS | Business-scoped policies |
|---|---|---|
| `payroll_runs` | On | SELECT / INSERT / UPDATE via `finza_user_can_access_business` |
| `payroll_entries` | On | SELECT / INSERT; UPDATE limited to **draft** runs |
| `payroll_payments` | On | Full CRUD via business scope |
| `payroll_obligations` | On | Full CRUD via business scope |
| `payroll_obligation_payments` | On | Full CRUD via business scope |
| `payroll_payment_batches` | On | ALL via business scope |
| `payroll_payment_batch_items` | On | ALL via business scope |
| `journal_entries` | On | SELECT + INSERT policies; **no authenticated UPDATE/DELETE** |
| `journal_entry_lines` | On | SELECT + INSERT policies; **no authenticated UPDATE/DELETE** |

**Pre-migration note:** Direct journal line INSERT remains available to `authenticated` (pre-562). Migrations **552–564** install immutability triggers, controlled RPC paths, and revoke direct journal posting from authenticated users.

---

## Journal integrity (Part D)

**Status: SQL-VERIFIED** (live production, 2026-07-30)

| Check | Count | Blocker |
|---|---:|---|
| Unbalanced payroll payment journals | **0** | — |
| Active payments missing journal | **0** | — |
| Payment vs journal business mismatch | **0** | — |
| Payment journal missing 2240 debit | **0** | — |
| Payment journal missing asset credit | **0** | — |
| Multiple active payments → one journal | **0** | — |

`journalLinesCrossBusiness` deferred — `journal_entry_lines` has no `business_id`; covered by `journalPaymentBusinessMismatch`.

---

## Duplicate and reconciliation preflight (Part E)

### Live SQL (schema-validated, 11 queries executed)

| Check | Result |
|---|---|
| Batch total mismatch | **0** |
| Paid batch with unpaid active item | **0** |
| Salary net due mismatch | **0** |
| Salary obligation paid/status mismatch | **0** |
| Overpaid salary obligation | **0** |

### Not applicable pre-562 (9 checks — columns absent)

| Check | Status |
|---|---|
| Duplicate idempotency groups | N/A (562) |
| Idempotency key conflicting details | N/A (562) |
| Legacy null idempotency | N/A (562) |
| Multiple items → one payment | N/A (562) |
| Multiple payments → one batch item | N/A (562) |
| Paid item without posted payment | N/A (562) |
| Cancelled batch with posted payment | N/A (562) |
| Legacy paid items without payment link | N/A (562) |
| Obligation payment reciprocal duplicates | N/A (562) |

### REST aggregates (production REST, 2026-07-30 — corroborating)

| Check | Count |
|---|---:|
| Duplicate active idempotency groups | **0** |
| Same idempotency key, conflicting payment details | **0** |
| Multiple active batch items → one payment | **0** |
| Multiple active payments → one batch item | **0** |
| Batch total mismatch | **0** |
| Paid item without reciprocal posted payment | **5** (legacy pre-562; **allowed**) |
| Cancelled batch with posted payment | **0** |
| Paid batch with unpaid active item | **0** |
| Salary obligation due mismatch | **0** |
| Salary obligation paid/status mismatch | **0** |
| Overpaid salary obligation | **0** |
| Legacy null idempotency (posted) | **11** (**allowed**) |
| Legacy paid items without payment link | **5** (**allowed**) |

**P0/P1 blockers:** none (REST + live SQL).

---

## Migration sequence (Part F)

**Approved sequence (unchanged):**

```text
525 → 534 → 552 → 553 → 554 → 555 → 556 → 557 → 558 → 559 → 560 → 561 → 562 → 563 → 564
```

| Confirmation | Result |
|---|---|
| 525, 534 required | **Yes** (557–564 SQL + app depend on period/salary-basis columns) |
| 522–524, 526–533, 535–551 not required for payroll | **Yes** |
| Hidden SQL dependency | **None found** |
| Partial 525/534/552–564 payroll schema | **None** (live fingerprints: present-or-absent) |
| Latest payroll ledger migration | **521** |

---

## Release identification (Part G)

```text
Release source: staging
Last runtime-code SHA: 4928f451b4eade514637fbf5aadb708bf238af8b
Exact deployment SHA: pending immutable release tag/commit
Changes after runtime-code SHA: documentation only
```

| Field | Value |
|---|---|
| Production app SHA (current) | `f3790e9f605336abbca148cc588090e387f48c12` |

Compatibility matrix references **runtime code at `4928f451`** (unchanged by doc commits). The exact deployment SHA must be pinned as an immutable release tag or commit at deploy time — not inferred from `staging` HEAD.

---

## Production application

| Field | Value |
|---|---|
| Domain | `app.finza.africa` |
| Deployment ID | `dpl_CQMkQ1sLyzzmw8M65Uw7jbgSnwFi` |
| Active Git SHA | `f3790e9` (matches `main`) |

---

## Rollout sequence (execution — do not run from this review)

1. ~~Confirm backup~~ — **satisfied**.
2. ~~Run live SQL preflight~~ — **satisfied** (`tmp/_payroll_final_prod_audit.json`, 2026-07-30).
3. Pin **exact deployment SHA** as immutable release tag/commit (runtime code unchanged since **`4928f451`**).
4. Start payroll write freeze.
5. Apply **525, 534**, then **552 → 564** sequentially.
6. Verify ledger, schema, grants, triggers (SQL).
7. Deploy pinned immutable release SHA (runtime code last changed at **`4928f451`**).
8. Read-only smoke; lift write freeze.

---

## Release tests (runtime-code SHA `4928f451`, 2026-07-30)

All **passed** — 188 Jest tests, SQL 562/563/564 on staging, `tsc`, `build`. No runtime code changed since `4928f451`.

---

## Production confirmation

```text
production data unchanged
no migration applied
no production deployment
no main merge
live SQL audit: read-only (BEGIN READ ONLY → ROLLBACK)
```

---

## Remaining work

Execute the approved **payroll production deployment runbook** (steps in Rollout sequence above). Re-run `tmp/_payroll_final_prod_audit.mjs` immediately before migration apply if material time elapses between closeout and execution.
