# P0 load-test report — Finza service workday

**Campaign ID:** `________________`  
**Date:** `________________`  
**Tester:** `________________`

---

## 1. Environment tested

| Field | Value |
|-------|-------|
| App URL | |
| Supabase project | (staging ref only) |
| Vercel deployment | |
| Git commit / branch | |
| k6 version | |
| Scenario run | `workday_50` / `workday_100` / `workday_200` / `stress_500` |

---

## 2. Migration status

| Migration | Applied? | Verified? |
|-----------|----------|-----------|
| 497 `get_cash_collected_total` | ☐ | ☐ RPC smoke |
| 498 `get_operational_overdue_invoices_page` | ☐ | ☐ RPC smoke |
| 499 P0 indexes | ☐ | ☐ `pg_indexes` |
| 500 `get_service_dashboard_timeline` | ☐ | ☐ RPC smoke |
| 501 `get_service_dashboard_metrics` | ☐ | ☐ RPC smoke |

Notes:

---

## 3. Dataset size

| Entity | Target | Actual |
|--------|-------:|-------:|
| Invoices | 5,000 | |
| Payments | 2,000 | |
| Expenses | 2,000 | |
| Journal lines | 20,000 | |
| Accounting periods | 24 | |
| Bills | 500 | |
| Overdue (operational) | ~500 | |
| Staff | 50 | |
| Payroll runs | 12 | |
| Audit logs | 1,000 | |
| Concurrent k6 sessions | | |

---

## 4. Routes tested

| Route | In k6? | Pass? |
|-------|--------|-------|
| `GET /api/business/profile` | ☐ | ☐ |
| `GET /api/dashboard/service-metrics` | ☐ | ☐ |
| `GET /api/dashboard/service-timeline` | ☐ | ☐ |
| `GET /api/dashboard/service-activity` | ☐ | ☐ |
| `GET /api/invoices/list` (normal) | ☐ | ☐ |
| `GET /api/invoices/list?status=overdue` | ☐ | ☐ |
| `GET /api/bills/list?page=1&limit=50` | ☐ | ☐ |
| `GET /api/bills/list` (default bound) | ☐ | ☐ |
| `GET /api/payroll/runs` | ☐ | ☐ |
| `GET /api/accounting/reports/profit-and-loss` | ☐ | ☐ |

---

## 5. Results — 50 active users (`workday_50`)

**Command (Windows — set SCENARIO, not `--scenario`):**

```powershell
$env:SCENARIO = "workday_50"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://your-staging-url.com" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js
```

| Metric | Value | Threshold | Pass? |
|--------|------:|-------------|-------|
| `http_req_failed` rate | | < 1% | ☐ |
| `http_req_duration` p50 | | — | |
| `http_req_duration` p95 | | < 2000 ms | ☐ |
| `http_req_duration` p99 | | — | |
| Iterations | | — | |
| VUs max | 50 | — | |

---

## 6. Results — 100 active users (`workday_100`)

| Metric | Value | Threshold | Pass? |
|--------|------:|-------------|-------|
| `http_req_failed` rate | | < 1% | ☐ |
| p50 | | — | |
| p95 | | < 3000 ms | ☐ |
| p99 | | — | |

---

## 7. Results — 200 active users (`workday_200`)

| Metric | Value | Threshold | Pass? |
|--------|------:|-------------|-------|
| `http_req_failed` rate | | < 1% | ☐ |
| p50 | | — | |
| p95 | | < 5000 ms | ☐ |
| p99 | | — | |

---

## 8. Results — 500 stress (`stress_500`)

| Metric | Value | Threshold | Pass? |
|--------|------:|-------------|-------|
| `http_req_failed` rate | | < 5% (informational) | ☐ |
| p50 | | — | |
| p95 | | < 8000 ms | ☐ |
| p99 | | — | |

---

## 9. Per-endpoint latency (fill from k6 `http_req_duration` tags or custom trends)

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | Error % |
|----------|----------|----------|----------|---------|
| `business/profile` | | | | |
| `dashboard/service-metrics` | | | | |
| `dashboard/service-timeline` | | | | |
| `dashboard/service-activity` | | | | |
| `invoices/list` | | | | |
| `invoices/list overdue` | | | | |
| `bills/list` | | | | |
| `bills/list default` | | | | |
| `payroll/runs` | | | | |
| `reports/profit-and-loss` | | | | |

**Slowest endpoints (ranked):**

1.
2.
3.

---

## 10. Error rate summary

| HTTP status | Count | % | Sample error body |
|-------------|------:|--:|-------------------|
| 401 | | | |
| 403 | | | |
| 500 | | | |
| Timeout | | | |

---

## 11. Supabase / infrastructure notes

| Metric | During test | Notes |
|--------|-------------|-------|
| CPU avg / peak | | |
| Memory | | |
| Active connections | | |
| Pooler wait | | |
| Disk IO | | |
| Statement timeouts | | |

Vercel function duration / timeout counts:

---

## 12. P0 fix verification

| Fix | Evidence |
|-----|----------|
| Bills default ≤50 rows | `bills/list default` response `pagination.limit` = |
| Overdue paginated | Overdue response length ≤25; no timeout at 200 VUs |
| Cash RPC | `service-metrics` p95 vs pre-P0 baseline |
| Indexes | Query plans improved? (optional `EXPLAIN`) |

---

## 13. Suspected bottlenecks

| # | Area | Evidence | Severity |
|---|------|----------|----------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## 14. Recommended next fixes

| Priority | Fix | Expected impact |
|----------|-----|-----------------|
| P1 | | |
| P1 | | |
| P2 | | |

---

## 15. Verdict

**Can Finza handle 200 active users on this dataset after P0 fixes?**

☐ Yes — p95 within threshold, error rate < 1%  
☐ Partial — some routes fail thresholds  
☐ No — systemic failures or DB saturation  

**One-paragraph summary:**

---

## Appendix — k6 output

Paste `k6 run` summary block or attach JSON:

```bash
k6 run --out json=results/workday_200.json ...
```
