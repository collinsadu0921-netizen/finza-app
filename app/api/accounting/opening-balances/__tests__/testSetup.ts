/**
 * Test Setup Helper for Opening Balance Import API Tests
 * Step 9.1 Batch F
 * 
 * Provides setup/teardown utilities for API route tests
 */

import { createTestSupabaseClient, getTestIds, verifyTestEnvironment } from "@/lib/accounting/__tests__/testHelpers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/supabase"

export type TestContext = {
  supabase: SupabaseClient<Database>
  ids: ReturnType<typeof getTestIds>
  accountIds: {
    cash: string
    ar: string
    ap: string
    equity: string
  }
}

/**
 * Setup test context with database client and test IDs
 */
export async function setupTestContext(): Promise<TestContext> {
  // Verify environment
  verifyTestEnvironment()

  // Create test client
  const supabase = createTestSupabaseClient()
  const ids = getTestIds()

  // Get account IDs from test database
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code")
    .eq("business_id", ids.businessId)
    .in("code", ["1000", "1200", "2000", "3000"])

  if (!accounts || accounts.length < 4) {
    throw new Error(
      "Test accounts not found. Ensure TEST_DATABASE_SEED.sql has been run."
    )
  }

  const accountIds = {
    cash: accounts.find((a) => a.code === "1000")?.id || "",
    ar: accounts.find((a) => a.code === "1200")?.id || "",
    ap: accounts.find((a) => a.code === "2000")?.id || "",
    equity: accounts.find((a) => a.code === "3000")?.id || "",
  }

  return {
    supabase,
    ids,
    accountIds,
  }
}

/**
 * Clean up test data (opening balance imports)
 */
export async function cleanupTestData(supabase: SupabaseClient<Database>, businessId: string) {
  // Delete any opening balance imports for test business
  await supabase
    .from("opening_balance_imports")
    .delete()
    .eq("client_business_id", businessId)

  // Note: We don't delete journal entries as they're append-only
  // Tests should verify they exist, not clean them up
}

/**
 * Create a test draft import
 */
export async function createTestDraft(
  supabase: SupabaseClient<Database>,
  context: TestContext,
  lines?: Array<{ account_id: string; debit: number; credit: number; memo?: string | null }>
) {
  const defaultLines = lines || [
    {
      account_id: context.accountIds.cash,
      debit: 1000.0,
      credit: 0,
      memo: "Opening cash",
    },
    {
      account_id: context.accountIds.equity,
      debit: 0,
      credit: 1000.0,
      memo: "Opening equity",
    },
  ]

  const { data: importData, error } = await supabase
    .from("opening_balance_imports")
    .insert({
      accounting_firm_id: context.ids.firmId,
      client_business_id: context.ids.businessId,
      period_id: context.ids.openPeriodId,
      source_type: "manual",
      lines: defaultLines,
      status: "draft",
      created_by: context.ids.partnerUserId,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create test draft: ${error.message}`)
  }

  return importData
}

/**
 * Approve a draft import (bypasses API, directly updates DB)
 */
export async function approveTestDraft(
  supabase: SupabaseClient<Database>,
  importId: string,
  approvedBy: string
) {
  // Get import to build canonical payload
  const { data: importData } = await supabase
    .from("opening_balance_imports")
    .select("*")
    .eq("id", importId)
    .single()

  if (!importData) {
    throw new Error("Import not found")
  }

  // Build canonical payload to get input_hash
  const { buildCanonicalOpeningBalancePayload } = await import(
    "@/lib/accounting/openingBalanceImports"
  )

  const canonicalPayload = buildCanonicalOpeningBalancePayload({
    id: importData.id,
    accounting_firm_id: importData.accounting_firm_id,
    client_business_id: importData.client_business_id,
    period_id: importData.period_id,
    source_type: importData.source_type as "manual" | "csv" | "excel",
    lines: importData.lines as any[],
    total_debit: Number(importData.total_debit),
    total_credit: Number(importData.total_credit),
    approved_by: approvedBy,
  })

  // Update to approved
  const { data: approved, error } = await supabase
    .from("opening_balance_imports")
    .update({
      status: "approved",
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      input_hash: canonicalPayload.input_hash,
    })
    .eq("id", importId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to approve test draft: ${error.message}`)
  }

  return approved
}

/**
 * Setup mocks for route handler testing
 */
export function setupRouteMocks(
  supabase: SupabaseClient<Database>,
  userId: string
) {
  // Mock createSupabaseServerClient
  const supabaseServerModule = require("@/lib/supabaseServer")
  const mockSupabase = {
    ...supabase,
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: userId } },
        error: null,
      })),
    },
  }
  supabaseServerModule.createSupabaseServerClient = jest.fn(async () => mockSupabase)
  
  return mockSupabase
}
