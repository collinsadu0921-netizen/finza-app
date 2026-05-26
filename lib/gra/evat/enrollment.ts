/**
 * GRA E-VAT business enrollment reads for eligibility gating (Phase 3A).
 * Does not decrypt secrets or call GRA HTTP APIs.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type EvatEnvironment = "test" | "live"

export type EvatEnrollmentStatus =
  | "not_started"
  | "draft"
  | "pending_finza_review"
  | "submitted_to_gra"
  | "pending_gra"
  | "approved"
  | "rejected"
  | "suspended"
  | "revoked"

export type BusinessGraEvatEnrollmentRow = {
  id: string
  business_id: string
  environment: EvatEnvironment
  enrollment_status: EvatEnrollmentStatus
  gra_business_reference: string | null
  taxpayer_evat_id: string | null
  vsdc_id: string | null
  credentials_ref: string | null
  secret_config_encrypted: string | null
  metadata: Record<string, unknown>
  forms_received_at: string | null
  forms_submitted_at: string | null
  submitted_at: string | null
  approved_at: string | null
  rejected_at: string | null
  suspended_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

/** Stable error for unapproved or missing enrollment when submission is required. */
export class EvatEnrollmentRequiredError extends Error {
  readonly code = "EVAT_NOT_APPROVED" as const

  constructor(message = "Business GRA E-VAT enrollment is not approved for this environment.") {
    super(message)
    this.name = "EvatEnrollmentRequiredError"
  }
}

export async function getBusinessEvatEnrollment(
  supabase: SupabaseClient,
  businessId: string,
  environment: EvatEnvironment
): Promise<BusinessGraEvatEnrollmentRow | null> {
  const { data, error } = await supabase
    .from("business_gra_evat_enrollments")
    .select("*")
    .eq("business_id", businessId)
    .eq("environment", environment)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load GRA E-VAT enrollment: ${error.message}`)
  }

  if (!data) {
    return null
  }

  return data as unknown as BusinessGraEvatEnrollmentRow
}

export async function isBusinessEvatApproved(
  supabase: SupabaseClient,
  businessId: string,
  environment: EvatEnvironment
): Promise<boolean> {
  const row = await getBusinessEvatEnrollment(supabase, businessId, environment)
  return row?.enrollment_status === "approved"
}

export async function requireBusinessEvatApproval(
  supabase: SupabaseClient,
  businessId: string,
  environment: EvatEnvironment
): Promise<BusinessGraEvatEnrollmentRow> {
  const row = await getBusinessEvatEnrollment(supabase, businessId, environment)
  if (!row || row.enrollment_status !== "approved") {
    throw new EvatEnrollmentRequiredError(
      `GRA E-VAT submission requires enrollment_status approved for environment "${environment}".`
    )
  }
  return row
}
