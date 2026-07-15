/**
 * GET /api/dashboard/service-metrics — consolidated metrics RPC.
 */

import { GET } from "../service-metrics/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/accountingAuth", () => ({
  checkAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/accounting/businessDate", () => ({
  getBusinessToday: jest.fn().mockResolvedValue("2026-06-22"),
}))
jest.mock("@/lib/accounting/reports/resolvePnLMovementRange", () => ({
  resolvePnLMovementRange: jest.fn(),
}))
jest.mock("@/lib/server/customerPaymentsCollected", () => ({
  loadCustomerPaymentsCollectedTotal: jest.fn().mockResolvedValue(2500.5),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { resolvePnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"
import { loadCustomerPaymentsCollectedTotal } from "@/lib/server/customerPaymentsCollected"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockCheckAuth = checkAccountingAuthority as jest.MockedFunction<
  typeof checkAccountingAuthority
>
const mockResolveRange = resolvePnLMovementRange as jest.MockedFunction<
  typeof resolvePnLMovementRange
>
const mockLoadCustomerPayments = loadCustomerPaymentsCollectedTotal as jest.MockedFunction<
  typeof loadCustomerPaymentsCollectedTotal
>

const defaultRange = {
  movementStart: "2026-06-01",
  movementEnd: "2026-06-30",
  period: {
    period_id: "period-current",
    period_start: "2026-06-01",
    period_end: "2026-06-30",
    resolution_reason: "latest_activity" as const,
  },
}

const metricsPayload = {
  currency_code: "GHS",
  revenue: 10000,
  expenses: 4000,
  net_profit: 6000,
  cash_collected: 2500.5,
  cash_balance: 5000,
  accounts_receivable: 1200,
  accounts_payable: 800,
}

const operationalPayload = {
  unpaid_total: 900,
  unpaid_count: 4,
  overdue_total: 250,
  overdue_count: 2,
}

function mockDashboardRpc(rpcImpl?: jest.Mock) {
  const rpc =
    rpcImpl ??
    jest.fn().mockImplementation((name: string) => {
      if (name === "get_service_dashboard_metrics") {
        return Promise.resolve({ data: metricsPayload, error: null })
      }
      if (name === "get_operational_unpaid_invoices_total") {
        return Promise.resolve({ data: operationalPayload, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
  mockCreateSupabase.mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }),
    },
    rpc,
  } as any)
  return rpc
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckAuth.mockResolvedValue({ authorized: true } as any)
  mockResolveRange.mockResolvedValue({ range: defaultRange, error: "" })
  mockLoadCustomerPayments.mockResolvedValue(2500.5)
})

describe("GET /api/dashboard/service-metrics", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: jest.fn(),
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-metrics?business_id=biz-a")
    )
    expect(res.status).toBe(401)
  })

  it("returns required dashboard fields via get_service_dashboard_metrics RPC", async () => {
    const rpc = mockDashboardRpc()

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-metrics?business_id=biz-a")
    )
    expect(res.status).toBe(200)

    expect(rpc).toHaveBeenCalledWith("get_service_dashboard_metrics", {
      p_business_id: "biz-a",
      p_start_date: "2026-06-01",
      p_end_date: "2026-06-30",
      p_position_as_of_date: "2026-06-22",
      p_compare_start_date: null,
      p_compare_end_date: null,
    })
    expect(rpc).toHaveBeenCalledWith("get_operational_unpaid_invoices_total", {
      p_business_id: "biz-a",
    })

    const body = await res.json()
    expect(body).toMatchObject({
      revenue: 10000,
      expenses: 4000,
      netProfit: 6000,
      cashCollected: 2500.5,
      accountsReceivable: 1200,
      accountsPayable: 800,
      cashBalance: 5000,
      positionBalancesAsOfToday: true,
      positionAsOfDate: "2026-06-22",
      unpaidInvoicesTotal: 900,
      unpaidInvoicesCount: 4,
      overdueInvoicesTotal: 250,
      overdueInvoicesCount: 2,
    })
    expect(body.period).toMatchObject({
      period_id: "period-current",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
    })
    expect(body.currency).toMatchObject({ code: "GHS", symbol: "₵" })
    expect(body.previousPeriod).toBeNull()
  })

  it("loads cash collected from operational payments, not ledger cash debits", async () => {
    const rpc = mockDashboardRpc()
    const from = jest.fn()
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }),
      },
      rpc,
      from,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-metrics?business_id=biz-a")
    )
    expect(res.status).toBe(200)

    expect(rpc.mock.calls.some(([name]) => name === "get_cash_collected_total")).toBe(false)
    expect(from).not.toHaveBeenCalledWith("journal_entry_lines")

    const body = await res.json()
    expect(body.cashCollected).toBe(2500.5)
  })

  it("includes previousPeriod when previous_period_start resolves and RPC returns compare fields", async () => {
    mockResolveRange
      .mockResolvedValueOnce({ range: defaultRange, error: "" })
      .mockResolvedValueOnce({
        range: {
          movementStart: "2026-05-01",
          movementEnd: "2026-05-31",
          period: {
            period_id: "period-prev",
            period_start: "2026-05-01",
            period_end: "2026-05-31",
            resolution_reason: "period_start",
          },
        },
        error: "",
      })

    const rpc = mockDashboardRpc(
      jest.fn().mockImplementation((name: string) => {
        if (name === "get_service_dashboard_metrics") {
          return Promise.resolve({
            data: {
              ...metricsPayload,
              previous_revenue: 8000,
              previous_expenses: 3000,
              previous_net_profit: 5000,
              previous_cash_collected: 0,
              previous_cash_balance: 4500,
              previous_accounts_receivable: 900,
              previous_accounts_payable: 700,
            },
            error: null,
          })
        }
        if (name === "get_operational_unpaid_invoices_total") {
          return Promise.resolve({ data: operationalPayload, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
    )

    mockLoadCustomerPayments
      .mockResolvedValueOnce(2500.5)
      .mockResolvedValueOnce(1800)

    const res = await GET(
      new NextRequest(
        "http://localhost/api/dashboard/service-metrics?business_id=biz-a&previous_period_start=2026-05-01"
      )
    )
    expect(res.status).toBe(200)

    expect(rpc).toHaveBeenCalledWith(
      "get_service_dashboard_metrics",
      expect.objectContaining({
        p_compare_start_date: "2026-05-01",
        p_compare_end_date: "2026-05-31",
      })
    )

    const body = await res.json()
    expect(body.previousPeriod).toMatchObject({
      revenue: 8000,
      expenses: 3000,
      netProfit: 5000,
      cashCollected: 1800,
      cashBalance: 4500,
      accountsReceivable: 900,
      accountsPayable: 700,
    })
  })

  it("returns zero metrics when RPC returns zeros", async () => {
    mockLoadCustomerPayments.mockResolvedValue(0)
    const rpc = mockDashboardRpc(
      jest.fn().mockImplementation((name: string) => {
        if (name === "get_service_dashboard_metrics") {
          return Promise.resolve({
            data: {
              currency_code: "GHS",
              revenue: 0,
              expenses: 0,
              net_profit: 0,
              cash_collected: 0,
              cash_balance: 0,
              accounts_receivable: 0,
              accounts_payable: 0,
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
    )

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-metrics?business_id=biz-a")
    )
    const body = await res.json()
    expect(body.revenue).toBe(0)
    expect(body.netProfit).toBe(0)
    expect(body.cashCollected).toBe(0)
  })

  it("returns zero operational totals when operational RPC fails softly is not used on live path", async () => {
    const rpc = mockDashboardRpc(
      jest.fn().mockImplementation((name: string) => {
        if (name === "get_service_dashboard_metrics") {
          return Promise.resolve({ data: metricsPayload, error: null })
        }
        if (name === "get_operational_unpaid_invoices_total") {
          return Promise.resolve({ data: null, error: { message: "function does not exist" } })
        }
        return Promise.resolve({ data: null, error: null })
      })
    )

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-metrics?business_id=biz-a")
    )
    expect(res.status).toBe(500)
    expect(rpc).toHaveBeenCalledWith("get_operational_unpaid_invoices_total", {
      p_business_id: "biz-a",
    })
  })

  it("returns 500 when consolidated RPC fails", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "function does not exist" },
    })
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }),
      },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-metrics?business_id=biz-a")
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Could not load dashboard metrics")
  })

  it("returns 500 when period cannot be resolved", async () => {
    mockResolveRange.mockResolvedValueOnce({
      range: null,
      error: "Accounting period could not be resolved",
    })
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }),
      },
      rpc: jest.fn(),
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-metrics?business_id=biz-a")
    )
    expect(res.status).toBe(500)
  })
})
