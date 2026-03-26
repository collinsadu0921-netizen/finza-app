import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"

/**
 * GET /api/accounting/documents
 *
 * Firm-wide document listing across all clients in the accountant's firm(s).
 * Returns metadata only (no signed/public URLs).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const memberForbidden = await requireFirmMemberForApi(supabase, user.id)
    if (memberForbidden) return memberForbidden

    const { data: firmUsers, error: firmErr } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)

    if (firmErr || !firmUsers?.length) {
      return NextResponse.json({ error: "Not a firm member" }, { status: 403 })
    }

    const firmIds = firmUsers.map((f) => f.firm_id as string).filter(Boolean)

    const { searchParams } = new URL(request.url)
    const clientFilter = searchParams.get("client")?.trim() ?? ""
    const categoryFilter = searchParams.get("category")?.trim() ?? ""
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10), 500)

    let query = supabase
      .from("client_documents")
      .select(`
        id,
        firm_id,
        client_business_id,
        title,
        category,
        file_name,
        created_at,
        businesses!client_documents_client_business_id_fkey (
          id,
          name
        )
      `)
      .in("firm_id", firmIds)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (clientFilter) {
      query = query.eq("client_business_id", clientFilter)
    }
    if (categoryFilter) {
      query = query.eq("category", categoryFilter)
    }

    const { data: rows, error: listErr } = await query

    if (listErr) {
      console.error("firm-wide client_documents list error:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    const documents = (rows ?? []).map((row) => {
      const business = row.businesses as { id: string; name: string } | null
      const { businesses: _drop, ...rest } = row as typeof row & { businesses: unknown }
      return {
        ...rest,
        client_name: business?.name ?? null,
      }
    })

    return NextResponse.json({ documents })
  } catch (e) {
    console.error("GET /api/accounting/documents:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
