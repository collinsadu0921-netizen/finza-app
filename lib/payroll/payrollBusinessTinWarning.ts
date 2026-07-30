export const PAYROLL_BUSINESS_TIN_DRAFT_TITLE = "Business TIN is missing"

export const PAYROLL_BUSINESS_TIN_DRAFT_BODY =
  "Add your business TIN in Company Settings before filing PAYE with GRA. Payroll can still be approved, but employer filing details may be incomplete."

export const PAYROLL_BUSINESS_TIN_APPROVED_TITLE =
  "Business TIN was not set when this payroll was approved"

export const PAYROLL_BUSINESS_TIN_APPROVED_BODY =
  "Add the TIN in Company Settings for future payroll filings. This payroll's approved export snapshot will remain unchanged."

export function normalizeBusinessTin(value: unknown): string {
  return String(value ?? "").trim()
}

export function isBusinessTinPresent(value: unknown): boolean {
  return normalizeBusinessTin(value).length > 0
}

export function extractSnapshotBusinessTin(sourcePayload: Record<string, unknown> | null | undefined): string {
  if (!sourcePayload || typeof sourcePayload !== "object") return ""
  const business = (sourcePayload.business || {}) as Record<string, unknown>
  return normalizeBusinessTin(business.tin)
}

export function resolveCompanySettingsPath(payrollBasePath: string): string {
  return payrollBasePath.startsWith("/service")
    ? "/service/settings/business-profile"
    : "/settings/business-profile"
}

export function shouldShowDraftBusinessTinWarning(
  status: string | null | undefined,
  currentBusinessTin: unknown
): boolean {
  return String(status || "").toLowerCase() === "draft" && !isBusinessTinPresent(currentBusinessTin)
}

export function shouldShowApprovedSnapshotBusinessTinWarning(
  status: string | null | undefined,
  approvedSnapshotBusinessTin: unknown
): boolean {
  const s = String(status || "").toLowerCase()
  return (s === "approved" || s === "locked") && !isBusinessTinPresent(approvedSnapshotBusinessTin)
}
