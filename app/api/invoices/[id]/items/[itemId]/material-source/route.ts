import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { logAudit } from "@/lib/auditLog"

/**
 * PATCH /api/invoices/[id]/items/[itemId]/material-source
 * Classify a legacy (or mis-set) material line source without full invoice rewrite.
 * Only allowed when the line has no active fulfilment quantity.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: invoiceId, itemId } = await params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const {
      business_id: bodyBusinessId,
      material_inventory_source: sourceRaw,
      job_material_usage_id: usageRaw,
    } = body as {
      business_id?: string
      material_inventory_source?: string
      job_material_usage_id?: string | null
    }

    const source = String(sourceRaw ?? "")
      .trim()
      .toLowerCase()
    if (source !== "direct_sale" && source !== "job_usage") {
      return NextResponse.json(
        {
          error: "material_inventory_source must be direct_sale or job_usage",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      )
    }

    const { data: invoiceCheck } = await supabase
      .from("invoices")
      .select("id, business_id, deleted_at, status")
      .eq("id", invoiceId)
      .maybeSingle()

    if (!invoiceCheck || invoiceCheck.deleted_at) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const role = await getUserRole(supabase, user.id, invoiceCheck.business_id)
    if (!role) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      bodyBusinessId ?? invoiceCheck.business_id
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    if (scope.businessId !== invoiceCheck.business_id) {
      return NextResponse.json({ error: "Cross-tenant reference blocked." }, { status: 403 })
    }

    const denied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      scope.businessId,
      "professional"
    )
    if (denied) return denied

    const { data: item } = await supabase
      .from("invoice_items")
      .select("id, invoice_id, material_id, material_inventory_source, job_material_usage_id, qty")
      .eq("id", itemId)
      .eq("invoice_id", invoiceId)
      .maybeSingle()

    if (!item || !item.material_id) {
      return NextResponse.json({ error: "Material invoice line not found" }, { status: 404 })
    }

    const { data: fulfilledQty } = await supabase.rpc("invoice_item_fulfilled_quantity", {
      p_invoice_item_id: itemId,
    })
    if (Number(fulfilledQty ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "This material line has already been fulfilled. Use material return/reversal instead of changing the source.",
          code: "LINE_ALREADY_FULFILLED",
        },
        { status: 400 }
      )
    }

    if (
      item.material_inventory_source === "direct_sale" ||
      item.material_inventory_source === "job_usage"
    ) {
      if (String(invoiceCheck.status).toLowerCase() !== "draft") {
        return NextResponse.json(
          {
            error: "Issued material lines cannot change source after classification. Create a correction document instead.",
            code: "SOURCE_LOCKED",
          },
          { status: 400 }
        )
      }
    }

    let job_material_usage_id: string | null = null
    if (source === "job_usage") {
      const usageId = usageRaw != null ? String(usageRaw).trim() : ""
      if (!usageId) {
        return NextResponse.json(
          { error: "job_material_usage_id is required for job_usage", code: "VALIDATION_ERROR" },
          { status: 400 }
        )
      }

      const validation = await import("@/lib/invoices/validateInvoiceLineMaterials").then((m) =>
        m.validateInvoiceLineMaterials(
          supabase,
          scope.businessId,
          [
            {
              material_id: item.material_id,
              material_inventory_source: "job_usage",
              job_material_usage_id: usageId,
              qty: Number(item.qty) || 0,
            },
          ],
          { excludeInvoiceId: invoiceId }
        )
      )
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error, code: "VALIDATION_ERROR" },
          { status: validation.status }
        )
      }
      job_material_usage_id = usageId
    }

    const { data: updated, error: updErr } = await supabase
      .from("invoice_items")
      .update({
        material_inventory_source: source,
        job_material_usage_id,
      })
      .eq("id", itemId)
      .eq("invoice_id", invoiceId)
      .select("*")
      .single()

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 })
    }

    await logAudit({
      businessId: scope.businessId,
      userId: user.id,
      actionType: "invoice.material_source_classified",
      entityType: "invoice_items",
      entityId: itemId,
      newValues: {
        material_inventory_source: source,
        job_material_usage_id,
      },
      description: "Invoice material source classified",
      request,
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (err: unknown) {
    console.error("material-source classify error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
