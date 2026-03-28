import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * POST /api/accounting/clients/[id]/filings/[filingId]/apply-template
 * Body: { template_id }
 *
 * Bulk-creates client_filing_checklist_items from the template's items.
 * Each item carries metadata.template_id so the duplicate guard works:
 * if any checklist item with metadata->>'template_id' = template_id already
 * exists on this filing, the endpoint returns 409 Conflict.
 *
 * Logs filing_template_applied / entity_type: client_filing.
 */

type RouteContext = { params: Promise<{ id: string; filingId: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId, filingId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })
    if (!filingId)   return NextResponse.json({ error: "Missing filingId" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const templateId = typeof body.template_id === "string" ? body.template_id.trim() : ""
    if (!templateId) return NextResponse.json({ error: "template_id is required" }, { status: 400 })

    // ── Auth ──────────────────────────────────────────────────────────────────
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

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: businessId }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json({ error: "Missing or invalid business context" }, { status: 400 })
    }

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId: resolved.businessId,
      requiredLevel: "write",
    })
    if (!auth.allowed || !auth.firmId) {
      return NextResponse.json({ error: "Forbidden", reason: auth.reason }, { status: 403 })
    }

    // ── Verify filing ownership ───────────────────────────────────────────────
    const { data: filing, error: filingErr } = await supabase
      .from("client_filings")
      .select("id, filing_type")
      .eq("id", filingId)
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", businessId)
      .maybeSingle()

    if (filingErr) {
      console.error("client_filings lookup:", filingErr)
      return NextResponse.json({ error: filingErr.message }, { status: 500 })
    }
    if (!filing) {
      return NextResponse.json({ error: "Filing not found" }, { status: 404 })
    }

    // ── Fetch the template (must belong to the same firm) ─────────────────────
    const { data: template, error: tplErr } = await supabase
      .from("client_filing_templates")
      .select("id, name, filing_type, items:client_filing_template_items(id, title, note, sort_order)")
      .eq("id", templateId)
      .eq("firm_id", auth.firmId)
      .maybeSingle()

    if (tplErr) {
      console.error("filing_templates fetch:", tplErr)
      return NextResponse.json({ error: tplErr.message }, { status: 500 })
    }
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    // ── Duplicate guard ───────────────────────────────────────────────────────
    // Check if any checklist item on this filing already carries this template_id
    const { data: existing, error: dupErr } = await supabase
      .from("client_filing_checklist_items")
      .select("id")
      .eq("filing_id", filingId)
      .eq("firm_id", auth.firmId)
      .filter("metadata->>template_id", "eq", templateId)
      .limit(1)

    if (dupErr) {
      console.error("checklist duplicate check:", dupErr)
      return NextResponse.json({ error: dupErr.message }, { status: 500 })
    }
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "This template has already been applied to this filing" },
        { status: 409 }
      )
    }

    // ── Bulk-insert checklist items ───────────────────────────────────────────
    const items = (template.items ?? []).sort(
      (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
    )

    if (items.length === 0) {
      return NextResponse.json(
        { error: "Template has no items — nothing to apply" },
        { status: 400 }
      )
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("client_filing_checklist_items")
      .insert(
        items.map((item: { title: string; note: string; sort_order: number }) => ({
          filing_id: filingId,
          firm_id: auth.firmId,
          client_business_id: businessId,
          title: item.title,
          status: "pending",
          note: item.note ?? "",
          created_by_user_id: user.id,
          completed_at: null,
          // Carry template_id in metadata — used by the duplicate guard
          metadata: {
            template_id: templateId,
            template_name: template.name,
            sort_order: item.sort_order,
          },
        }))
      )
      .select()

    if (insertErr) {
      console.error("checklist bulk insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId!,
      actorUserId: user.id,
      actionType: "filing_template_applied",
      entityType: "client_filing",
      entityId: filingId,
      metadata: {
        template_id: templateId,
        template_name: template.name,
        filing_id: filingId,
        filing_type: filing.filing_type,
        items_created: inserted?.length ?? 0,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({
      applied: true,
      template_name: template.name,
      items_created: inserted?.length ?? 0,
    })
  } catch (e) {
    console.error("POST apply-template:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
