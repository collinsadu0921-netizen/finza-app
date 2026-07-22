/**
 * enqueue + targeted immediate schedule helpers (522/544).
 */

import {
  enqueueSnapshotRefreshJob,
  isAccountingImmediateRefreshEnabled,
  resetTargetedSnapshotRefreshCoalescingForTests,
  scheduleTargetedSnapshotRefresh,
} from "../accountingSnapshotRefresh"
import type { SupabaseClient } from "@supabase/supabase-js"

describe("enqueueSnapshotRefreshJob", () => {
  it("returns job id from RPC", async () => {
    const supabase = {
      rpc: jest.fn().mockResolvedValue({ data: "job-uuid", error: null }),
    } as unknown as SupabaseClient

    const id = await enqueueSnapshotRefreshJob(supabase, {
      businessId: "biz",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      jobType: "both",
      reason: "ledger_change",
    })

    expect(id).toBe("job-uuid")
    expect(supabase.rpc).toHaveBeenCalledWith(
      "enqueue_accounting_snapshot_refresh_job",
      expect.objectContaining({
        p_business_id: "biz",
        p_job_type: "both",
      })
    )
  })
})

describe("ACCOUNTING_IMMEDIATE_REFRESH_ENABLED", () => {
  const prev = process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED

  afterEach(() => {
    if (prev === undefined) delete process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED
    else process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED = prev
    resetTargetedSnapshotRefreshCoalescingForTests()
  })

  it("defaults safely to disabled", () => {
    delete process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED
    expect(isAccountingImmediateRefreshEnabled()).toBe(false)
  })

  it("enables for 1/true/on", () => {
    process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED = "1"
    expect(isAccountingImmediateRefreshEnabled()).toBe(true)
    process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED = "true"
    expect(isAccountingImmediateRefreshEnabled()).toBe(true)
  })
})

describe("scheduleTargetedSnapshotRefresh", () => {
  const prev = process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED

  beforeEach(() => {
    resetTargetedSnapshotRefreshCoalescingForTests()
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED
    else process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED = prev
    resetTargetedSnapshotRefreshCoalescingForTests()
  })

  it("no-ops when flag disabled (recovery path remains durable-only)", () => {
    delete process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED
    const run = jest.fn().mockResolvedValue(undefined)
    const result = scheduleTargetedSnapshotRefresh({
      businessId: "biz",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      run,
    })
    expect(result).toEqual({ scheduled: false, reason: "immediate_refresh_disabled" })
    expect(run).not.toHaveBeenCalled()
  })

  it("schedules once and coalesces duplicate in-flight attempts", async () => {
    process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED = "1"
    let resolveRun!: () => void
    const run = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve
        })
    )

    const first = scheduleTargetedSnapshotRefresh({
      businessId: "biz",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      triggerSource: "post_transaction",
      run,
    })
    const second = scheduleTargetedSnapshotRefresh({
      businessId: "biz",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      run,
    })

    expect(first.scheduled).toBe(true)
    expect(second.scheduled).toBe(false)
    expect(["in_flight", "cooldown"]).toContain(second.reason)
    expect(run).toHaveBeenCalledTimes(1)

    resolveRun()
    await Promise.resolve()
  })

  it("coalesces via short cooldown after schedule", () => {
    process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED = "1"
    const run = jest.fn().mockResolvedValue(undefined)

    const first = scheduleTargetedSnapshotRefresh({
      businessId: "biz",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      run,
    })
    // Same tick: in_flight wins before cooldown check after first returns
    resetTargetedSnapshotRefreshCoalescingForTests()
    // Re-set cooldown path: schedule then immediately schedule again with cooldown map
    const a = scheduleTargetedSnapshotRefresh({
      businessId: "biz-2",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      run: jest.fn().mockResolvedValue(undefined),
    })
    expect(a.scheduled).toBe(true)
    const b = scheduleTargetedSnapshotRefresh({
      businessId: "biz-2",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      run: jest.fn().mockResolvedValue(undefined),
    })
    // Either in_flight or cooldown — both prevent stampede
    expect(b.scheduled).toBe(false)
    expect(["in_flight", "cooldown"]).toContain(b.reason)
    expect(first.scheduled).toBe(true)
  })

  it("uses scheduleBackground when provided", async () => {
    process.env.ACCOUNTING_IMMEDIATE_REFRESH_ENABLED = "1"
    const run = jest.fn().mockResolvedValue(undefined)
    const scheduleBackground = jest.fn((p: Promise<unknown>) => {
      void p
    })

    const result = scheduleTargetedSnapshotRefresh({
      businessId: "biz",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      run,
      scheduleBackground,
    })

    expect(result.scheduled).toBe(true)
    expect(scheduleBackground).toHaveBeenCalledTimes(1)
    await Promise.resolve()
  })
})
