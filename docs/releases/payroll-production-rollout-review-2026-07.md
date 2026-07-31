# Payroll production rollout review — 2026-07-31 (closeout)

Read-only deployment review for Finza payroll hardening (migrations **525, 534, 552–565**).

| Field | Value |
|---|---|
| Review branch | `staging` |
| Production Supabase ref | `qjxhibvbmzogyzbhswjj` |
| Staging Supabase ref | `adonhhtooawkeemdqqeo` |
| Review type | Read-only (no production writes) |
| Gate-closing session | 2026-07-31 |
| **Live SQL audit session** | **2026-07-30** (`tmp/_payroll_final_prod_audit.json`) |
| **Migration 565 gate session** | **2026-07-31** (`tmp/_payroll_release_gate_audit.json`) |

```text
Release source: staging
Last runtime-code SHA: 07a755dac2185a43702cc9535193bfbec29fdefc
Exact deployment SHA: pending immutable release tag/commit
Changes after runtime-code SHA: documentation and release-gate evidence only
```

---

## Executive verdict

**PAYROLL PRODUCTION DEPLOYMENT REVIEW PASSED**

All technical gates are satisfied, including the **live production SQL security and integrity audit**, **full production build at runtime SHA `07a755d`**, and **migration 565 staging verification**. This review **authorizes proceeding** with the approved payroll production deployment runbook (write freeze → migrations → deploy → smoke). **No migrations or production deploy were executed as part of this review.**

### Satisfied gates

| Gate | Status |
|---|---|
| Backup / restore | **Satisfied** |
| Migration dependency analysis | **Satisfied** (through **565**) |
| REST data preflight | **Satisfied** (0 P0/P1) |
| Release tests at `07a755d` | **Passed** |
| Full production build at `07a755d` | **Passed** (`npm run build`) |
| Migration 565 security audit | **Passed** |
| Staging export UAT (565) | **Passed** |
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
| Migration 565 gate audit | `tmp/_payroll_release_gate_audit.json` |

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
| **565** (`record_payroll_export_event` BOM delivery hash alignment) | **No** |

`journal_entry_lines` confirmed **without** `business_id` (columns: `journal_entry_id`, `account_id`, `debit`, `credit`, `description`, `created_at`). Cross-business integrity uses payment vs journal header (`pp.business_id` vs `je.business_id`).

Latest **payroll** migration in ledger: **521** (`payroll_entry_run_adjustments`). Non-payroll migrations **535–551** are present in the ledger (applied out of payroll sequence); payroll path **525, 534, 552–565** remain unapplied — **no partial payroll schema detected**.

---

## SQL function security (Part B)

**Status: LIVE-AUDITED**

Live `has_function_privilege` audit (read-only). Target payroll hardening RPCs from migrations **552–565** are **not present** on production — expected at ledger **521**.

| Function | Found | `authenticated` EXECUTE | Notes |
|---|---:|---:|---|
| `approve_payroll_run_atomic` | No | — | Post-552 |
| `reverse_payroll_run_atomic` | No | — | Post-557 |
| `create_payroll_correction_draft_from_reversed` | No | — | Post-557 |
| `record_payroll_payment_atomic` | No | — | Post-562 |
| `record_payroll_batch_item_payment_atomic` | No | — | Post-562 |
| `lock_payroll_run_atomic` | No | — | Post-554 |
| `transition_payroll_payment_batch_*_atomic` | No | — | Post-564 |
| `record_payroll_export_event` (9-arg, post-565) | No | — | Post-559/565 |
| **`post_payroll_payment_to_ledger`** | **Yes** | **Yes** | Migration **445**; `SECURITY DEFINER`, `search_path=public` |
| `_record_payroll_payment_atomic_impl` | No | — | Post-562 internal |
| `_post_payroll_payment_journal_internal` | No | — | Post-562 internal |
| `finza_set/clear_payroll_mutation_context` | No | — | Post-562 internal |
| Legacy `p_actor_id` RPC paths | **None** | — | `legacyActorFunctions: []` |

**Pre-migration expectation:** `post_payroll_payment_to_ledger` authenticated access is **expected**. Migration **562** explicitly `REVOKE`s authenticated and grants postgres-only.

**Post-565 expectation:** `record_payroll_export_event(uuid,uuid,uuid,text,text,text,text,text,bigint)` → `authenticated` EXECUTE only (anon/public denied); internal snapshot helpers → postgres only.

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

**Pre-migration note:** Direct journal line INSERT remains available to `authenticated` (pre-562). Migrations **552–565** install immutability triggers, controlled RPC paths, and revoke direct journal posting from authenticated users.

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

**Approved sequence:**

```text
525 → 534 → 552 → 553 → 554 → 555 → 556 → 557 → 558 → 559 → 560 → 561 → 562 → 563 → 564 → 565
```

| Confirmation | Result |
|---|---|
| 525, 534 required | **Yes** (557–565 SQL + app depend on period/salary-basis columns) |
| 558–559 required before 565 | **Yes** (export snapshots + `record_payroll_export_event` foundation) |
| 560–564 required before 565 | **Yes** (approval snapshots use v2 renderers; payment integrity unchanged by 565) |
| 522–524, 526–533, 535–551 not required for payroll | **Yes** |
| Hidden SQL dependency | **None found** |
| Partial 525/534/552–565 payroll schema | **None** (live fingerprints: present-or-absent) |
| Latest payroll ledger migration (production) | **521** |
| Latest payroll ledger migration (staging) | **565** (once) |

---

## Migration 565 review (2026-07-31)

### Purpose

Align `record_payroll_export_event` with UTF-8 BOM delivery: immutable snapshot `rendered_content` and `rendered_content_sha256` remain BOM-free; HTTP-delivered CSV bytes include BOM (`EF BB BF`); download events record SHA-256 and byte length of the **exact delivered bytes**.

### Dependencies

| Migration | Requirement |
|---|---|
| **558** | `payroll_export_snapshots`, `payroll_export_events`, `verify_payroll_export_snapshot`, `payroll_sha256_hex` |
| **559** | Nine-argument `record_payroll_export_event`, permission gates, DT107A preparation hash guard |
| **560–564** | Approval-time v2 snapshots and payroll integrity (565 does not alter payment/batch logic) |

565 **replaces** the 559 function body only. It does **not** re-grant privileges (`CREATE OR REPLACE` preserves 559 grants).

### Security-definer review

Staging catalog inspection (2026-07-31):

| Property | Value |
|---|---|
| Signature | `record_payroll_export_event(uuid,uuid,uuid,text,text,text,text,text,bigint)` |
| Overload count | **1** |
| Owner | `postgres` |
| `SECURITY DEFINER` | **Yes** |
| `search_path` | `public, extensions, pg_catalog` |

**Preserved controls from 559:** `auth.uid()` actor resolution; business access; `payroll.export` permission; mode validation; lowercase 64-char SHA-256 validation; safe filename validation; non-negative content length; snapshot ownership/export-type validation; approved snapshot-source validation; `verify_payroll_export_snapshot`; renderer-version equality; payroll-run existence; reversed-run preparation blocking; append-only event insert; structured fail-closed errors.

**565 change only:** DT107A preparation hash/length validation now expects `SHA-256(BOM || rendered_content)` and matching byte length instead of raw snapshot hash.

### Privileges (staging live)

| Role | EXECUTE |
|---|---|
| `authenticated` | **Yes** |
| `service_role` | **Yes** |
| `postgres` | **Yes** |
| `anon` | **No** |
| `public` | **No** |

No unintended overload or widened access detected.

### BOM byte verification

PostgreSQL expression `decode('efbbbf','hex')` verified on staging:

```text
bom_hex=efbbbf  bom_len=3  bytes=[239,187,191]
```

Snapshot stored content remains BOM-free; delivered preparation = BOM + `rendered_content`.

### Staging verification

| Check | Result |
|---|---|
| Migration 565 in ledger (once) | **Pass** |
| All 8 export modes HTTP 200 | **Pass** |
| Single UTF-8 BOM per download | **Pass** |
| No double BOM | **Pass** |
| Event hash = HTTP bytes SHA-256 | **Pass** (all modes) |
| Event length = HTTP byte length | **Pass** (all modes) |
| DT107A preparation 27-column header | **Pass** |
| DT107A preparation no audit metadata | **Pass** |
| Audit banner ASCII hyphen | **Pass** |
| No `â€”` mojibake | **Pass** |

### Rollback / stop conditions

- Stop rollout if migration 565 fails to apply or post-apply function catalog differs (overload ≠ 1, anon/public granted).
- Stop if DT107A preparation downloads fail hash/length reconciliation after deploy.
- Rollback: do **not** partially revert 565 alone; restore from backup and redeploy prior release if post-migration verification fails.

**Production status:** migration **565 has not been applied to production**.

---

## Release identification (Part G)

```text
Release source: staging
Last runtime-code SHA: 07a755dac2185a43702cc9535193bfbec29fdefc
Exact deployment SHA: pending immutable release tag/commit
Changes after runtime-code SHA: documentation and release-gate evidence only
```

| Field | Value |
|---|---|
| Staging runtime SHA | `07a755d` |
| Production app SHA (current) | `f3790e9f605336abbca148cc588090e387f48c12` |

Compatibility matrix references **runtime code at `07a755d`**. The exact deployment SHA must be pinned as an immutable release tag or commit at deploy time — not inferred from `staging` HEAD after documentation commits.

---

## Production application

| Field | Value |
|---|---|
| Domain | `app.finza.africa` |
| Deployment ID | `dpl_CQMkQ1sLyzzmw8M65Uw7jbgSnwFi` |
| Active Git SHA | `f3790e9` (matches `main`) |

---

## Rollout sequence (execution — do not run from this review)

1. Start payroll write freeze.
2. Pin an immutable release tag/commit (**runtime SHA `07a755d`** or later doc-only commits on top — pin the exact commit deployed).
3. Re-run final read-only production preflight (`tmp/_payroll_final_prod_audit.mjs`).
4. Apply **525**.
5. Apply **534**.
6. Apply **552** through **565** sequentially.
7. Stop immediately on any migration or verification failure.
8. Verify schema, functions, grants, triggers, and migration ledger (including single 565 row and 9-arg `record_payroll_export_event`).
9. Deploy the exact pinned application release immediately.
10. Run production smoke tests (exports, payments, approval, TIN warnings).
11. Lift payroll write freeze only after all checks pass.

**Production deployment still requires explicit user authorization.**

---

## Release tests (runtime-code SHA `07a755d`, 2026-07-31)

| Command | Result |
|---|---|
| `npx jest lib/payroll/__tests__/exportSnapshotDownload.test.ts lib/payroll/__tests__/payrollBusinessTinWarning.test.ts` | **20 passed** |
| `node tmp/_run_565_sql_test_staging.mjs` (565 SQL test on staging) | **Passed** |
| `node tmp/_payroll_release_gate_audit.mjs` (staging export integrity) | **Passed** |
| `npx tsc --noEmit` | **Passed** |
| `npm run build` | **Passed** (Next.js 16.2.10 production build at `07a755d`) |

### Staging UAT results (export fixes)

| Scenario | Result |
|---|---|
| Payroll register renderer v2 | **Passed** |
| PAYE schedule renderer v2 | **Passed** |
| Missing business TIN warnings (draft + approved snapshot) | **Passed** |
| DT107A preparation (27 columns, no audit metadata) | **Passed** |
| DT107A audit (ASCII hyphen banner) | **Passed** |
| UTF-8 BOM on all CSV downloads | **Passed** |
| Download-event hash and byte-length reconciliation | **Passed** |

Coverage includes: renderer v1/v2, unsupported renderer fail-closed, malformed v2 payload, TIN warning logic, BOM delivery, ASCII audit wording, delivered-byte hash/length, DT107A 27-column header, stored snapshot hash BOM-free.

---

## Application CSV delivery integrity (audit summary)

Single authoritative BOM path: `deliverPayrollCsvContent()` → `payrollCsvDownloadResponse()` in `lib/payroll/exportSnapshotDownload.ts`, used by `app/api/payroll/runs/[id]/exports/_shared.ts` and legacy DT107A audit via `rawCsvResponse()`.

| Requirement | Status |
|---|---|
| One BOM prefix only | **Confirmed** |
| Hash computed on delivered bytes (with BOM) | **Confirmed** |
| `Buffer.byteLength(..., "utf8")` for content length | **Confirmed** |
| Stored snapshot hash unchanged (BOM-free) | **Confirmed** |
| No live-data substitution into snapshots | **Confirmed** |
| No route-specific double BOM | **Confirmed** |

---

## Production confirmation

```text
production data unchanged
no production migration applied
no production deployment
no main merge
live SQL audit: read-only (BEGIN READ ONLY → ROLLBACK)
migration 565: applied on staging only; not on production
```

---

## Remaining work

Execute the controlled payroll production deployment only after explicit user authorization.
