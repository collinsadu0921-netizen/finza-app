/**
 * loadServiceDashboardMetrics — summary-only path with ledger live fallback.
 */

import { loadServiceDashboardMetrics } from "@/lib/server/serviceDashboardMetricsLoader"
import { createRouteDiag } from "@/lib/server/routeDiagnostics"

jest.mock("@/lib/accounting/businessDate", () => ({
  getBusinessToday: jest.fn().mockResolvedValue("2026-07-09"),
}))
jest.mock("@/lib/accounting/reports/resolvePnLMovementRange", () => ({
  resolvePnLMovementRange: jest.fn(),
}))
jest.mock("@/lib/server/accountingSnapshotRefresh", () => ({
  enqueueSnapshotRefreshJob: jest.fn().mockResolvedValue("job-1"),
  periodHasLivePnlMovement: jest.fn().mockResolvedValue(true),
}))
jest.mock("@/lib/server/customerPaymentsCollected", () => ({
  loadCustomerPaymentsCollectedTotal: jest.fn().mockResolvedValue(0),
}))
jest.mock("@/lib/server/dashboardMetricsCache", () => ({
  dashboardMetricsCacheKey: jest.fn().mockReturnValue("metrics-cache-key"),
  isDashboardMetricsCacheEnabled: jest.fn().mockReturnValue(false),
  loadOrComputeDashboardMetrics: jest.fn(
    async (_key: string, compute: () => Promise<unknown>) => ({
      value: await compute(),
      source: "cache_miss" as const,
      cache_enabled: false,
    })
  ),
}))

import { resolvePnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"
import { enqueueSnapshotRefreshJob, periodHasLivePnlMovement } from "@/lib/server/accountingSnapshotRefresh"

const mockResolveRange = resolvePnLMovementRange as jest.MockedFunction<
  typeof resolvePnLMovementRange
>
const mockEnqueue = enqueueSnapshotRefreshJob as jest.MockedFunction<
  typeof enqueueSnapshotRefreshJob
>
const mockHasLiveMovement = periodHasLivePnlMovement as jest.MockedFunction<
  typeof periodHasLivePnlMovement
>

const defaultRange = {
  movementStart: "2026-07-01",
  movementEnd: "2026-07-31",
  period: {
    period_id: "period-july",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    resolution_reason: "latest_activity" as const,
  },
}

function positionsRpc() {
  return Promise.resolve({
    data: [
      {
        cash_balance: 420929.8,
        accounts_receivable: 737654.2,
        accounts_payable: 78768.41,
      },
    ],
    error: null,
  })
}

function unpaidRpc() {
  return Promise.resolve({
    data: {
      unpaid_total: 733574.2,
      unpaid_count: 300,
      overdue_total: 732554.2,
      overdue_count: 299,
    },
    error: null,
  })
}

function mockSupabase(rpcImpl: jest.Mock) {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { default_currency: "GHS" },
            error: null,
          }),
        }),
      }),
    }),
    rpc: rpcImpl,
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.FINZA_DASHBOARD_LIVE_FALLBACK_TIMEOUT_MS
  mockResolveRange.mockResolvedValue({ range: defaultRange, error: "" })
  mockHasLiveMovement.mockResolvedValue(true)
})

describe("loadServiceDashboardMetrics summary-only", () => {
  it("uses ledger live fallback when summary row is missing", async () => {
    const rpc = jest.fn().mockImplementation((name: string) => {
      if (name === "get_fresh_service_dashboard_period_pnl") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "finza_dashboard_pnl_totals") {
        return Promise.resolve({
          data: [{ revenue: 4133.34, expenses: 7119, net_profit: -2985.66 }],
          error: null,
        })
      }
      if (name === "finza_dashboard_positions_as_of") return positionsRpc()
      if (name === "get_operational_unpaid_invoices_total") return unpaidRpc()
      return Promise.resolve({ data: null, error: null })
    })

    const loadMeta = { source: "degraded" as const }
    const payload = await loadServiceDashboardMetrics(
      mockSupabase(rpc),
      "biz-load",
      {},
      createRouteDiag("dashboard_cluster", "biz-load"),
      { refreshOnRequest: false },
      loadMeta
    )

    expect(rpc).toHaveBeenCalledWith("finza_dashboard_pnl_totals", {
      p_business_id: "biz-load",
      p_start_date: "2026-07-01",
      p_end_date: "2026-07-31",
    })
    expect(rpc).not.toHaveBeenCalledWith(
      "get_service_dashboard_metrics",
      expect.anything()
    )
    expect(mockEnqueue).toHaveBeenCalled()
    expect(loadMeta.source).toBe("ledger_live_fallback")
    expect(payload.metrics_ready).toBe(true)
    expect(payload.snapshot_status).toBe("live_fallback")
    expect(payload.metrics_source).toBe("ledger_live_fallback")
    expect(payload.live_fallback_used).toBe(true)
    expect(payload.revenue).toBe(4133.34)
    expect(payload.expenses).toBe(7119)
    expect(payload.netProfit).toBe(-2985.66)
    expect(payload.accountsReceivable).toBe(737654.2)
    expect(payload.unpaidInvoicesTotal).toBe(733574.2)
  })

  it("returns not-ready metrics when live fallback times out", async () => {
    process.env.FINZA_DASHBOARD_LIVE_FALLBACK_TIMEOUT_MS = "50"
    const rpc = jest.fn().mockImplementation((name: string) => {
      if (name === "get_fresh_service_dashboard_period_pnl") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "finza_dashboard_pnl_totals") {
        return new Promise(() => {})
      }
      if (name === "finza_dashboard_positions_as_of") return positionsRpc()
      if (name === "get_operational_unpaid_invoices_total") return unpaidRpc()
      return Promise.resolve({ data: null, error: null })
    })

    const loadMeta = { source: "degraded" as const }
    const payload = await loadServiceDashboardMetrics(
      mockSupabase(rpc),
      "biz-load",
      {},
      createRouteDiag("dashboard_cluster", "biz-load"),
      { refreshOnRequest: false },
      loadMeta
    )

    expect(loadMeta.source).toBe("degraded")
    expect(payload.metrics_ready).toBe(false)
    expect(payload.snapshot_status).toBe("missing")
    expect(payload.live_fallback_timeout).toBe(true)
    expect(payload.unpaidInvoicesTotal).toBe(733574.2)
  })

  it("still calls live RPC when refresh-on-request is enabled", async () => {
    const rpc = jest.fn().mockImplementation((name: string) => {
      if (name === "get_fresh_service_dashboard_period_pnl") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "get_service_dashboard_metrics") {
        return Promise.resolve({
          data: {
            currency_code: "GHS",
            revenue: 100,
            expenses: 40,
            net_profit: 60,
            cash_collected: 10,
            cash_balance: 5,
            accounts_receivable: 2,
            accounts_payable: 1,
          },
          error: null,
        })
      }
      if (name === "get_operational_unpaid_invoices_total") {
        return Promise.resolve({
          data: {
            unpaid_total: 0,
            unpaid_count: 0,
            overdue_total: 0,
            overdue_count: 0,
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const loadMeta = { source: "degraded" as const }
    const payload = await loadServiceDashboardMetrics(
      mockSupabase(rpc),
      "biz-load",
      {},
      createRouteDiag("dashboard_metrics", "biz-load"),
      { refreshOnRequest: true },
      loadMeta
    )

    expect(rpc).toHaveBeenCalledWith("get_service_dashboard_metrics", expect.any(Object))
    expect(loadMeta.source).toBe("live")
    expect(payload.revenue).toBe(100)
  })
})
