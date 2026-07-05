import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

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

  const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
  if (!allowed) return { error: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) }

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

