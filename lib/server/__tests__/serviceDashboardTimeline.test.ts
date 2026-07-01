/**
 * serviceDashboardTimeline loader — 509 summary-first + controlled first-load fallback.
 */

import {
  isTimelineResultCacheable,
  loadServiceDashboardTimeline,
  shouldCacheDashboardClusterPayload,
} from "../serviceDashboardTimeline"

function mockSupabase(handlers: Record<string, jest.Mock>) {
  return {
    rpc: jest.fn((name: string, args?: unknown) => {
      const fn = handlers[name]
      if (!fn) {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } })
      }
      return fn(args)
    }),
  } as any
}

const diag = {
  step: jest.fn(),
  fail: jest.fn(),
  finish: jest.fn(),
} as any

const row = (i: number) => ({
  period_id: `p-${i}`,
  period_start: `2026-0${i}-01`,
  period_end: `2026-0${i}-28`,
  revenue: 100 * i,
  expenses: 40,
  net_profit: 60 * i,
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe("loadServiceDashboardTimeline", () => {
  it("returns fresh summary when rows exist", async () => {
    const supabase = mockSupabase({
      get_service_dashboard_timeline_from_summary: jest
        .fn()
        .mockResolvedValue({ data: [row(1), row(2)], error: null }),
    })

    const result = await loadServiceDashboardTimeline(supabase, "biz-a", 12, diag)
    expect(result.source).toBe("summary_fresh")
    expect(result.timeline).toHaveLength(2)
    expect(result.cacheable).toBe(true)
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "refresh_service_dashboard_period_summaries",
      expect.anything()
    )
  })

  it("returns stale summary and triggers background try_refresh", async () => {
    const tryRefresh = jest
      .fn()
      .mockResolvedValue({ data: { refreshed: true, lock_held: false, period_count: 2 }, error: null })
    const supabase = mockSupabase({
      get_service_dashboard_timeline_from_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      get_service_dashboard_timeline_stale_summary: jest
        .fn()
        .mockResolvedValue({ data: [row(1)], error: null }),
      try_refresh_service_dashboard_period_summaries: tryRefresh,
    })

    const result = await loadServiceDashboardTimeline(supabase, "biz-a", 12, diag)
    expect(result.source).toBe("summary_stale")
    expect(result.timeline).toHaveLength(1)
    await Promise.resolve()
    expect(tryRefresh).toHaveBeenCalled()
  })

  it("cold start runs blocking refresh then returns refreshed rows", async () => {
    let freshCalls = 0
    const supabase = mockSupabase({
      get_service_dashboard_timeline_from_summary: jest.fn().mockImplementation(() => {
        freshCalls += 1
        return Promise.resolve({
          data: freshCalls > 1 ? [row(1), row(2)] : [],
          error: null,
        })
      }),
      get_service_dashboard_timeline_stale_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      refresh_service_dashboard_period_summaries: jest
        .fn()
        .mockResolvedValue({ data: 2, error: null }),
    })

    const result = await loadServiceDashboardTimeline(supabase, "biz-a", 2, diag)
    expect(result.source).toBe("summary_refreshed")
    expect(result.timeline).toHaveLength(2)
    expect(supabase.rpc).toHaveBeenCalledWith("refresh_service_dashboard_period_summaries", {
      p_business_id: "biz-a",
      p_periods_limit: 2,
    })
  })

  it("lock held with stale summary returns stale without live scan", async () => {
    let staleCalls = 0
    const supabase = mockSupabase({
      get_service_dashboard_timeline_from_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      get_service_dashboard_timeline_stale_summary: jest.fn().mockImplementation(() => {
        staleCalls += 1
        return Promise.resolve({
          data: staleCalls >= 3 ? [row(1), row(2)] : [],
          error: null,
        })
      }),
      refresh_service_dashboard_period_summaries: jest
        .fn()
        .mockResolvedValue({ data: 0, error: null }),
      try_refresh_service_dashboard_period_summaries: jest.fn().mockResolvedValue({
        data: { refreshed: false, lock_held: true, period_count: 0 },
        error: null,
      }),
    })

    const result = await loadServiceDashboardTimeline(supabase, "biz-a", 12, diag)
    expect(result.source).toBe("summary_stale_lock")
    expect(result.timeline).toHaveLength(2)
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "get_service_dashboard_timeline",
      expect.anything()
    )
  })

  it("no summary + ledger uses live fallback once and populates summary in background", async () => {
    const blockingRefresh = jest.fn().mockResolvedValue({ data: 2, error: null })
    const supabase = mockSupabase({
      get_service_dashboard_timeline_from_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      get_service_dashboard_timeline_stale_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      refresh_service_dashboard_period_summaries: blockingRefresh,
      try_refresh_service_dashboard_period_summaries: jest.fn().mockResolvedValue({
        data: { refreshed: false, lock_held: false, period_count: 0 },
        error: null,
      }),
      get_service_dashboard_business_has_ledger_movement: jest
        .fn()
        .mockResolvedValue({ data: true, error: null }),
      get_service_dashboard_timeline: jest
        .fn()
        .mockResolvedValue({ data: [row(1)], error: null }),
    })

    const result = await loadServiceDashboardTimeline(supabase, "biz-a", 12, diag)
    expect(result.source).toBe("live_first_load_fallback")
    expect(result.timeline).toHaveLength(1)
    expect(result.cacheable).toBe(true)
    await Promise.resolve()
    expect(blockingRefresh).toHaveBeenCalledTimes(2)
  })

  it("no ledger movement allows empty cacheable result", async () => {
    const supabase = mockSupabase({
      get_service_dashboard_timeline_from_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      get_service_dashboard_timeline_stale_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      refresh_service_dashboard_period_summaries: jest
        .fn()
        .mockResolvedValue({ data: 0, error: null }),
      try_refresh_service_dashboard_period_summaries: jest.fn().mockResolvedValue({
        data: { refreshed: false, lock_held: false, period_count: 0 },
        error: null,
      }),
      get_service_dashboard_business_has_ledger_movement: jest
        .fn()
        .mockResolvedValue({ data: false, error: null }),
    })

    const result = await loadServiceDashboardTimeline(supabase, "biz-a", 12, diag)
    expect(result.source).toBe("empty")
    expect(result.timeline).toHaveLength(0)
    expect(result.cacheable).toBe(true)
  })

  it("empty with ledger but failed refresh is not cacheable", async () => {
    const supabase = mockSupabase({
      get_service_dashboard_timeline_from_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      get_service_dashboard_timeline_stale_summary: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
      refresh_service_dashboard_period_summaries: jest
        .fn()
        .mockResolvedValue({ data: 0, error: null }),
      try_refresh_service_dashboard_period_summaries: jest.fn().mockResolvedValue({
        data: { refreshed: false, lock_held: false, period_count: 0 },
        error: null,
      }),
      get_service_dashboard_business_has_ledger_movement: jest
        .fn()
        .mockResolvedValue({ data: true, error: null }),
      get_service_dashboard_timeline: jest
        .fn()
        .mockResolvedValue({ data: [], error: null }),
    })

    const result = await loadServiceDashboardTimeline(supabase, "biz-a", 12, diag)
    expect(result.source).toBe("empty_with_ledger")
    expect(result.cacheable).toBe(false)
    expect(result.diagnostic).toBe("summary_and_live_fallback_empty")
  })
})

describe("cache guards", () => {
  it("isTimelineResultCacheable rejects empty_with_ledger", () => {
    expect(
      isTimelineResultCacheable({ timeline: [], source: "empty_with_ledger", cacheable: false })
    ).toBe(false)
  })

  it("shouldCacheDashboardClusterPayload rejects empty timeline when metrics show movement", () => {
    expect(
      shouldCacheDashboardClusterPayload({
        timeline: [],
        metrics: { revenue: 87395, expenses: 0, netProfit: 0 },
      })
    ).toBe(false)
  })
})
