# P0 load-test report — Staging verification (2026-06-22)

**Campaign ID:** `staging-migration-smoke-2026-06-22`  
**Date:** 2026-06-22  
**Tester:** Cursor agent (automated)

---

## 1. Environment tested

| Field | Value |
|-------|-------|
| App URL | `https://app.finza.africa` (linked Supabase: Finza Pro) |
| Supabase project | `qjxhibvbmzogyzbhswjj` (Finza Pro, eu-north-1) |
| Vercel deployment | Not verified (no `gh` / Vercel MCP auth) |
| Git commit / branch | Local branch with migrations 497–501 |
| k6 version | `k6.exe v2.0.0` at `C:\Program Files\k6\k6.exe` |
| Scenario run | `smoke` attempted; **not a valid pass** (see §6–§7) |

**Note:** Repo `supabase/.temp/linked-project.json` points at Finza Pro. Treat as staging/pre-prod unless a separate staging project exists.

---

## 2. Migration status

| Migration | Applied? | Verified? |
|-----------|----------|-----------|
| 497 `get_cash_collected_total` | Yes (2026-06-22 via Supabase MCP) | Yes — SQL smoke |
| 498 `get_operational_overdue_invoices_page` | Yes | Yes — SQL smoke |
| 499 P0 indexes (×7) | Yes | Yes — all 7 in `pg_indexes` |
| 500 `get_service_dashboard_timeline` | Yes | Yes — SQL smoke |
| 501 `get_service_dashboard_metrics` | Yes | Yes — SQL smoke |

**Prior state:** RPCs and indexes already existed before this run (likely applied manually). Re-applied idempotently via `apply_migration`; recorded in `supabase_migrations.schema_migrations` as timestamp versions (`dashboard_cash_collected_rpc`, etc.).

**Part 1 pre-apply audit (497–501):**

| Check | Result |
|-------|--------|
| Functions use `CREATE OR REPLACE` | Pass (497, 498, 500, 501 + helpers in 501) |
| Indexes use `CREATE INDEX IF NOT EXISTS` | Pass (499, all 7) |
| No data drops/rewrites | Pass (no `DROP TABLE`, `DELETE`, `TRUNCATE`) |
| RPC names match app routes | Pass (see table below) |
| 501 dependency chain | Pass — `get_balance_sheet_as_of` (486) + `get_cash_collected_total` (497) present |
| All RPCs scoped by `business_id` | Pass — `p_business_id` in all WHERE/JOIN filters |

| App `supabase.rpc(...)` | DB function | Match |
|-------------------------|-------------|-------|
| `get_cash_collected_total` | `get_cash_collected_total` | Yes |
| `get_operational_overdue_invoices_page` | `get_operational_overdue_invoices_page` | Yes |
| `get_service_dashboard_timeline` | `get_service_dashboard_timeline` | Yes |
| `get_service_dashboard_metrics` | `get_service_dashboard_metrics` | Yes |

---

## 3. Dataset size

**Smoke business:** HVAC MASTER TECHNOLOGIES — `2d67cb58-7145-45fe-b940-806a6cf5e2be`

| Entity | Target (load-test plan) | Actual |
|--------|------------------------:|-------:|
| Invoices | 5,000 | 72 |
| Payments | 2,000 | 69 |
| Expenses | 2,000 | 54 |
| Journal lines | 20,000 | 546 |
| Accounting periods | 24 | 3 |
| Bills | 500 | 0 |
| Overdue (operational) | ~500 | 3 |
| Audit logs | 1,000 | 751 |
| Concurrent k6 sessions | 5 | 0 (no `sessions.staging.json`) |

**Verdict:** Staging tenant is **not** at load-test scale. SQL/RPC correctness verified; performance evidence still missing.

---

## 4. Session-cookie status

| Item | Status |
|------|--------|
| `load-tests/sessions.staging.json` | **Missing** (gitignored; not created) |
| `load-tests/sessions.example.json` | Present (placeholder UUID + fake cookies) |
| Authenticated API smoke | **Blocked** |
| Authenticated k6 smoke | **Blocked** |

Capture real cookies per `load-tests/README.md` before re-running k6.

---

## 5. SQL smoke result

**Business:** `2d67cb58-7145-45fe-b940-806a6cf5e2be`  
**Date range:** 2026-06-01 → 2026-06-30

| Query | Result | Status |
|-------|--------|--------|
| `get_cash_collected_total(...)` | `5732.00` | Pass |
| `get_operational_overdue_invoices_page(..., 25, 0)` | `{ total_count: 3, invoice_ids: [3 ids] }` | Pass |
| `get_service_dashboard_timeline(..., 'accounting_period', 6)` | 3 period rows | Pass |
| `get_service_dashboard_metrics(...)` | JSON with revenue, expenses, net_profit, cash_collected, positions | Pass |

**Secondary business (Finza Demo):** All four RPCs also returned without error (`d5391d1c-ace5-4f42-a49a-2d1897f0ef1e`).

---

## 6. API smoke result

**Base URL:** `https://app.finza.africa`  
**Auth:** None (no session cookies)

| Route | Status | Notes |
|-------|--------|-------|
| `/api/dashboard/service-metrics?business_id=…` | 401 | Route reachable; auth required |
| `/api/dashboard/service-timeline?business_id=…&periods=6` | 401 | Route reachable |
| `/api/invoices/list?page=1&limit=25` | 401 | Route reachable |
| `/api/invoices/list?status=overdue&page=1&limit=25` | 401 | Route reachable |
| `/api/bills/list` | 401 | Route reachable |
| `/api/bills/list?page=1&limit=50` | 401 | Route reachable |

**Not verified without auth:**

- HTTP 200 response shapes
- Bills default pagination (`pagination.limit ≤ 50`)
- Overdue list bounded to 25 rows
- Dashboard fields (`cashCollected`, `timeline[]`)
- RPC-missing 500 errors

**Verdict:** **Incomplete** — routes exist but authenticated functional smoke is pending.

---

## 7. k6 smoke result

| Item | Result (initial run) | After harness fix |
|------|----------------------|-------------------|
| k6 installed | Yes — `C:\Program Files\k6\k6.exe` v2.0.0 | Same |
| Scenario selection | **Broken** — all 5 scenarios started (~850 VUs) | **Fixed** — `SCENARIO` env selects exactly one |
| Session path | Wrong `./load-tests/...` doubled path | **Fixed** — default `./sessions.staging.json` relative to script |
| Placeholder sessions | Could send traffic with fake cookies | **Fixed** — fails fast before HTTP |
| Authenticated smoke | Not run | **Pending** — still needs `sessions.staging.json` |

**Initial verdict:** Not a valid smoke pass (multi-scenario accident + placeholder cookies).

**Harness fix (2026-06-22):** See `load-tests/README.md`. Validation command:

```powershell
$env:SCENARIO = "smoke"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://app.finza.africa" `
  -e SESSIONS_JSON="./sessions.example.json" `
  load-tests/finza-service-workday.js
```

Expected: script exception refusing example sessions **before** any HTTP traffic.

**Authenticated staging smoke** (requires real cookies):

```powershell
$env:SCENARIO = "smoke"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://app.finza.africa" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js
```

---

## 8. workday_50 result

**Not run** — authenticated smoke still pending (`sessions.staging.json` missing).

---

## 9. Failures / blockers

1. **`load-tests/sessions.staging.json` missing** — blocks authenticated API and k6 verification.
2. ~~**k6 harness multi-scenario bug**~~ — **Fixed** (use `$env:SCENARIO="smoke"`; see `load-tests/README.md`).
3. **Supabase CLI not installed locally** — migrations applied via Supabase MCP instead of `supabase db push`.
4. **Dataset far below load-test targets** — 72 invoices vs 5,000 target; performance conclusions not possible.
5. **App deploy hash unknown** — cannot confirm production/staging app includes P0/P1 route changes that call new RPCs.

---

## 10. Supabase / infrastructure notes

Not collected (no load test, no dashboard access during test window).

---

## 11. P0 fix verification

| Fix | Evidence |
|-----|----------|
| Bills default ≤50 rows | Not verified at API layer (401 only) |
| Overdue paginated | SQL: 3 overdue, page returns 3 ids; API unverified |
| Cash RPC | SQL: `5732.00` for HVAC MASTER |
| Timeline RPC | SQL: 3 periods with revenue/expenses/net_profit |
| Metrics RPC | SQL: consolidated JSON matches expected keys |
| Indexes | All 7 present |

---

## 12. Suspected bottlenecks

| # | Area | Evidence | Severity |
|---|------|----------|----------|
| 1 | Load-test harness | k6 v2 + multi-scenario default | High (blocks evidence) |
| 2 | Auth/session setup | No staging cookies | High (blocks API smoke) |
| 3 | Dataset size | 72 vs 5,000 invoices | High (invalid perf test) |
| 4 | `service-activity` | Prior audit: unbounded fan-out | Medium (untested) |

---

## 13. Recommended next fixes

| Priority | Fix | Expected impact |
|----------|-----|-----------------|
| P0 | Add `sessions.staging.json` + authenticated API smoke script | Unblocks 200 verification |
| ~~P0~~ | ~~Fix k6 harness for v2 single-scenario runs~~ | Done |
| P0 | Seed heavy tenant per `load-test-seed-plan.md` | Meaningful latency data |
| P1 | After k6 evidence: consolidate `/api/dashboard/service-activity` if it tops latency | Dashboard load reduction |

---

## 14. Verdict

**Can Finza handle 200 active users on this dataset after P0 fixes?**

☐ Yes  
☐ Partial  
☑ **Unknown / not ready to test** — migrations and SQL RPCs pass; authenticated API smoke, k6 smoke, and heavy seed are incomplete.

**Ready for 100-user test next?** **No** — complete session cookies, k6 scenario fix, authenticated API smoke, and ideally heavy seed first.

**One-paragraph summary:**

Migrations 497–501 were verified in repo and applied idempotently to Finza Pro (`qjxhibvbmzogyzbhswjj`). All four RPCs and seven indexes pass SQL smoke on a real service business. Unauthenticated API probes return 401 (routes exist). k6 harness now selects a single scenario via `SCENARIO` and refuses placeholder sessions. Authenticated k6 smoke and `workday_50` remain blocked until `sessions.staging.json` exists.

---

## Appendix — Part 1 dependency chain (no mismatches)

```
497 get_cash_collected_total
498 get_operational_overdue_invoices_page
499 indexes (no RPC deps)
500 get_service_dashboard_timeline  → accounting_periods, journal_entries (business_id scoped)
501 get_service_dashboard_metrics   → finza_dashboard_pnl_totals
                                    → get_cash_collected_total (497)
                                    → finza_dashboard_positions_as_of
                                    → get_balance_sheet_as_of (486)
```

No mismatches found before apply.
