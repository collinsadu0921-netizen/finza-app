/**
 * GET /api/staff/[id]/salary-history
 * Read-only employee salary history and payment attribution.
 */

import { GET } from "@/app/api/staff/[id]/salary-history/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/userPermissions", () => ({
  hasPermission: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTier: jest.fn().mockResolvedValue(null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission } from "@/lib/userPermissions"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockGetBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>
const mockHasPermission = hasPermission as jest.MockedFunction<typeof hasPermission>

type TableData = Record<
  string,
  unknown[] | Record<string, unknown> | null | ((call: number) => unknown[] | Record<string, unknown> | null)
>

function buildClient(options: {
  user?: { id: string } | null
  staff?: Record<string, unknown> | null
  tables?: TableData
}) {
  const tableCalls: Record<string, number> = {}
  const query = (table: string) => {
    const call = (tableCalls[table] = (tableCalls[table] || 0) + 1)
    const configured = options.tables?.[table]
    const value = typeof configured === "function" ? configured(call) : configured
    const resolved =
      value === undefined
        ? { data: [], error: null }
        : Array.isArray(value)
          ? { data: value, error: null }
          : { data: value, error: null }

    const q: Record<string, unknown> = {
      select: jest.fn(() => q),
      eq: jest.fn(() => q),
      in: jest.fn(() => q),
      is: jest.fn(() => q),
      not: jest.fn(() => q),
      gte: jest.fn(() => q),
      lte: jest.fn(() => q),
      order: jest.fn(() => q),
      limit: jest.fn(() => q),
      range: jest.fn(() => q),
      maybeSingle: jest.fn().mockResolvedValue(
        table === "staff"
          ? { data: options.staff ?? null, error: null }
          : { data: null, error: null }
      ),
      single: jest.fn().mockResolvedValue(resolved),
      then: (resolve: (value: unknown) => void) => resolve(resolved),
    }
    return q
  }

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: "user-1" } : options.user },
      }),
    },
    from: jest.fn((table: string) => query(table)),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1", name: "Test" } as any)
  mockHasPermission.mockResolvedValue(true)
})

describe("GET /api/staff/[id]/salary-history", () => {
  it("requires authentication", async () => {
    mockCreateSupabase.mockResolvedValue(buildClient({ user: null }) as any)
    const res = await GET(new NextRequest("http://localhost/api/staff/staff-1/salary-history"), {
      params: { id: "staff-1" },
    })
    expect(res.status).toBe(401)
  })

  it("requires payroll view or export permission", async () => {
    mockHasPermission.mockResolvedValue(false)
    mockCreateSupabase.mockResolvedValue(buildClient({}) as any)
    const res = await GET(new NextRequest("http://localhost/api/staff/staff-1/salary-history"), {
      params: { id: "staff-1" },
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("PAYROLL_VIEW_REQUIRED")
  })

  it("returns 404 for staff outside the current tenant", async () => {
    mockCreateSupabase.mockResolvedValue(buildClient({ staff: null }) as any)
    const res = await GET(new NextRequest("http://localhost/api/staff/staff-1/salary-history"), {
      params: { id: "staff-1" },
    })
    expect(res.status).toBe(404)
  })

  it("returns approved history with payment status and empty-state totals", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({
        staff: {
          id: "staff-1",
          name: "Ama",
          basic_salary: 3000,
          salary_basis: "monthly",
          employment_type: "full_time",
          start_date: "2025-01-01",
          status: "active",
        },
        tables: {
          payroll_entries: (call) =>
            call === 1
              ? [
                  {
                    id: "entry-1",
                    payroll_run_id: "run-1",
                    staff_id: "staff-1",
                    basic_salary: 3000,
                    gross_salary: 3000,
                    allowances_total: 0,
                    deductions_total: 0,
                    ssnit_employee: 165,
                    ssnit_employer: 390,
                    paye: 250,
                    net_salary: 2585,
                    is_included: true,
                    payroll_runs: {
                      id: "run-1",
                      payroll_month: "2026-09-01",
                      pay_period_start: "2026-09-01",
                      pay_period_end: "2026-09-30",
                      payroll_frequency: "monthly",
                      run_type: "regular",
                      status: "approved",
                      business_id: "biz-1",
                      reversed_at: null,
                    },
                  },
                ]
              : [
                  {
                    id: "year-row",
                    payroll_runs: {
                      id: "run-1",
                      payroll_month: "2026-09-01",
                      business_id: "biz-1",
                      status: "approved",
                    },
                  },
                ],
          payslips: [],
          payroll_payment_batch_items: [],
          payroll_payments: [],
        },
      }) as any
    )

    const res = await GET(new NextRequest("http://localhost/api/staff/staff-1/salary-history"), {
      params: { id: "staff-1" },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.staff.basic_salary).toBe(3000)
    expect(body.history).toHaveLength(1)
    expect(body.history[0].net_salary).toBe(2585)
    expect(body.history[0].payment_status).toBe("unpaid")
    expect(body.summary.total_net_salary).toBe(2585)
    expect(body.summary.total_confirmed_paid).toBe(0)
    expect(body.pagination.has_more).toBe(false)
  })

  it("shows aggregate-only salary as not individually verified", async () => {
    const historyEntry = {
      id: "entry-1",
      payroll_run_id: "run-1",
      staff_id: "staff-1",
      basic_salary: 3000,
      gross_salary: 3000,
      allowances_total: 0,
      deductions_total: 0,
      ssnit_employee: 165,
      ssnit_employer: 390,
      paye: 250,
      net_salary: 2585,
      is_included: true,
      payroll_runs: {
        id: "run-1",
        payroll_month: "2026-09-01",
        pay_period_start: "2026-09-01",
        pay_period_end: "2026-09-30",
        payroll_frequency: "monthly",
        run_type: "regular",
        status: "approved",
        business_id: "biz-1",
        reversed_at: null,
      },
    }

    mockCreateSupabase.mockResolvedValue(
      buildClient({
        staff: {
          id: "staff-1",
          name: "Ama",
          basic_salary: 3000,
          salary_basis: "monthly",
          employment_type: "full_time",
          start_date: "2025-01-01",
          status: "active",
        },
        tables: {
          payroll_entries: (call) =>
            call === 1
              ? [historyEntry]
              : [
                  {
                    id: "year-row",
                    payroll_runs: {
                      id: "run-1",
                      payroll_month: "2026-09-01",
                      business_id: "biz-1",
                      status: "approved",
                    },
                  },
                ],
          payslips: [],
          payroll_payment_batch_items: [],
          payroll_payments: [
            {
              id: "aggregate-1",
              batch_item_id: null,
              payroll_run_id: "run-1",
              amount: 2585,
              payment_date: "2026-09-28",
              reference: "BANK-AGG",
            },
          ],
        },
      }) as any
    )

    const res = await GET(new NextRequest("http://localhost/api/staff/staff-1/salary-history"), {
      params: { id: "staff-1" },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.history[0].payment_status).toBe("unverified")
    expect(body.history[0].payment_status_label).toBe("Payment not individually verified")
    expect(body.history[0].outstanding_amount).toBeNull()
    expect(body.history[0].aggregate_payments).toHaveLength(1)
    expect(body.summary.total_outstanding).toBe(0)
    expect(body.summary.total_unverified).toBe(2585)
  })

  it("returns an empty history for an employee with no approved payroll", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({
        staff: {
          id: "staff-2",
          name: "No History",
          basic_salary: 1200,
          salary_basis: "monthly",
          employment_type: "full_time",
          start_date: "2026-10-01",
          status: "active",
        },
        tables: {
          payroll_entries: [],
          payroll_payment_batch_items: [],
          payroll_payments: [],
        },
      }) as any
    )

    const res = await GET(new NextRequest("http://localhost/api/staff/staff-2/salary-history"), {
      params: { id: "staff-2" },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.history).toHaveLength(0)
    expect(body.summary.total_net_salary).toBe(0)
    expect(body.summary.period_count).toBe(0)
    expect(body.available_years).toEqual([])
  })

  it("keeps salary history visible for an employee who has left the business", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({
        staff: {
          id: "staff-3",
          name: "Former Employee",
          basic_salary: 2000,
          salary_basis: "monthly",
          employment_type: "full_time",
          start_date: "2024-01-01",
          status: "terminated",
        },
        tables: {
          payroll_entries: (call) =>
            call === 1
              ? [
                  {
                    id: "entry-3",
                    payroll_run_id: "run-3",
                    staff_id: "staff-3",
                    basic_salary: 2000,
                    gross_salary: 2000,
                    allowances_total: 0,
                    deductions_total: 0,
                    ssnit_employee: 110,
                    ssnit_employer: 260,
                    paye: 140,
                    net_salary: 1750,
                    is_included: true,
                    payroll_runs: {
                      id: "run-3",
                      payroll_month: "2026-02-01",
                      pay_period_start: "2026-02-01",
                      pay_period_end: "2026-02-28",
                      payroll_frequency: "monthly",
                      run_type: "regular",
                      status: "approved",
                      business_id: "biz-1",
                      reversed_at: null,
                    },
                  },
                ]
              : [
                  {
                    id: "year-row",
                    payroll_runs: {
                      id: "run-3",
                      payroll_month: "2026-02-01",
                      business_id: "biz-1",
                      status: "approved",
                    },
                  },
                ],
          payslips: [],
          payroll_payment_batch_items: [],
          payroll_payments: [],
        },
      }) as any
    )

    const res = await GET(new NextRequest("http://localhost/api/staff/staff-3/salary-history"), {
      params: { id: "staff-3" },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.staff.status).toBe("terminated")
    expect(body.history).toHaveLength(1)
    expect(body.history[0].net_salary).toBe(1750)
  })
})
