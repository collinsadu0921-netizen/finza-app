/**
 * Opening Balance Imports - Period Lock Enforcement Test Coverage
 * Step 9.1 Batch F - Test Suite 5: Period Lock Enforcement
 * 
 * Tests for period lock blocking approval and posting.
 * 
 * All tests validate real invariants:
 * - Approve blocked if period locked
 * - Post blocked if period locked
 * - No ledger mutation occurs on blocked attempts
 */

import { POST as POST_APPROVE } from "../[id]/approve/route"
import { POST as POST_POST } from "../[id]/post/route"
import { setupTestContext, cleanupTestData, createTestDraft, approveTestDraft } from "./testSetup"
import type { NextRequest } from "next/server"

// Mock Supabase server client
jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock("@/lib/firmOnboarding", () => ({
  checkFirmOnboardingForAction: jest.fn(async (supabase, userId, businessId) => ({
    isComplete: true,
    firmId: process.env.TEST_FIRM_ID,
  })),
}))

jest.mock("@/lib/firmEngagements", () => ({
  getActiveEngagement: jest.fn(async (supabase, firmId, businessId) => ({
    id: process.env.TEST_ENGAGEMENT_ID,
    status: "active",
    access_level: "approve",
    effective_from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    effective_to: null,
  })),
  isEngagementEffective: jest.fn(() => true),
}))

describe("Opening Balance Imports - Period Lock Enforcement", () => {
  let context: Awaited<ReturnType<typeof setupTestContext>>
  let mockSupabase: any

  beforeAll(async () => {
    context = await setupTestContext()
    
    const { createSupabaseServerClient } = require("@/lib/supabaseServer")
    mockSupabase = {
      ...context.supabase,
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: context.ids.partnerUserId } },
          error: null,
        })),
      },
    }
    createSupabaseServerClient.mockResolvedValue(mockSupabase)
  })

  beforeEach(async () => {
    await cleanupTestData(context.supabase, context.ids.businessId)
    
    // Ensure period is open
    await context.supabase
      .from("accounting_periods")
      .update({ status: "open" })
      .eq("id", context.ids.openPeriodId)
    
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: context.ids.partnerUserId } },
      error: null,
    })
  })

  afterAll(async () => {
    await cleanupTestData(context.supabase, context.ids.businessId)
    
    // Restore period to open
    await context.supabase
      .from("accounting_periods")
      .update({ status: "open" })
      .eq("id", context.ids.openPeriodId)
  })

  describe("1. Approval Blocked by Period Lock", () => {
    it("should block approval if period locked", async () => {
      const draft = await createTestDraft(context.supabase, context)

      // Lock the period
      await context.supabase
        .from("accounting_periods")
        .update({ status: "locked" })
        .eq("id", context.ids.openPeriodId)

      const request = new Request(
        `http://localhost/api/accounting/opening-balances/${draft.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      const response = await POST_APPROVE(request, {
        params: Promise.resolve({ id: draft.id }),
      })
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.reasonCode).toBe("PERIOD_LOCKED")

      // Verify status unchanged
      const { data: unchanged } = await context.supabase
        .from("opening_balance_imports")
        .select("*")
        .eq("id", draft.id)
        .single()

      expect(unchanged?.status).toBe("draft")
      expect(unchanged?.approved_by).toBeNull()
    })

    it("should allow approval if period open", async () => {
      // Ensure period is open
      await context.supabase
        .from("accounting_periods")
        .update({ status: "open" })
        .eq("id", context.ids.openPeriodId)

      const draft = await createTestDraft(context.supabase, context)

      const request = new Request(
        `http://localhost/api/accounting/opening-balances/${draft.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      const response = await POST_APPROVE(request, {
        params: Promise.resolve({ id: draft.id }),
      })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.import.status).toBe("approved")
    })
  })

  describe("2. Posting Blocked by Period Lock", () => {
    it("should block posting if period locked", async () => {
      const draft = await createTestDraft(context.supabase, context)
      const approved = await approveTestDraft(context.supabase, draft.id, context.ids.partnerUserId)

      // Lock the period
      await context.supabase
        .from("accounting_periods")
        .update({ status: "locked" })
        .eq("id", context.ids.openPeriodId)

      const { count: entriesBefore } = await context.supabase
        .from("journal_entries")
        .select("*", { count: "exact", head: true })
        .eq("business_id", context.ids.businessId)
        .eq("source_type", "opening_balance")

      const request = new Request(
        `http://localhost/api/accounting/opening-balances/${approved.id}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      const response = await POST_POST(request, {
        params: Promise.resolve({ id: approved.id }),
      })
      const result = await response.json()

      expect([400, 500]).toContain(response.status)
      expect(["PERIOD_LOCKED", "POST_FAILED"]).toContain(result.reasonCode)

      // Verify no journal entry created
      const { count: entriesAfter } = await context.supabase
        .from("journal_entries")
        .select("*", { count: "exact", head: true })
        .eq("business_id", context.ids.businessId)
        .eq("source_type", "opening_balance")

      expect(entriesAfter).toBe(entriesBefore || 0)

      // Verify status unchanged
      const { data: unchanged } = await context.supabase
        .from("opening_balance_imports")
        .select("*")
        .eq("id", approved.id)
        .single()

      expect(unchanged?.status).toBe("approved")
      expect(unchanged?.journal_entry_id).toBeNull()
    })

    it("should allow posting if period open", async () => {
      // Ensure period is open
      await context.supabase
        .from("accounting_periods")
        .update({ status: "open" })
        .eq("id", context.ids.openPeriodId)

      const draft = await createTestDraft(context.supabase, context)
      const approved = await approveTestDraft(context.supabase, draft.id, context.ids.partnerUserId)

      const request = new Request(
        `http://localhost/api/accounting/opening-balances/${approved.id}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      const response = await POST_POST(request, {
        params: Promise.resolve({ id: approved.id }),
      })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.journal_entry_id).toBeDefined()

      const { data: posted } = await context.supabase
        .from("opening_balance_imports")
        .select("*")
        .eq("id", approved.id)
        .single()

      expect(posted?.status).toBe("posted")
    })
  })

  describe("3. No Partial Ledger Mutation", () => {
    it("should not create partial journal entries on lock failure", async () => {
      const draft = await createTestDraft(context.supabase, context)
      const approved = await approveTestDraft(context.supabase, draft.id, context.ids.partnerUserId)

      // Lock the period
      await context.supabase
        .from("accounting_periods")
        .update({ status: "locked" })
        .eq("id", context.ids.openPeriodId)

      const { count: entriesBefore } = await context.supabase
        .from("journal_entries")
        .select("*", { count: "exact", head: true })
        .eq("business_id", context.ids.businessId)

      const { count: linesBefore } = await context.supabase
        .from("journal_entry_lines")
        .select("*", { count: "exact", head: true })

      const request = new Request(
        `http://localhost/api/accounting/opening-balances/${approved.id}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      const response = await POST_POST(request, {
        params: Promise.resolve({ id: approved.id }),
      })

      expect([400, 500]).toContain(response.status)

      // Verify no journal entries created
      const { count: entriesAfter } = await context.supabase
        .from("journal_entries")
        .select("*", { count: "exact", head: true })
        .eq("business_id", context.ids.businessId)

      expect(entriesAfter).toBe(entriesBefore || 0)

      // Verify no journal entry lines created
      const { count: linesAfter } = await context.supabase
        .from("journal_entry_lines")
        .select("*", { count: "exact", head: true })

      expect(linesAfter).toBe(linesBefore || 0)
    })

    it("should not update import status on lock failure", async () => {
      const draft = await createTestDraft(context.supabase, context)
      const approved = await approveTestDraft(context.supabase, draft.id, context.ids.partnerUserId)

      // Lock the period
      await context.supabase
        .from("accounting_periods")
        .update({ status: "locked" })
        .eq("id", context.ids.openPeriodId)

      const request = new Request(
        `http://localhost/api/accounting/opening-balances/${approved.id}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      await POST_POST(request, {
        params: Promise.resolve({ id: approved.id }),
      })

      // Verify import status unchanged
      const { data: unchanged } = await context.supabase
        .from("opening_balance_imports")
        .select("*")
        .eq("id", approved.id)
        .single()

      expect(unchanged?.status).toBe("approved")
      expect(unchanged?.journal_entry_id).toBeNull()
      expect(unchanged?.posted_by).toBeNull()
      expect(unchanged?.posted_at).toBeNull()
    })
  })
})
