/**
 * Test Helpers for Opening Balance Import Tests
 * Step 9.1 Batch F
 * 
 * Provides utilities for test database setup and API testing
 */

import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/supabase"

/**
 * Create a Supabase client for testing using service role key
 * This bypasses RLS and allows direct database access
 */
export function createTestSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing test environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    )
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Get test data IDs from environment
 */
export function getTestIds() {
  return {
    firmId: process.env.TEST_FIRM_ID!,
    businessId: process.env.TEST_BUSINESS_ID!,
    partnerUserId: process.env.TEST_PARTNER_USER_ID!,
    seniorUserId: process.env.TEST_SENIOR_USER_ID!,
    juniorUserId: process.env.TEST_JUNIOR_USER_ID!,
    openPeriodId: process.env.TEST_OPEN_PERIOD_ID!,
    lockedPeriodId: process.env.TEST_LOCKED_PERIOD_ID!,
    engagementId: process.env.TEST_ENGAGEMENT_ID!,
  }
}

/**
 * Verify test environment is configured
 */
export function verifyTestEnvironment() {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TEST_FIRM_ID",
    "TEST_BUSINESS_ID",
    "TEST_PARTNER_USER_ID",
    "TEST_OPEN_PERIOD_ID",
  ]

  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(
      `Missing required test environment variables: ${missing.join(", ")}`
    )
  }
}

/**
 * Create a mock NextRequest for API route testing
 */
export function createMockRequest(
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: any,
  headers?: Record<string, string>
): Request {
  const requestInit: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  }

  if (body) {
    requestInit.body = JSON.stringify(body)
  }

  return new Request(url, requestInit)
}

/**
 * Helper to wait for async operations
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
