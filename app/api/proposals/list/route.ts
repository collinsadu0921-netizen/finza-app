import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import type { ProposalListRow } from "@/lib/proposals/proposalListApi"

export const dynamic = "force-dynamic"

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

    const page = clampInt(searchParams.get("page"), 1, 1, 1_000_000)
    const pageSize = clampInt(searchParams.get("limit"), 50, 1, 100)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data: rows, error, count } = await supabase
      .from("proposals")
      .select("id, title, status, template_id, proposal_number, customer_id, public_token, converted_estimate_id, created_at, updated_at", {
        count: "exact",
      })
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, to)

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json({
          proposals: [],
          pagination: { page, pageSize, totalCount: 0, totalPages: 0 },
        })
      }
      console.error("proposals list:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const totalCount = count ?? 0
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

    return NextResponse.json({
      proposals: (rows || []) as ProposalListRow[],
      pagination: { page, pageSize, totalCount, totalPages },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to list proposals"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
