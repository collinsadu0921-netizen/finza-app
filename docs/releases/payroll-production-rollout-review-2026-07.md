# Payroll production rollout review — 2026-07-30 (final gate-closing)

Read-only deployment review for Finza payroll hardening (migrations **525, 534, 552–564**).

| Field | Value |
|---|---|
| Review branch | `staging` |
| **Release Git SHA** | **`e6b07b35ab4792180068179621400d1ad1222ae5`** (current `origin/staging`) |
| **Last runtime-code SHA** | **`4928f451b4eade514637fbf5aadb708bf238af8b`** |
| Changes after runtime-code SHA | **Documentation only** (review doc commits only; no payroll runtime changes) |
| Production Supabase ref | `qjxhibvbmzogyzbhswjj` |
| Staging Supabase ref | `adonhhtooawkeemdqqeo` |
| Review type | Read-only (no production writes) |
| Final gate-closing session | 2026-07-30 |

---

## Executive verdict

**PAYROLL PRODUCTION DEPLOYMENT REVIEW FAILED**

All non-SQL gates are satisfied (backup, migration dependencies, REST preflight, release tests, release SHA identification). The **single remaining technical blocker** is the live production SQL security audit: **`PRODUCTION_DATABASE_URL` was not available** in the agent review environment when `tmp/_payroll_final_prod_audit.mjs` was executed.

This review **does not authorize deployment** until the live SQL audit completes successfully.

### Blocker

1. **Live production SQL audit not executed** — `PRODUCTION_DATABASE_URL` absent from process environment and `.env.local`. Fail-closed per review policy. Run: `PRODUCTION_DATABASE_URL=… node tmp/_payroll_final_prod_audit.mjs` (or equivalent) before deployment.

### Satisfied gates

- **Backup gate satisfied** — scheduled physical backups verified; PITR disabled/not purchased (not required for this controlled rollout).
- **Restore owner** — Collins.
- **Migration sequence** — `525, 534, 552–564` confirmed; no partial schema.
- **REST data preflight** — no P0/P1 violations.
- **Release tests** — passed at runtime-code SHA `4928f451`.
- **Release identification** — deploy **`5c19090`** via full staging merge; runtime payroll code unchanged since **`4928f451`**.

### Known legacy states (non-blockers)

- **11** posted payments with null idempotency key (pre-563; allowed).
- **5** legacy paid batch items without `payroll_payment_id` link (pre-562; allowed).
- **`post_payroll_payment_to_ledger`** currently exposed to `authenticated` (migration 445); migration **562** revokes this — expected pre-migration state, not a deployment blocker.

---

## Review document

| Field | Value |
|---|---|
| Path | `docs/releases/payroll-production-rollout-review-2026-07.md` |
| Remote commit SHA | See latest push on `origin/staging` |

---

## Backup and recovery

**Backup gate: SATISFIED**

| Field | Value |
|---|---|
| Scheduled physical backups | **Enabled** |
| Latest successful backup | **2026-07-30T05:36:49Z** (07:36:49 Sweden time) |
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

Restore procedure: Collins initiates restore via Supabase Dashboard; coordinate with approved payroll production deployment runbook.

---

## Production connection (Part A)

| Field | Result |
|---|---|
| `PRODUCTION_DATABASE_URL` in process env | **Not present** |
| `.env.local` | Production REST keys only; no `PRODUCTION_DATABASE_URL` |
| Project identity confirmed | **Not reached** (connection not established) |
| Read-only transaction | **Not executed** (audit script exit code 2) |
| Audit script | `tmp/_payroll_final_prod_audit.mjs` |

**Fail-closed:** Production database identity and live privilege audit could not be completed in this session.

---

## SQL function security (Part B)

**Status: NOT LIVE-AUDITED** (blocked on connection).

### Supplementary OpenAPI proxy (production REST, 2026-07-30)

PostgREST exposure only; does not report `has_function_privilege`, `SECURITY DEFINER`, or `search_path`:

| Function | PostgREST exposed |
|---|---|
| `approve_payroll_run_atomic` | No |
| `reverse_payroll_run_atomic` | No |
| `create_payroll_correction_draft_from_reversed` | No |
| `record_payroll_payment_atomic` | No |
| `record_payroll_batch_item_payment_atomic` | No |
| `lock_payroll_run_atomic` | No |
| `transition_payroll_payment_batch_status_atomic` | No |
| `transition_payroll_payment_batch_item_status_atomic` | No |
| **`post_payroll_payment_to_ledger`** | **Yes** |
| `_record_payroll_payment_atomic_impl` | No |
| `_post_payroll_payment_journal_internal` | No |
| `finza_set/clear_payroll_mutation_context` | No |
| Legacy `p_actor_id` RPC paths (OpenAPI) | **None found** |

**Current-state expectation (pre-552):** `post_payroll_payment_to_ledger` authenticated access is **expected** from migration 445. Migration **562** explicitly `REVOKE`s authenticated and grants postgres-only. No partial 562–564 helpers should exist yet.

**Expected post-564:** Public payroll RPCs → `authenticated` EXECUTE (actor from `auth.uid()`); internal helpers → postgres only.

---

## Table grants and RLS (Part C)

**Status: NOT LIVE-AUDITED** (blocked on connection).

Tables to audit at deploy preflight: `payroll_runs`, `payroll_entries`, `payroll_payments`, `payroll_obligations`, `payroll_obligation_payments`, `payroll_payment_batches`, `payroll_payment_batch_items`, `journal_entries`, `journal_entry_lines`.

**Expected post-564:** Migrations 552–564 install immutability triggers, controlled RPC paths, and revoke direct journal posting from authenticated users. No partial 525/534/552–564 schema detected via REST OpenAPI fingerprints (525/534/552 columns wholly absent).

---

## Journal integrity (Part D)

**Status: NOT SQL-VERIFIED** in final session (blocked on connection).

Prior REST preflight: **0** posted payments missing journal. Unbalanced journal count requires live SQL (`tmp/_payroll_final_prod_audit.mjs`).

---

## Duplicate and reconciliation preflight (Part E)

REST aggregates re-run **2026-07-30** (production project `qjxhibvbmzogyzbhswjj`):

| Check | Count |
|---|---:|
| Duplicate active idempotency groups | **0** |
| Same idempotency key, conflicting payment details | **0** (column sparse pre-563) |
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

**P0/P1 blockers:** none.

---

## Migration sequence (Part F)

**Approved sequence (unchanged):**

```text
525 → 534 → 552 → 553 → 554 → 555 → 556 → 557 → 558 → 559 → 560 → 561 → 562 → 563 → 564
```

| Confirmation | Result |
|---|---|
| 525, 534 required | **Yes** (557–564 SQL + app depend on period/salary-basis columns) |
| 522–524, 526–533, 535–551 not required | **Yes** (no payroll dependency found) |
| Hidden SQL dependency | **None found** |
| Partial 525/534/552–564 schema | **None** (fingerprints present-or-absent) |
| Latest ledger (numeric) | **521** |

---

## Release identification (Part G)

| Field | Value |
|---|---|
| Release branch/source | **`staging`** (full merge to `main`) |
| **Release Git SHA (deploy this)** | **`5c190906a80911065adb8b67dad3f6791914c848`** |
| **Last runtime-code SHA** | **`4928f451b4eade514637fbf5aadb708bf238af8b`** |
| Commits after runtime-code | Documentation-only review commits |
| Production app SHA (current) | `f3790e9f605336abbca148cc588090e387f48c12` |

Compatibility matrix references **runtime code at `4928f451`** (unchanged by doc commits).

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
2. Confirm production SHA and release SHA **`5c190906a80911065adb8b67dad3f6791914c848`**.
3. Start payroll write freeze.
4. Run live SQL preflight: `PRODUCTION_DATABASE_URL=… node tmp/_payroll_final_prod_audit.mjs`.
5. Apply **525, 534**, then **552 → 564** sequentially.
6. Verify ledger, schema, grants, triggers (SQL).
7. Deploy release SHA **`5c190906a80911065adb8b67dad3f6791914c848`** (runtime code last changed at **`4928f451`**).
8. Read-only smoke; lift write freeze.

---

## Release tests (runtime-code SHA `4928f451`, 2026-07-30)

All **passed** — 188 Jest tests, SQL 562/563/564 on staging, `tsc`, `build`. See prior gate-closing session; no runtime code changed since `4928f451`.

---

## Production confirmation

```text
production data unchanged
no migration applied
no production deployment
no main merge
```

---

## Remaining work

1. Run live production SQL audit with authorized `PRODUCTION_DATABASE_URL` (`tmp/_payroll_final_prod_audit.mjs`).
2. Execute approved payroll production deployment runbook.
