import type { SupabaseClient } from "@supabase/supabase-js"
import {
  EvatEnrollmentRequiredError,
  getBusinessEvatEnrollment,
  isBusinessEvatApproved,
  requireBusinessEvatApproval,
  type BusinessGraEvatEnrollmentRow,
} from "../enrollment"

function baseRow(
  overrides: Partial<BusinessGraEvatEnrollmentRow> = {}
): BusinessGraEvatEnrollmentRow {
  return {
    id: "e1",
    business_id: "b1",
    environment: "live",
    enrollment_status: "approved",
    gra_business_reference: null,
    taxpayer_evat_id: null,
    vsdc_id: null,
    credentials_ref: null,
    secret_config_encrypted: null,
    metadata: {},
    forms_received_at: null,
    forms_submitted_at: null,
    submitted_at: null,
    approved_at: null,
    rejected_at: null,
    suspended_at: null,
    revoked_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function mockClientForEnrollment(result: { data: unknown; error: { message: string } | null }) {
  const maybeSingle = jest.fn().mockResolvedValue(result)
  const eqEnv = jest.fn().mockReturnValue({ maybeSingle })
  const eqBiz = jest.fn().mockReturnValue({ eq: eqEnv })
  const select = jest.fn().mockReturnValue({ eq: eqBiz })
  const from = jest.fn().mockReturnValue({ select })
  return { supabase: { from } as unknown as SupabaseClient, maybeSingle, eqEnv, eqBiz, select, from }
}

describe("evat enrollment helpers", () => {
  it("getBusinessEvatEnrollment returns row", async () => {
    const row = baseRow()
    const { supabase } = mockClientForEnrollment({ data: row, error: null })
    await expect(getBusinessEvatEnrollment(supabase, "b1", "live")).resolves.toEqual(row)
  })

  it("getBusinessEvatEnrollment returns null when no row", async () => {
    const { supabase } = mockClientForEnrollment({ data: null, error: null })
    await expect(getBusinessEvatEnrollment(supabase, "b1", "live")).resolves.toBeNull()
  })

  it("getBusinessEvatEnrollment throws on Supabase error", async () => {
    const { supabase } = mockClientForEnrollment({ data: null, error: { message: "rls" } })
    await expect(getBusinessEvatEnrollment(supabase, "b1", "live")).rejects.toThrow(
      "Failed to load GRA E-VAT enrollment"
    )
  })

  it("isBusinessEvatApproved returns true when approved", async () => {
    const { supabase } = mockClientForEnrollment({ data: baseRow({ enrollment_status: "approved" }), error: null })
    await expect(isBusinessEvatApproved(supabase, "b1", "live")).resolves.toBe(true)
  })

  it("isBusinessEvatApproved returns false for draft", async () => {
    const { supabase } = mockClientForEnrollment({ data: baseRow({ enrollment_status: "draft" }), error: null })
    await expect(isBusinessEvatApproved(supabase, "b1", "live")).resolves.toBe(false)
  })

  it("isBusinessEvatApproved returns false for pending_gra", async () => {
    const { supabase } = mockClientForEnrollment({
      data: baseRow({ enrollment_status: "pending_gra" }),
      error: null,
    })
    await expect(isBusinessEvatApproved(supabase, "b1", "live")).resolves.toBe(false)
  })

  it("isBusinessEvatApproved returns false when no row", async () => {
    const { supabase } = mockClientForEnrollment({ data: null, error: null })
    await expect(isBusinessEvatApproved(supabase, "b1", "live")).resolves.toBe(false)
  })

  it("requireBusinessEvatApproval returns row when approved", async () => {
    const row = baseRow({ enrollment_status: "approved" })
    const { supabase } = mockClientForEnrollment({ data: row, error: null })
    await expect(requireBusinessEvatApproval(supabase, "b1", "live")).resolves.toEqual(row)
  })

  it("requireBusinessEvatApproval throws EvatEnrollmentRequiredError when draft", async () => {
    const { supabase } = mockClientForEnrollment({ data: baseRow({ enrollment_status: "draft" }), error: null })
    await expect(requireBusinessEvatApproval(supabase, "b1", "live")).rejects.toThrow(EvatEnrollmentRequiredError)
  })

  it("requireBusinessEvatApproval throws when no row", async () => {
    const { supabase } = mockClientForEnrollment({ data: null, error: null })
    await expect(requireBusinessEvatApproval(supabase, "b1", "test")).rejects.toThrow(EvatEnrollmentRequiredError)
  })
})
