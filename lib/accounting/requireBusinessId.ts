/**
 * Wave 6: Shared API helper — require business_id or return 400.
 * Use in all accounting and ledger API routes.
 */

import { NextResponse } from "next/server"
import { logAccountingApiWithoutBusinessId } from "./devContextLogger"

export const MISSING_BUSINESS_ID = "MISSING_BUSINESS_ID" as const

export function missingBusinessIdResponse(
  method: string,
  path: string,
  source?: string
): NextResponse {
  if (process.env.NODE_ENV === "development") {
    logAccountingApiWithoutBusinessId(method, path, source)
  }
  return NextResponse.json(
    { error: "Missing required parameter: business_id", error_code: MISSING_BUSINESS_ID },
    { status: 400 }
  )
}

/**
 * Get business_id from request URL search params (supports business_id and businessId).
 */
export function getBusinessIdFromRequest(request: Request): string | null {
  const url = request.url
  const searchParams = new URL(url).searchParams
  return searchParams.get("business_id")?.trim() ?? searchParams.get("businessId")?.trim() ?? null
}
