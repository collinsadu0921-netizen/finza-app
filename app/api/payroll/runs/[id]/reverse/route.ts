import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapReversePayrollRunAtomicError } from "@/lib/payroll/mapReversePayrollAtomicError"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_REVERSE
    )
    if (!allowed) {
      return NextResponse.json(
        {
          error: "Payroll reversal permission required",
          code: "PAYROLL_REVERSAL_PERMISSION_DENIED",
        },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const reversalDate = String((body as any).reversal_date || "").trim()
    const reason = String((body as any).reason || "").trim()
    const createCorrectionDraft =
      (body as any).create_correction_draft === undefined
        ? true
        : Boolean((body as any).create_correction_draft)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reversalDate)) {
      return NextResponse.json(
        { error: "reversal_date must be YYYY-MM-DD", code: "PAYROLL_REVERSAL_CONFLICT" },
        { status: 400 }
      )
    }
    if (reason.length < 3 || reason.length > 500) {
      return NextResponse.json(
        {
          error: "Reversal reason must contain between 3 and 500 characters",
          code: "PAYROLL_REVERSAL_CONFLICT",
        },
        { status: 400 }
      )
    }

    const { data, error } = await supabase.rpc("reverse_payroll_run_atomic", {
      p_business_id: business.id,
      p_payroll_run_id: runId,
      p_reversal_date: reversalDate,
      p_reason: reason,
      p_create_correction_draft: createCorrectionDraft,
    })

    if (error) {
      const mapped = mapReversePayrollRunAtomicError(error)
      return NextResponse.json(mapped, { status: mapped.status })
    }

    return NextResponse.json(data, { status: 200 })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error", code: "PAYROLL_REVERSAL_CONFLICT" },
      { status: 500 }
    )
  }
}
