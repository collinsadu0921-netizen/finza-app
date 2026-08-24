import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceMaterialsWorkspaceRead } from "@/lib/service/enforceMaterialsWorkspaceRead"
import {
  assembleMaterialsWorkspaceRows,
  loadLastMovementsForMaterials,
  loadMaterialsWorkspacePage,
  loadMaterialsWorkspaceSummary,
  materialsWorkspacePagination,
  parseMaterialsWorkspaceFilters,
} from "@/lib/service/materialsWorkspaceLoad"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

/**
 * GET /api/service/materials/workspace
 * Inventory rows plus last movement metadata per material (materials list page).
 */
export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("materials_workspace")
  const respond = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0), desc: "handler" }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    diag.recordTiming("auth", timedStepMs(tAuth), "session")
    if (!user) {
      return respond({ error: "Unauthorized" }, 401)
    }

    const tBusiness = performance.now()
    const business = await getCurrentBusiness(supabase, user.id)
    diag.recordTiming("business", timedStepMs(tBusiness), "session")
    if (!business) {
      return respond({ error: "Business not found" }, 404)
    }

    const tEntitlement = performance.now()
    const denied = await enforceMaterialsWorkspaceRead(supabase, user.id, business, "professional")
    diag.recordTiming("entitlement", timedStepMs(tEntitlement), "reuse")
    if (denied) {
      const body = await denied.json().catch(() => ({ error: "Forbidden" }))
      return respond(body, denied.status)
    }

    const filters = parseMaterialsWorkspaceFilters(new URL(request.url).searchParams)
    const businessId = String(business.id)

    const tData = performance.now()
    const [pageResult, summary] = await Promise.all([
      loadMaterialsWorkspacePage(supabase, businessId, filters),
      loadMaterialsWorkspaceSummary(supabase, businessId),
    ])
    const dataMs = timedStepMs(tData)
    diag.recordTiming("items", dataMs, "page")
    diag.recordTiming("count", 0, "included_in_items")
    diag.recordTiming("summary", dataMs, "parallel")

    const tInventory = performance.now()
    const lastByMaterial = await loadLastMovementsForMaterials(
      supabase,
      businessId,
      pageResult.materials.map((row) => row.id)
    )
    diag.recordTiming("inventory", timedStepMs(tInventory), "last_movement")

    const tAssembly = performance.now()
    const rows = assembleMaterialsWorkspaceRows(pageResult.materials, lastByMaterial)
    const payload = {
      rows,
      pagination: materialsWorkspacePagination(filters.page, filters.limit, pageResult.count),
      summary,
    }
    diag.recordTiming("assembly", timedStepMs(tAssembly))
    return respond(payload, 200)
  } catch (err: unknown) {
    console.error("GET /api/service/materials/workspace:", err)
    return respond(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
}
