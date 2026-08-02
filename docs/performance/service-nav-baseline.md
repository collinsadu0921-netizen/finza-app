# Service warm-navigation performance baseline

Use this when Playwright credentials are unavailable or for manual verification on staging.

## Prerequisites

- Staging URL and a service-workspace test account
- Chrome DevTools open (Network + Performance)

## Throttling (recommended)

DevTools → Network → **Slow 4G**  
DevTools → Performance → **CPU: 4× slowdown** (optional)

## Warm navigation chain

Perform each step **after** the prior page has fully loaded. Do not hard-refresh.

1. `/service/dashboard` → `/service/invoices`
2. `/service/invoices` → `/service/payments`
3. `/service/payments` → `/service/expenses`
4. `/service/expenses` → `/service/customers`
5. `/service/customers` → `/service/bills`

## Record per step

| Field | How |
|-------|-----|
| Navigation start | Click timestamp |
| First useful content | List/table or page H1 visible |
| Fetch/XHR count | Network filter Fetch/XHR from click until table visible |
| Failed requests | Any 4xx/5xx |
| Shell visible | Sidebar still visible during transition? (Y/N) |

## Save results

Copy into `tmp/service-nav-perf-baseline-manual.json` using the same shape as `tmp/service-nav-perf-baseline.json` from the Playwright spec.

## Automated baseline (preferred)

```bash
# Before changes
PERF_BASELINE_PHASE=before npx playwright test e2e/service-nav-perf.spec.ts

# After changes
PERF_BASELINE_PHASE=after npx playwright test e2e/service-nav-perf.spec.ts
```

Requires `E2E_SERVICE_EMAIL` and `E2E_SERVICE_PASSWORD` in `.env.local`.

No CI blocking thresholds in Sprint 1 — compare before/after request counts manually.
