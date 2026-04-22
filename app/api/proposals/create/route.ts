import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { defaultSectionsForTemplate, DEFAULT_PROPOSAL_TEMPLATE_ID, isKnownTemplateId } from "@/lib/proposals/templates"
import { validateAndNormalizePricingForDb } from "@/lib/proposals/pricingForDb"

const bodySchema = z.object({
  business_id: z.string().uuid(),
  title: z.string().max(500).optional(),
  customer_id: z.string().uuid().nullable().optional(),
  template_id: z.string().max(120).optional(),
  pricing_mode: z.enum(["none", "fixed", "line_items", "custom"]).optional(),
  pricing_payload: z.unknown().optional(),
  currency_code: z.string().max(8).nullable().optional(),
})

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const json = await request.json().catch(() => null)
    const body = bodySchema.safeParse(json)
    if (!body.success) {
      return NextResponse.json({ error: "Invalid body", details: body.error.flatten() }, { status: 400 })
    }

    const scope = await requireBusinessScopeForUser(supabase, user.id, body.data.business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const templateId =
      body.data.template_id && isKnownTemplateId(body.data.template_id) ? body.data.template_id : DEFAULT_PROPOSAL_TEMPLATE_ID

    if (body.data.customer_id) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id")
        .eq("id", body.data.customer_id)
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .maybeSingle()
      if (!cust) {
        return NextResponse.json({ error: "Customer not found for this business" }, { status: 400 })
      }
    }

    const pricingMode = body.data.pricing_mode ?? "none"
    const { pricing_mode, pricing_payload } = validateAndNormalizePricingForDb(pricingMode, body.data.pricing_payload ?? {})

    const sections = defaultSectionsForTemplate(templateId)

    const { data: row, error } = await supabase
      .from("proposals")
      .insert({
        business_id: businessId,
        customer_id: body.data.customer_id ?? null,
        title: (body.data.title || "Untitled proposal").trim(),
        template_id: templateId,
        sections,
        pricing_mode,
        pricing_payload,
        currency_code: body.data.currency_code?.trim() || null,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
      .select("id, public_token, title, status, template_id, created_at")
      .single()

    if (error || !row) {
      console.error("proposals create:", error)
      return NextResponse.json({ error: error?.message || "Failed to create proposal" }, { status: 500 })
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal_created",
      entityType: "proposal",
      entityId: row.id,
      newValues: { title: row.title, template_id: row.template_id },
      request,
    })

    return NextResponse.json({
      proposal: row,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to create proposal"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
