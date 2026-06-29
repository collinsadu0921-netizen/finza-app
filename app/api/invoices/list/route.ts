import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

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

type OverduePageRpcResult = {
  total_count: number
  invoice_ids: string[]
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
  }
): Promise<{ invoices: unknown[]; totalCount: number }> {
  const from = (params.page - 1) * params.limit

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

  if (invoiceIds.length === 0) {
    return { invoices: [], totalCount }
  }

  const { data: invoiceRows, error: invoiceError } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("business_id", params.businessId)
    .is("deleted_at", null)
    .in("id", invoiceIds)

  if (invoiceError) {
    throw new Error(invoiceError.message)
  }

  const byId = new Map((invoiceRows ?? []).map((row) => [row.id as string, row]))
  const ordered = invoiceIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row != null)

  return { invoices: ordered, totalCount }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const business = { id: scope.businessId }
    const status = searchParams.get("status")
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
      const { invoices, totalCount } = await fetchOverdueInvoicesPage(supabase, {
        businessId: business.id,
        page,
        limit,
        customerId,
        startDate,
        endDate,
        search,
      })

      return NextResponse.json({
        invoices,
        pagination: {
          page,
          pageSize: limit,
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        },
      })
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
      const { data: matchingCustomers } = await supabase
        .from("customers")
        .select("id")
        .eq("business_id", business.id)
        .ilike("name", `%${search}%`)
        .is("deleted_at", null)

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

    const { data: invoices, error, count } = await query

    if (error) {
      console.error("Error fetching invoices:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    const totalCount = count ?? 0
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
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
