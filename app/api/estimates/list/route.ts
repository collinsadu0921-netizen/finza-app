import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import {
  DEFAULT_ESTIMATES_LIST_PAGE_SIZE,
  MAX_ESTIMATES_LIST_PAGE_SIZE,
  type EstimateListRow,
  type EstimatesListResponse,
} from "@/lib/estimates/estimateListApi"

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? "", 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
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
    const businessId = scope.businessId

    const statusFilter = (searchParams.get("status") || "all").trim().toLowerCase()
    const searchRaw = (searchParams.get("search") || "").trim()
    const search = searchRaw.length > 200 ? searchRaw.slice(0, 200) : searchRaw

    const page = clampInt(searchParams.get("page"), 1, 1, 1_000_000)
    const pageSize = clampInt(
      searchParams.get("limit"),
      DEFAULT_ESTIMATES_LIST_PAGE_SIZE,
      1,
      MAX_ESTIMATES_LIST_PAGE_SIZE
    )
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data: bizRow } = await supabase
      .from("businesses")
      .select("default_currency")
      .eq("id", businessId)
      .maybeSingle()
    const businessDefaultCurrency = bizRow?.default_currency ?? null

    const applyStatus = (q: any) => {
      let next = q.eq("business_id", businessId).is("deleted_at", null)
      if (statusFilter && statusFilter !== "all") {
        next = next.eq("status", statusFilter)
      }
      return next
    }

    const applySearch = async (q: any) => {
      if (!search) return q
      const { data: matchingCustomers } = await supabase
        .from("customers")
        .select("id")
        .eq("business_id", businessId)
        .ilike("name", `%${search}%`)
        .is("deleted_at", null)

      const matchingCustomerIds = matchingCustomers?.map((c: { id: string }) => c.id) || []
      const parts = [`estimate_number.ilike.%${search}%`]
      if (matchingCustomerIds.length > 0) {
        parts.push(`customer_id.in.(${matchingCustomerIds.join(",")})`)
      }
      return q.or(parts.join(","))
    }

    let listQuery: any = applyStatus(
      supabase
        .from("estimates")
        .select("id, estimate_number, customer_id, total_amount, status, expiry_date, created_at", {
          count: "exact",
        })
    )
    listQuery = await applySearch(listQuery)

    const { data: rows, error: listError, count } = await listQuery
      .order("created_at", { ascending: false })
      .range(from, to)

    if (listError) {
      if (listError.code === "42P01") {
        const empty: EstimatesListResponse = {
          estimates: [],
          pagination: {
            page: 1,
            pageSize,
            totalCount: 0,
            totalPages: 0,
          },
          summary: {
            totalInFilter: 0,
            sentInScope: 0,
            acceptedInScope: 0,
          },
          business_default_currency: businessDefaultCurrency,
        }
        return NextResponse.json(empty)
      }
      return NextResponse.json({ error: listError.message }, { status: 500 })
    }

    const totalCount = count ?? 0
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize)

    const rawRows = rows || []
    const customerIds = [...new Set(rawRows.map((r: { customer_id: string | null }) => r.customer_id).filter(Boolean))] as string[]
    const customerMap: Record<string, string> = {}
    if (customerIds.length > 0) {
      const { data: custRows } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", businessId)
        .in("id", customerIds)
        .is("deleted_at", null)
      for (const c of custRows || []) {
        customerMap[c.id] = c.name ?? "No Customer"
      }
    }

    const estimates: EstimateListRow[] = rawRows.map((est: any) => ({
      id: est.id,
      estimate_number: est.estimate_number ?? null,
      customer_id: est.customer_id ?? null,
      customer_name: est.customer_id ? (customerMap[est.customer_id] ?? "No Customer") : "No Customer",
      total_amount: Number(est.total_amount ?? 0),
      status: est.status || "draft",
      expiry_date: est.expiry_date ?? null,
      created_at: est.created_at,
    }))

    // Summary: same status scope as list, no search (matches prior stat cards vs client search)
    const baseCountQuery = () =>
      supabase
        .from("estimates")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId)
        .is("deleted_at", null)

    let totalInFilter = 0
    let sentInScope = 0
    let acceptedInScope = 0

    if (!statusFilter || statusFilter === "all") {
      const [{ count: t }, { count: s }, { count: a }] = await Promise.all([
        baseCountQuery(),
        baseCountQuery().eq("status", "sent"),
        baseCountQuery().eq("status", "accepted"),
      ])
      totalInFilter = t ?? 0
      sentInScope = s ?? 0
      acceptedInScope = a ?? 0
    } else {
      const { count: tf } = await applyStatus(
        supabase.from("estimates").select("*", { count: "exact", head: true })
      )
      totalInFilter = tf ?? 0
      if (statusFilter === "sent") {
        sentInScope = totalInFilter
        acceptedInScope = 0
      } else if (statusFilter === "accepted") {
        sentInScope = 0
        acceptedInScope = totalInFilter
      } else {
        sentInScope = 0
        acceptedInScope = 0
      }
    }

    const body: EstimatesListResponse = {
      estimates,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
      summary: {
        totalInFilter,
        sentInScope,
        acceptedInScope,
      },
      business_default_currency: businessDefaultCurrency,
    }

    return NextResponse.json(body)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
