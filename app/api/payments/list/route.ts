import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { loadCustomerPaymentsCollectedTotal } from "@/lib/server/customerPaymentsCollected"

function isOutOfRangeError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === "PGRST103") return true
  return /requested range not satisfiable/i.test(error.message ?? "")
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
    const invoiceId = searchParams.get("invoice_id")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limitRaw = Number.parseInt(searchParams.get("limit") || "25", 10) || 25
    const limit = Math.min(100, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from("payments")
      .select(
        `
        *,
        invoices(
          id,
          invoice_number,
          customers(
            id,
            name
          )
        )
      `,
        { count: "exact" }
      )
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (invoiceId) {
      query = query.eq("invoice_id", invoiceId)
    }

    if (startDate) {
      query = query.gte("date", startDate)
    }

    if (endDate) {
      query = query.lte("date", endDate)
    }

    const { data: payments, error, count } = await query.range(from, to)

    const totalAmountPromise = loadCustomerPaymentsCollectedTotal(
      supabase,
      business.id,
      startDate,
      endDate,
      { invoiceId }
    )

    if (error && isOutOfRangeError(error)) {
      // Page beyond last page: return empty rows, keep full-range totals/metadata.
      let countQuery = supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .is("deleted_at", null)

      if (invoiceId) countQuery = countQuery.eq("invoice_id", invoiceId)
      if (startDate) countQuery = countQuery.gte("date", startDate)
      if (endDate) countQuery = countQuery.lte("date", endDate)

      const [{ count: totalCountRaw, error: countError }, totalAmount] = await Promise.all([
        countQuery,
        totalAmountPromise,
      ])

      if (countError) {
        console.error("Error counting payments after out-of-range page:", countError)
        return NextResponse.json({ error: countError.message }, { status: 500 })
      }

      const totalCount = totalCountRaw ?? 0
      return NextResponse.json({
        payments: [],
        pagination: {
          page,
          pageSize: limit,
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        },
        totals: {
          totalAmount,
          totalCount,
        },
      })
    }

    if (error) {
      console.error("Error fetching payments:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const totalCount = count ?? 0
    const totalAmount = await totalAmountPromise

    return NextResponse.json({
      payments: payments || [],
      pagination: {
        page,
        pageSize: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
      totals: {
        totalAmount,
        totalCount,
      },
    })
  } catch (error: any) {
    console.error("Error in payments list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
