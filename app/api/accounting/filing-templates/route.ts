import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"

/**
 * GET /api/accounting/filing-templates?filing_type=
 * List all filing templates for the user's firm.
 * Optional ?filing_type= filter.
 * Returns each template with its items (sorted by sort_order).
 *
 * POST /api/accounting/filing-templates
 * Body: { name, filing_type, items: [{ title, note?, sort_order? }] }
 * Create a new template with its checklist items.
 */

// ── shared: resolve firm for the authenticated user ───────────────────────────

async function resolveFirmAuth(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized", status: 401 } as const

  try {
    assertAccountingAccess(accountingUserFromRequest(request))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Forbidden"
    return { error: msg, status: msg === "Unauthorized" ? 401 : 403 } as const
  }

  const { data: firmRows, error: firmErr } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle()

  if (firmErr) {
    console.error("accounting_firm_users lookup:", firmErr)
    return { error: firmErr.message, status: 500 } as const
  }
  if (!firmRows?.firm_id) {
    return { error: "Forbidden — not a firm member", status: 403 } as const
  }

  return { supabase, user, firmId: firmRows.firm_id as string }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const result = await resolveFirmAuth(request)
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { supabase, firmId } = result

    const { searchParams } = new URL(request.url)
    const filingType = searchParams.get("filing_type")?.trim()

    let query = supabase
      .from("client_filing_templates")
      .select("*, items:client_filing_template_items(id, title, note, sort_order, created_at)")
      .eq("firm_id", firmId)
      .order("created_at", { ascending: false })

    if (filingType) {
      query = query.eq("filing_type", filingType)
    }

    const { data: templates, error: listErr } = await query

    if (listErr) {
      console.error("filing_templates list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    // Sort items within each template by sort_order
    const normalised = (templates ?? []).map((t) => ({
      ...t,
      items: (t.items ?? []).sort(
        (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
      ),
    }))

    return NextResponse.json({ templates: normalised })
  } catch (e) {
    console.error("GET /api/accounting/filing-templates:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

type RawItem = { title?: unknown; note?: unknown; sort_order?: unknown }

export async function POST(request: NextRequest) {
  try {
    const result = await resolveFirmAuth(request)
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { supabase, user, firmId } = result

    const body = await request.json().catch(() => ({}))
    const name       = typeof body.name        === "string" ? body.name.trim()        : ""
    const filingType = typeof body.filing_type === "string" ? body.filing_type.trim() : ""
    const rawItems: RawItem[] = Array.isArray(body.items) ? body.items : []
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!name)       return NextResponse.json({ error: "name is required" }, { status: 400 })
    if (!filingType) return NextResponse.json({ error: "filing_type is required" }, { status: 400 })

    // Validate items
    const items = rawItems
      .map((item, idx) => ({
        title:      typeof item.title === "string" ? item.title.trim() : "",
        note:       typeof item.note  === "string" ? item.note.trim()  : "",
        sort_order: typeof item.sort_order === "number" ? item.sort_order : idx,
      }))
      .filter((item) => item.title.length > 0)

    // Insert template
    const { data: template, error: tplErr } = await supabase
      .from("client_filing_templates")
      .insert({ firm_id: firmId, name, filing_type: filingType, created_by_user_id: user.id, metadata })
      .select()
      .single()

    if (tplErr) {
      console.error("filing_templates insert:", tplErr)
      return NextResponse.json({ error: tplErr.message }, { status: 500 })
    }

    // Insert items (if any)
    let insertedItems: unknown[] = []
    if (items.length > 0) {
      const { data: rows, error: itemsErr } = await supabase
        .from("client_filing_template_items")
        .insert(items.map((item) => ({ template_id: template.id, ...item })))
        .select()

      if (itemsErr) {
        console.error("filing_template_items insert:", itemsErr)
        return NextResponse.json({ error: itemsErr.message }, { status: 500 })
      }
      insertedItems = rows ?? []
    }

    return NextResponse.json(
      { template: { ...template, items: insertedItems } },
      { status: 201 }
    )
  } catch (e) {
    console.error("POST /api/accounting/filing-templates:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
