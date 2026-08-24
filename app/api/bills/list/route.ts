import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { loadBillsListEntitlementRow } from "@/lib/bills/billsListEntitlement"
import {
  decideMaterialsWorkspaceRead,
  lookupAccountingFirmUser,
} from "@/lib/service/enforceMaterialsWorkspaceRead"
import { loadOrComputeOperationalListCache } from "@/lib/server/operationalListCache"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  supabaseErrorDiag,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

type BillsListRpcResult = {
  total_count: number
  bills: Record<string, unknown>[]
}

type BillsListPayload = {
  bills: Record<string, unknown>[]
  pagination: {
    page: number
    limit: number
    total: number
    hasMore: boolean
  }
}

function rpcErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "RPC failed")
  }
  return "RPC failed"
}

function billsCacheKey(params: {
  businessId: string
  page: number
  limit: number
  supplierName: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  search: string | null
}): string {
  return [
    "bills_list",
    params.businessId,
    params.page,
    params.limit,
    params.supplierName ?? "",
    params.status ?? "",
    params.startDate ?? "",
    params.endDate ?? "",
    params.search ?? "",
  ].join("|")
}

async function loadBillsListPayload(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    businessId: string
    page: number
    limit: number
    supplierName: string | null
    status: string | null
    startDate: string | null
    endDate: string | null
    search: string | null
  },
  diag: ReturnType<typeof createRouteDiag>
): Promise<BillsListPayload> {
  const from = (params.page - 1) * params.limit
  const tRpc = performance.now()

  const { data, error } = await supabase.rpc("get_bills_list_page", {
    p_business_id: params.businessId,
    p_limit: params.limit,
    p_offset: from,
    p_supplier_name: params.supplierName || null,
    p_status: params.status || null,
    p_start_date: params.startDate || null,
    p_end_date: params.endDate || null,
    p_search: params.search || null,
  })

  const rpcMs = timedStepMs(tRpc)
  diag.recordTiming("bills_rpc", rpcMs, "get_bills_list_page")

  if (error) {
    diag.step("bills_rpc", {
      rpc: "get_bills_list_page",
      ms_rpc: rpcMs,
      ...supabaseErrorDiag(error),
    })
    throw error
  }

  const rpcResult = (data ?? { total_count: 0, bills: [] }) as BillsListRpcResult
  const tAssembly = performance.now()
  const bills = Array.isArray(rpcResult.bills) ? rpcResult.bills : []
  const total = Number(rpcResult.total_count) || 0
  const payload = {
    bills,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      hasMore: from + bills.length < total,
    },
  }
  diag.recordTiming("assembly", timedStepMs(tAssembly), "map")

  diag.step("bills_rpc", {
    rpc: "get_bills_list_page",
    ms_rpc: rpcMs,
    row_count: bills.length,
    total_count: total,
    page: params.page,
    limit: params.limit,
  })

  return payload
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const { searchParams } = new URL(request.url)
  const routeName =
    searchParams.has("page") || searchParams.has("limit")
      ? "bills_list_paginated"
      : "bills_list_default_bounded"
  const diag = createRouteDiag(routeName)
  const respond = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0), desc: "handler" }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const auth = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: request.headers.get("cookie"),
    })
    diag.recordTiming("auth", timedStepMs(tAuth), "session")

    if (!auth.ok) {
      diag.fail(auth.status, auth.error, { auth_failure_stage: auth.authFailureStage })
      return respond(
        { error: auth.error, auth_failure_stage: auth.authFailureStage },
        auth.status
      )
    }
    const user = auth.user

    const tScope = performance.now()
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId"),
      {
        diag: {
          recordTiming: (name, durMs, desc) =>
            diag.recordTiming(`scope_${name}`, durMs, desc),
          step: (name, fields) =>
            diag.step(
              `scope_${name}`,
              fields as Record<string, string | number | boolean | null | undefined>
            ),
        },
      }
    )
    diag.recordTiming("scope", timedStepMs(tScope), "tenant")
    diag.step("auth", { ms_auth: timedStepMs(tAuth), auth_source: auth.authSource })
    diag.step("scope", { ms_scope: timedStepMs(tScope) })

    if (!scope.ok) {
      diag.fail(scope.status, scope.error)
      return respond({ error: scope.error }, scope.status)
    }

    const tTier = performance.now()
    const [firmRow, entitlementRow] = await Promise.all([
      lookupAccountingFirmUser(supabase, user.id),
      loadBillsListEntitlementRow(supabase, scope.businessId),
    ])
    diag.recordTiming("entitlement", timedStepMs(tTier), "parallel")
    diag.step("entitlement", { ms_entitlement: timedStepMs(tTier) })
    if (!entitlementRow) {
      diag.fail(404, "Business not found")
      return respond({ error: "Business not found" }, 404)
    }
    const tierDenied = decideMaterialsWorkspaceRead(firmRow, entitlementRow, "professional")
    if (tierDenied) {
      diag.fail(tierDenied.status, "tier_denied")
      const body = await tierDenied.json().catch(() => ({ error: "Forbidden" }))
      return respond(body, tierDenied.status)
    }

    const page = Math.max(
      DEFAULT_PAGE,
      Number.parseInt(searchParams.get("page") || String(DEFAULT_PAGE), 10) || DEFAULT_PAGE
    )
    const limitRaw =
      Number.parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitRaw))

    const listParams = {
      businessId: scope.businessId,
      page,
      limit,
      supplierName: searchParams.get("supplier_name"),
      status: searchParams.get("status"),
      startDate: searchParams.get("start_date"),
      endDate: searchParams.get("end_date"),
      search: searchParams.get("search"),
    }

    const cacheKey = billsCacheKey(listParams)
    const tCache = performance.now()
    const { value: payload, source: cacheSource, cache_enabled } =
      await loadOrComputeOperationalListCache(cacheKey, () =>
        loadBillsListPayload(supabase, listParams, diag)
      )
    const cacheMs = timedStepMs(tCache)
    if (cacheSource === "cache_hit" || cacheSource === "cache_coalesce") {
      diag.recordTiming("bills_rpc", 0, `skipped_${cacheSource}`)
      diag.recordTiming("assembly", 0, `skipped_${cacheSource}`)
      diag.recordTiming("cache", cacheMs, cacheSource)
    } else {
      diag.recordTiming("cache", 0, cache_enabled ? "cache_miss" : "cache_disabled")
    }

    diag.step("cache", {
      cache_source: cacheSource,
      cache_enabled,
      ms_total: cacheMs,
      row_count: payload.bills.length,
    })

    diag.finish(200, { row_count: payload.bills.length, total: payload.pagination.total })
    return respond(payload, 200)
  } catch (error: unknown) {
    console.error("Error in bills list:", error)
    const msg = rpcErrorMessage(error)
    const meta =
      error && typeof error === "object" && "code" in error
        ? supabaseErrorDiag(
            error as { code?: string; message?: string; details?: string; hint?: string }
          )
        : undefined
    diag.fail(500, msg, meta)
    return respond({ error: msg }, 500)
  }
}
