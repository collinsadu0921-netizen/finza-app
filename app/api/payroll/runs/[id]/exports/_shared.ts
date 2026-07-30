import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  buildSnapshotExportResponse,
  isImmutablePayrollRunStatus,
  legacySnapshotMissingResponse,
  loadPayrollExportSnapshot,
  normalizePayrollExportMode,
  queryPayrollExportSnapshotFallback,
  reversedPreparationBlockedResponse,
  verifySnapshotContentHashes,
  type PayrollExportMode,
  type PayrollExportType,
} from "@/lib/payroll/exportSnapshotDownload"

export async function getAuthorizedPayrollRunForExport(
  request: NextRequest,
  runId: string
): Promise<
  | { error: NextResponse }
  | { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; business: any; payrollRun: any }
> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const business = await getCurrentBusiness(supabase, user.id)
  if (!business) return { error: NextResponse.json({ error: "Business not found" }, { status: 404 }) }

  const tierDenied = await enforceServiceIndustryMinTier(
    supabase,
    user.id,
    business.id,
    "professional"
  )
  if (tierDenied) return { error: tierDenied }

  const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_EXPORT)
  if (!allowed) {
    return {
      error: NextResponse.json(
        {
          error: "Payroll export permission required",
          code: "PAYROLL_EXPORT_PERMISSION_DENIED",
        },
        { status: 403 }
      ),
    }
  }

  const { data: payrollRun, error: runError } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("id", runId)
    .eq("business_id", business.id)
    .is("deleted_at", null)
    .single()

  if (runError || !payrollRun) {
    return { error: NextResponse.json({ error: "Payroll run not found" }, { status: 404 }) }
  }

  return { supabase, business, payrollRun }
}

export function resolveExportMode(request: NextRequest): PayrollExportMode {
  return normalizePayrollExportMode(request.nextUrl.searchParams.get("mode"))
}

export async function serveImmutablePayrollExport(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  business: { id: string }
  payrollRun: Record<string, unknown>
  exportType: PayrollExportType
  mode: PayrollExportMode
  filenamePrefix: string
  legacyAuditContent?: () => Promise<NextResponse | null>
}): Promise<NextResponse> {
  const { supabase, business, payrollRun, exportType, mode, filenamePrefix, legacyAuditContent } = args
  const runStatus = String(payrollRun.status || "").toLowerCase()

  if (mode === "preparation" && runStatus === "reversed") {
    return reversedPreparationBlockedResponse()
  }

  const loaded = await loadPayrollExportSnapshot(
    supabase,
    business.id,
    String(payrollRun.id),
    exportType,
    mode,
    true
  )
  if ("error" in loaded && loaded.error) return loaded.error

  let snapshot = "snapshot" in loaded ? loaded.snapshot : null
  if ("notFound" in loaded && loaded.notFound) {
    if (mode === "preparation") {
      return legacySnapshotMissingResponse(mode)
    }
    if (legacyAuditContent) {
      const legacy = await legacyAuditContent()
      if (legacy) return legacy
    }
    return legacySnapshotMissingResponse(mode)
  }

  if (!snapshot) {
    const fallback = await queryPayrollExportSnapshotFallback(
      supabase,
      business.id,
      String(payrollRun.id),
      exportType
    )
    if (!fallback) {
      if (mode === "preparation") return legacySnapshotMissingResponse(mode)
      if (legacyAuditContent) {
        const legacy = await legacyAuditContent()
        if (legacy) return legacy
      }
      return legacySnapshotMissingResponse(mode)
    }
    const verification = verifySnapshotContentHashes(fallback)
    if (!verification.ok) {
      return NextResponse.json(
        {
          error: `Payroll export snapshot failed hash verification (${verification.errors.join(", ")})`,
          code: "PAYROLL_EXPORT_SNAPSHOT_CORRUPTED",
        },
        { status: 500 }
      )
    }
    snapshot = fallback
  }

  try {
    return buildSnapshotExportResponse({
      snapshot,
      mode,
      payrollRun,
      filenamePrefix,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to render payroll export snapshot"
    return NextResponse.json({ error: message, code: "PAYROLL_EXPORT_RENDER_FAILED" }, { status: 500 })
  }
}

export { isImmutablePayrollRunStatus }
