import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * PATCH /api/service/jobs/[id]
 * Update project fields (metadata + optional proforma link).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: jobId } = await Promise.resolve(context.params)

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const {
      title,
      description,
      customer_id,
      status,
      start_date,
      end_date,
      proforma_invoice_id,
      invoice_id,
    } = body as Record<string, unknown>

    const update: Record<string, unknown> = {}
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return NextResponse.json({ error: "title cannot be empty" }, { status: 400 })
      }
      update.title = title.trim()
    }
    if (description !== undefined) {
      update.description = description != null ? String(description).trim() || null : null
    }
    if (customer_id !== undefined) {
      update.customer_id = customer_id || null
    }
    if (status !== undefined) {
      update.status = status
    }
    if (start_date !== undefined) {
      update.start_date = start_date || null
    }
    if (end_date !== undefined) {
      update.end_date = end_date || null
    }
    if (proforma_invoice_id !== undefined) {
      update.proforma_invoice_id = proforma_invoice_id || null
    }
    if (invoice_id !== undefined) {
      update.invoice_id = invoice_id || null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from("service_jobs")
      .update(update)
      .eq("id", jobId)
      .eq("business_id", business.id)
      .select("id")
      .maybeSingle()

    if (error) {
      console.error("PATCH service_jobs:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("PATCH /api/service/jobs/[id]:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
