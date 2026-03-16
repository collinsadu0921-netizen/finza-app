/**
 * Smoke tests for P&L and Balance Sheet report APIs.
 * Run: npx ts-node scripts/smoke-report-apis.ts
 * Requires: NEXT_PUBLIC_APP_URL (default http://localhost:3000) and a valid business_id for authenticated requests.
 * For unauthenticated runs, only checks that endpoints exist (may get 401).
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

async function get(url: string): Promise<{ status: number; ok: boolean; data?: unknown }> {
  const res = await fetch(url, { method: "GET" })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = undefined
  }
  return { status: res.status, ok: res.ok, data }
}

async function main() {
  const businessId = process.env.SMOKE_BUSINESS_ID || "00000000-0000-0000-0000-000000000000"
  console.log("Smoke tests for report APIs (BASE=%s, business_id=%s)\n", BASE, businessId)

  const tests: { name: string; url: string; expectOk?: boolean }[] = [
    { name: "P&L — no params", url: `${BASE}/api/accounting/reports/profit-and-loss?business_id=${businessId}` },
    { name: "P&L — period_start", url: `${BASE}/api/accounting/reports/profit-and-loss?business_id=${businessId}&period_start=2024-01-01` },
    { name: "P&L — period_id (placeholder)", url: `${BASE}/api/accounting/reports/profit-and-loss?business_id=${businessId}&period_id=00000000-0000-0000-0000-000000000001` },
    { name: "P&L — as_of_date", url: `${BASE}/api/accounting/reports/profit-and-loss?business_id=${businessId}&as_of_date=2024-06-15` },
    { name: "Balance Sheet — no params", url: `${BASE}/api/accounting/reports/balance-sheet?business_id=${businessId}` },
    { name: "Balance Sheet — as_of_date", url: `${BASE}/api/accounting/reports/balance-sheet?business_id=${businessId}&as_of_date=2024-06-30` },
    { name: "Balance Sheet — period_id", url: `${BASE}/api/accounting/reports/balance-sheet?business_id=${businessId}&period_id=00000000-0000-0000-0000-000000000001` },
  ]

  for (const t of tests) {
    const result = await get(t.url)
    const ok = result.ok
    const hasPeriod = result.data && typeof result.data === "object" && "period" in (result.data as object)
    const hasTelemetry = result.data && typeof result.data === "object" && "telemetry" in (result.data as object)
    const hasSections = result.data && typeof result.data === "object" && "sections" in (result.data as object)
    const hasTotals = result.data && typeof result.data === "object" && "totals" in (result.data as object)
    console.log(
      "%s %s — status=%d, period=%s, telemetry=%s, sections=%s, totals=%s",
      ok ? "✓" : "✗",
      t.name,
      result.status,
      hasPeriod ? "yes" : "no",
      hasTelemetry ? "yes" : "no",
      hasSections ? "yes" : "no",
      hasTotals ? "yes" : "no"
    )
    if (!ok && result.data && typeof result.data === "object" && "error" in (result.data as object)) {
      console.log("  error: %s", (result.data as { error: string }).error)
    }
  }

  console.log("\nLegacy routes (same canonical response):")
  const legacyPnl = await get(`${BASE}/api/reports/profit-loss?business_id=${businessId}`)
  const legacyBs = await get(`${BASE}/api/reports/balance-sheet?business_id=${businessId}`)
  console.log("  /api/reports/profit-loss — status=%d, has period=%s", legacyPnl.status, legacyPnl.data && typeof legacyPnl.data === "object" && "period" in (legacyPnl.data as object) ? "yes" : "no")
  console.log("  /api/reports/balance-sheet — status=%d, has period=%s", legacyBs.status, legacyBs.data && typeof legacyBs.data === "object" && "period" in (legacyBs.data as object) ? "yes" : "no")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
