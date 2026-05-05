import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

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

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business.id, minTier: "starter",
    })
    if (denied) return denied

    const invoiceId = searchParams.get("invoice_id")
    const status    = searchParams.get("status")
    const search = (searchParams.get("search") || "").trim()
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limitRaw = Number.parseInt(searchParams.get("limit") || "25", 10) || 25
    const limit = Math.min(100, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from("credit_notes")
      .select(`
        id, business_id, invoice_id, credit_number, date, reason, subtotal,
        nhil, getfund, covid, vat, total_tax, total, status, notes, public_token,
        created_at, updated_at, deleted_at, tax_lines, tax_engine_code,
        tax_engine_effective_from, tax_jurisdiction,
        invoices (
          id,
          invoice_number,
          customers ( id, name )
        )
      `, { count: "exact" })
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (invoiceId) query = query.eq("invoice_id", invoiceId)
    if (status)    query = query.eq("status", status)
    if (search) {
      query = query.or(`credit_number.ilike.%${search}%,reason.ilike.%${search}%`)
    }
    const { data: creditNotes, error, count } = await query.range(from, to)

    if (error) {
      console.error("Error fetching credit notes:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const totalCount = count ?? 0
    return NextResponse.json({
      creditNotes: creditNotes || [],
      pagination: {
        page,
        pageSize: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    })
  } catch (error: any) {
    console.error("Error in credit notes list:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
