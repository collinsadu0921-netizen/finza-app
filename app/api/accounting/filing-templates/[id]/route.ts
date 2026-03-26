import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"

/**
 * GET /api/accounting/filing-templates/[id]
 * Fetch a single filing template with its items, sorted by sort_order.
 * Firm-scoped — user must be a member of the owning firm.
 */

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: templateId } = await context.params
    if (!templateId) return NextResponse.json({ error: "Missing template id" }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Forbidden"
      return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 403 })
    }

    const { data: firmRow } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()

    if (!firmRow?.firm_id) {
      return NextResponse.json({ error: "Forbidden — not a firm member" }, { status: 403 })
    }

    const { data: template, error: tplErr } = await supabase
      .from("client_filing_templates")
      .select("*, items:client_filing_template_items(id, title, note, sort_order, created_at)")
      .eq("id", templateId)
      .eq("firm_id", firmRow.firm_id)
      .maybeSingle()

    if (tplErr) {
      console.error("filing_templates fetch:", tplErr)
      return NextResponse.json({ error: tplErr.message }, { status: 500 })
    }
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    const normalised = {
      ...template,
      items: (template.items ?? []).sort(
        (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
      ),
    }

    return NextResponse.json({ template: normalised })
  } catch (e) {
    console.error("GET /api/accounting/filing-templates/[id]:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
