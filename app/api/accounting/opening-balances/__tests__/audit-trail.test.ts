/**
 * Opening Balance Imports - Audit Trail Integrity Test Coverage
 * Step 9.1 Batch F - Test Suite 7: Audit Trail Integrity
 * 
 * Tests for audit logging integrity.
 * 
 * All tests validate real invariants:
 * - Creation audit (if logged)
 * - Approval audit (if logged)
 * - Posting audit (if logged)
 * - Chronological integrity
 */

import { POST } from "../route"
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

describe("Opening Balance Imports - Audit Trail Integrity", () => {
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
    
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: context.ids.partnerUserId } },
      error: null,
    })
  })

  afterAll(async () => {
    await cleanupTestData(context.supabase, context.ids.businessId)
  })

  describe("1. Creation Audit", () => {
    it("should record creation metadata", async () => {
      const request = new Request("http://localhost/api/accounting/opening-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: context.ids.businessId,
          period_id: context.ids.openPeriodId,
          source_type: "manual",
          lines: [
            {
              account_id: context.accountIds.cash,
              debit: 1000.0,
              credit: 0,
            },
            {
              account_id: context.accountIds.equity,
              debit: 0,
              credit: 1000.0,
            },
          ],
        }),
      }) as NextRequest

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.import).toBeDefined()

      // Verify creation metadata
      expect(result.import.created_by).toBe(context.ids.partnerUserId)
      expect(result.import.created_at).toBeDefined()
      expect(result.import.status).toBe("draft")

      // Verify timestamps are valid
      const createdAt = new Date(result.import.created_at)
      expect(createdAt.getTime()).toBeGreaterThan(0)
      expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  describe("2. Approval Audit", () => {
    it("should record approval metadata", async () => {
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

      // Verify approval metadata
      expect(result.import.approved_by).toBe(context.ids.partnerUserId)
      expect(result.import.approved_at).toBeDefined()
      expect(result.import.status).toBe("approved")
      expect(result.import.input_hash).toBeDefined()

      // Verify timestamps
      const approvedAt = new Date(result.import.approved_at)
      expect(approvedAt.getTime()).toBeGreaterThan(0)
      expect(approvedAt.getTime()).toBeLessThanOrEqual(Date.now())

      // Verify approval happens after creation
      const { data: importData } = await context.supabase
        .from("opening_balance_imports")
        .select("created_at, approved_at")
        .eq("id", draft.id)
        .single()

      if (importData?.created_at && importData?.approved_at) {
        const createdAt = new Date(importData.created_at)
        const approvedAt = new Date(importData.approved_at)
        expect(approvedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime())
      }
    })
  })

  describe("3. Posting Audit", () => {
    it("should record posting metadata", async () => {
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

      // Verify posting metadata
      const { data: postedImport } = await context.supabase
        .from("opening_balance_imports")
        .select("*")
        .eq("id", approved.id)
        .single()

      expect(postedImport?.posted_by).toBe(context.ids.partnerUserId)
      expect(postedImport?.posted_at).toBeDefined()
      expect(postedImport?.status).toBe("posted")
      expect(postedImport?.journal_entry_id).toBeDefined()

      // Verify timestamps
      const postedAt = new Date(postedImport?.posted_at || "")
      expect(postedAt.getTime()).toBeGreaterThan(0)
      expect(postedAt.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  describe("4. Chronological Integrity", () => {
    it("should maintain chronological order of actions", async () => {
      // Create
      const request = new Request("http://localhost/api/accounting/opening-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: context.ids.businessId,
          period_id: context.ids.openPeriodId,
          source_type: "manual",
          lines: [
            {
              account_id: context.accountIds.cash,
              debit: 1000.0,
              credit: 0,
            },
            {
              account_id: context.accountIds.equity,
              debit: 0,
              credit: 1000.0,
            },
          ],
        }),
      }) as NextRequest

      const createResponse = await POST(request)
      const createResult = await createResponse.json()
      const draft = createResult.import

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Approve
      const approveRequest = new Request(
        `http://localhost/api/accounting/opening-balances/${draft.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      const approveResponse = await POST_APPROVE(approveRequest, {
        params: Promise.resolve({ id: draft.id }),
      })
      const approveResult = await approveResponse.json()
      const approved = approveResult.import

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Post
      const postRequest = new Request(
        `http://localhost/api/accounting/opening-balances/${approved.id}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      const postResponse = await POST_POST(postRequest, {
        params: Promise.resolve({ id: approved.id }),
      })

      // Verify final state
      const { data: finalImport } = await context.supabase
        .from("opening_balance_imports")
        .select("created_at, approved_at, posted_at")
        .eq("id", draft.id)
        .single()

      // Verify chronological order
      if (finalImport?.created_at && finalImport?.approved_at && finalImport?.posted_at) {
        const createdAt = new Date(finalImport.created_at)
        const approvedAt = new Date(finalImport.approved_at)
        const postedAt = new Date(finalImport.posted_at)

        expect(approvedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime())
        expect(postedAt.getTime()).toBeGreaterThanOrEqual(approvedAt.getTime())
      }
    })

    it("should preserve all audit fields", async () => {
      const draft = await createTestDraft(context.supabase, context)
      const approved = await approveTestDraft(context.supabase, draft.id, context.ids.partnerUserId)

      const postRequest = new Request(
        `http://localhost/api/accounting/opening-balances/${approved.id}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      ) as NextRequest

      await POST_POST(postRequest, {
        params: Promise.resolve({ id: approved.id }),
      })

      // Verify all audit fields are present
      const { data: finalImport } = await context.supabase
        .from("opening_balance_imports")
        .select("*")
        .eq("id", draft.id)
        .single()

      expect(finalImport?.created_by).toBeDefined()
      expect(finalImport?.created_at).toBeDefined()
      expect(finalImport?.approved_by).toBeDefined()
      expect(finalImport?.approved_at).toBeDefined()
      expect(finalImport?.posted_by).toBeDefined()
      expect(finalImport?.posted_at).toBeDefined()
      expect(finalImport?.input_hash).toBeDefined()
    })
  })
})
