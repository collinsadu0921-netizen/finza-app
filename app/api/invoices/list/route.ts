import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import {
  loadOrComputeOperationalListCache,
} from "@/lib/server/operationalListCache"
import { createRouteDiag, supabaseErrorDiag, timedStepMs } from "@/lib/server/routeDiagnostics"

const INVOICE_SELECT = `
        id,
        invoice_number,
        customer_id,
        subtotal,
        vat,
        total,
        currency_code,
        currency_symbol,
        status,
        issue_date,
        due_date,
        tax_lines,
        customers (
          id,
          name,
          email
        )
      `

type OverdueListPayload = {
  invoices: unknown[]
  pagination: {
    page: number
    pageSize: number
    totalCount: number
    totalPages: number
  }
}

function overdueCacheKey(params: {
  businessId: string
  page: number
  limit: number
  customerId: string | null
  startDate: string | null
  endDate: string | null
  search: string | null
}): string {
  return [
    "invoices_overdue",
    params.businessId,
    params.page,
    params.limit,
    params.customerId ?? "",
    params.startDate ?? "",
    params.endDate ?? "",
    params.search ?? "",
  ].join("|")
}

type OverduePageRpcResult = {
  total_count: number
  invoice_ids: string[]
}

async function buildOverdueListPayload(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    businessId: string
    page: number
    limit: number
    customerId: string | null
    startDate: string | null
    endDate: string | null
    search: string | null
  },
  diag: ReturnType<typeof createRouteDiag>
): Promise<OverdueListPayload> {
  const { invoices, totalCount } = await fetchOverdueInvoicesPage(supabase, params, diag)
  return {
    invoices,
    pagination: {
      page: params.page,
      pageSize: params.limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / params.limit)),
    },
  }
}
/**
 * Overdue invoices must be paginated in the database.
 * Loading all past-due invoices into Node to filter by outstanding balance
 * does not scale (thousands of invoices per business). Operational outstanding
 * uses payments + applied credit notes; get_ar_balances_by_invoice is period-
 * scoped ledger AR and is not suitable for this list filter.
 */
async function fetchOverdueInvoicesPage(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    businessId: string
    page: number
    limit: number
    customerId: string | null
    startDate: string | null
    endDate: string | null
    search: string | null
  },
  diag: ReturnType<typeof createRouteDiag>
): Promise<{ invoices: unknown[]; totalCount: number }> {
  const from = (params.page - 1) * params.limit
  const tRpc = performance.now()

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_operational_overdue_invoices_page",
    {
      p_business_id: params.businessId,
      p_limit: params.limit,
      p_offset: from,
      p_customer_id: params.customerId || null,
      p_start_date: params.startDate || null,
      p_end_date: params.endDate || null,
      p_search: params.search || null,
    }
  )

  if (rpcError) {
    diag.step("overdue_rpc", {
      rpc: "get_operational_overdue_invoices_page",
      ms_rpc: timedStepMs(tRpc),
      ...supabaseErrorDiag(rpcError),
    })
    throw new Error(rpcError.message)
  }

  const pageResult = (rpcData ?? {
    total_count: 0,
    invoice_ids: [],
  }) as OverduePageRpcResult

  const invoiceIds = Array.isArray(pageResult.invoice_ids)
    ? pageResult.invoice_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : []

  const totalCount = Number(pageResult.total_count) || 0
  diag.step("overdue_rpc", {
    rpc: "get_operational_overdue_invoices_page",
    ms_rpc: timedStepMs(tRpc),
    id_count: invoiceIds.length,
    total_count: totalCount,
  })

  if (invoiceIds.length === 0) {
    return { invoices: [], totalCount }
  }

  const tRows = performance.now()
  const { data: invoiceRows, error: invoiceError } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("business_id", params.businessId)
    .is("deleted_at", null)
    .in("id", invoiceIds)

  if (invoiceError) {
    diag.step("overdue_rows", {
      ms_query: timedStepMs(tRows),
      ...supabaseErrorDiag(invoiceError),
    })
    throw new Error(invoiceError.message)
  }

  diag.step("overdue_rows", {
    ms_query: timedStepMs(tRows),
    row_count: (invoiceRows ?? []).length,
  })

  const byId = new Map((invoiceRows ?? []).map((row) => [row.id as string, row]))
  const ordered = invoiceIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row != null)

  return { invoices: ordered, totalCount }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const routeName = status === "overdue" ? "invoices_overdue" : "invoices_list"
  let diag = createRouteDiag(routeName)

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      diag.fail(401, "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    diag.step("auth", { ms_auth: timedStepMs(tAuth) })

    if (!scope.ok) {
      diag.fail(scope.status, scope.error)
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    diag = createRouteDiag(routeName, scope.businessId)

    const business = { id: scope.businessId }
    const customerId = searchParams.get("customer_id")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const search = searchParams.get("search")
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limitRaw = Number.parseInt(searchParams.get("limit") || "25", 10) || 25
    const limit = Math.min(100, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    if (status === "overdue") {
      const overdueParams = {
        businessId: business.id,
        page,
        limit,
        customerId,
        startDate,
        endDate,
        search,
      }
      const cacheKey = overdueCacheKey(overdueParams)
      const tOverdue = performance.now()
      const { value: payload, source: cacheSource, cache_enabled } =
        await loadOrComputeOperationalListCache(cacheKey, () =>
          buildOverdueListPayload(supabase, overdueParams, diag)
        )
      diag.step("cache", {
        cache_source: cacheSource,
        cache_enabled,
        ms_total: timedStepMs(tOverdue),
        row_count: payload.invoices.length,
        total_count: payload.pagination.totalCount,
      })

      diag.finish(200, { page, limit })
      return NextResponse.json(payload)
    }

    let query = supabase
      .from("invoices")
      .select(INVOICE_SELECT, { count: "exact" })
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    if (customerId) {
      query = query.eq("customer_id", customerId)
    }

    if (startDate) {
      query = query.gte("issue_date", startDate)
    }

    if (endDate) {
      query = query.lte("issue_date", endDate)
    }

    if (search) {
      const tSearch = performance.now()
      const { data: matchingCustomers } = await supabase
        .from("customers")
        .select("id")
        .eq("business_id", business.id)
        .ilike("name", `%${search}%`)
        .is("deleted_at", null)
      diag.step("customer_search", {
        ms_query: timedStepMs(tSearch),
        row_count: matchingCustomers?.length ?? 0,
      })

      const matchingCustomerIds = matchingCustomers?.map((c: { id: string }) => c.id) || []

      const searchConditions = [
        `invoice_number.ilike.%${search}%`,
        `notes.ilike.%${search}%`,
      ]

      if (matchingCustomerIds.length > 0) {
        searchConditions.push(`customer_id.in.(${matchingCustomerIds.join(",")})`)
      }

      query = query.or(searchConditions.join(","))
    }

    query = query.range(from, to)

    const tList = performance.now()
    const { data: invoices, error, count } = await query
    diag.step("invoices_query", {
      ms_query: timedStepMs(tList),
      row_count: (invoices ?? []).length,
      total_count: count ?? 0,
    })

    if (error) {
      console.error("Error fetching invoices:", error)
      diag.fail(500, error.message, supabaseErrorDiag(error))
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    const totalCount = count ?? 0
    diag.finish(200, { page, limit })
    return NextResponse.json({
      invoices: invoices || [],
      pagination: {
        page,
        pageSize: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    })
  } catch (error: unknown) {
    console.error("Error in invoice list:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    diag.fail(500, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
